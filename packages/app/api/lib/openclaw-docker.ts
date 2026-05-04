import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { OPENCLAW_DEFAULT_WORKSPACE } from '../../shared/index.js';

const execFileAsync = promisify(execFile);

export interface OpenClawRuntimeIdentity {
  tenantId: string;
  channelId: string;
  endUserId: string;
  backendId: string;
}

interface DockerInspect {
  State?: { Running?: boolean };
  Config?: { Labels?: Record<string, string> | null };
  NetworkSettings?: {
    Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null>;
    Networks?: Record<string, unknown>;
  };
}

export interface OpenClawDockerRuntime {
  baseUrl: string;
  containerName: string;
  gatewayToken: string;
  stateDir: string;
  workspaceDir: string;
  timings: {
    totalMs: number;
    configMs: number;
    workspaceMs: number;
    chownMs: number;
    containerMs: number;
    waitMs: number;
  };
}

export interface OpenClawRuntimeTemplate {
  name?: string;
  versionId?: string | null;
  version?: number | null;
  modelProvider?: {
    id: string;
    provider: string;
    baseUrl?: string | null;
    apiKey?: string | null;
    model?: string | null;
    api?: string | null;
  } | null;
  workspace?: Array<{ path: string; content: string }>;
  knowledgeBase?: Array<{ title: string; content: string }>;
  workspaceSources?: string[];
  skillSources?: string[];
  secretEnv?: Record<string, string>;
}

const OPENCLAW_IMAGE = process.env.OPENCLAW_IMAGE ?? '1panel/openclaw:latest';
const OPENCLAW_DATA_DIR = process.env.OPENCLAW_DATA_DIR ?? path.resolve(process.cwd(), 'data', 'tenants');
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN ?? '';
const DOCKER_TIMEOUT_MS = Number(process.env.OPENCLAW_DOCKER_TIMEOUT_MS ?? 300_000);
const OPENCLAW_CONTAINER_UID = Number(process.env.OPENCLAW_CONTAINER_UID ?? 1000);
const OPENCLAW_CONTAINER_GID = Number(process.env.OPENCLAW_CONTAINER_GID ?? 1000);
const OPENCLAW_DOCKER_NETWORK = process.env.OPENCLAW_DOCKER_NETWORK ?? '';
const OPENCLAW_MODEL_PROVIDER_ID = process.env.OPENCLAW_MODEL_PROVIDER_ID ?? '';
const OPENCLAW_MODEL_PROVIDER_BASE_URL = process.env.OPENCLAW_MODEL_PROVIDER_BASE_URL ?? '';
const OPENCLAW_MODEL_PROVIDER_API_KEY = process.env.OPENCLAW_MODEL_PROVIDER_API_KEY ?? '';
const OPENCLAW_MODEL_PROVIDER_API = process.env.OPENCLAW_MODEL_PROVIDER_API ?? 'openai-completions';
const OPENCLAW_DEFAULT_MODEL = process.env.OPENCLAW_DEFAULT_MODEL ?? '';
const OPENCLAW_READY_TIMEOUT_MS = Number(process.env.OPENCLAW_READY_TIMEOUT_MS ?? 180_000);
const OPENCLAW_PREWARM_CHAT = process.env.OPENCLAW_PREWARM_CHAT === 'true';
const OPENCLAW_SHARED_RUNTIME_DEPS = process.env.OPENCLAW_SHARED_RUNTIME_DEPS !== 'false';

const ensureTasks = new Map<string, Promise<OpenClawDockerRuntime>>();
const prewarmTasks = new Map<string, Promise<void>>();

function shortHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 12);
}

function safeSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  return cleaned || shortHash(value);
}

export function openClawRuntimeDirs(identity: OpenClawRuntimeIdentity): { stateDir: string; workspaceDir: string } {
  const root = path.resolve(
    OPENCLAW_DATA_DIR,
    'tenants',
    safeSegment(identity.tenantId),
    'channels',
    safeSegment(identity.channelId),
    'users',
    safeSegment(identity.endUserId),
    'backends',
    safeSegment(identity.backendId),
  );
  return {
    stateDir: path.join(root, 'state'),
    workspaceDir: path.join(root, 'workspace'),
  };
}

function openClawSharedRuntimeDepsDir(): string {
  return path.resolve(OPENCLAW_DATA_DIR, 'cache', 'plugin-runtime-deps');
}

export function openClawContainerName(identity: OpenClawRuntimeIdentity): string {
  return `clawscale-openclaw-${shortHash([
    identity.tenantId,
    identity.channelId,
    identity.endUserId,
    identity.backendId,
  ].join(':'))}`;
}

function openClawGatewayToken(identity: OpenClawRuntimeIdentity): string {
  if (OPENCLAW_GATEWAY_TOKEN) return OPENCLAW_GATEWAY_TOKEN;
  return createHash('sha256').update([
    identity.tenantId,
    identity.channelId,
    identity.endUserId,
    identity.backendId,
    process.env.JWT_SECRET ?? 'clawscale',
  ].join(':')).digest('hex');
}

export function openClawSessionKey(identity: OpenClawRuntimeIdentity): string {
  return `clawscale:${shortHash([
    identity.tenantId,
    identity.channelId,
    identity.endUserId,
    identity.backendId,
  ].join(':'))}`;
}

async function docker(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('docker', args, {
    maxBuffer: 1024 * 1024,
    timeout: DOCKER_TIMEOUT_MS,
  });
  return stdout.trim();
}

async function chownRecursive(target: string, uid: number, gid: number): Promise<void> {
  try {
    await fs.chown(target, uid, gid);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  let entries;
  try {
    entries = await fs.readdir(target, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }

  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await chownRecursive(entryPath, uid, gid);
      return;
    }
    try {
      await fs.chown(entryPath, uid, gid);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }));
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function mergeObject(base: JsonObject, patch: JsonObject): JsonObject {
  const result: JsonObject = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = result[key];
    result[key] = isObject(existing) && isObject(value) ? mergeObject(existing, value) : value;
  }
  return result;
}

function defaultRuntimeConfig(identity: OpenClawRuntimeIdentity, template?: OpenClawRuntimeTemplate): JsonObject {
  const config: JsonObject = {
    gateway: {
      auth: {
        mode: 'token',
        token: openClawGatewayToken(identity),
      },
      controlUi: {
        allowedOrigins: ['http://localhost:18789', 'http://127.0.0.1:18789'],
      },
      http: {
        endpoints: {
          chatCompletions: { enabled: true },
        },
      },
    },
    agents: {
      defaults: {
        skipBootstrap: true,
      },
    },
  };

  const configuredProviderId = template?.modelProvider?.id || OPENCLAW_MODEL_PROVIDER_ID;
  const providerBaseUrl = template?.modelProvider?.baseUrl || OPENCLAW_MODEL_PROVIDER_BASE_URL;
  const providerApiKey = template?.modelProvider?.apiKey || (OPENCLAW_MODEL_PROVIDER_API_KEY ? '${OPENCLAW_MODEL_PROVIDER_API_KEY}' : '');
  const providerApi = template?.modelProvider?.api || OPENCLAW_MODEL_PROVIDER_API;
  const configuredModel = template?.modelProvider?.model || OPENCLAW_DEFAULT_MODEL;
  if (!configuredProviderId || !providerBaseUrl || !configuredModel) {
    return config;
  }
  const { providerId, modelId } = splitOpenClawModelRef(configuredProviderId, configuredModel, providerApi);
  return mergeObject(config, {
    models: {
      mode: 'merge',
      providers: {
        [providerId]: {
          baseUrl: providerBaseUrl,
          ...(providerApiKey ? { apiKey: providerApiKey } : {}),
          api: providerApi,
          models: [
            {
              id: modelId,
              name: modelId,
              reasoning: true,
              input: ['text', 'image'],
              contextWindow: 262144,
              maxTokens: 32768,
              cost: {
                cacheRead: 0,
                cacheWrite: 0,
                input: 0,
                output: 0,
              },
            },
          ],
        },
      },
    },
    agents: {
      defaults: {
        skipBootstrap: true,
        model: { primary: `${providerId}/${modelId}` },
      },
    },
  });
}

function splitOpenClawModelRef(configuredProviderId: string, configuredModel: string, providerApi: string): { providerId: string; modelId: string } {
  const model = configuredModel.trim().replace(/^\/+|\/+$/g, '');
  if (providerApi !== 'anthropic-messages') {
    return {
      providerId: configuredProviderId,
      modelId: model,
    };
  }
  const slashIndex = model.indexOf('/');
  if (slashIndex > 0 && slashIndex < model.length - 1) {
    return {
      providerId: model.slice(0, slashIndex),
      modelId: model.slice(slashIndex + 1),
    };
  }
  return {
    providerId: configuredProviderId,
    modelId: model,
  };
}

async function writeDefaultRuntimeConfig(stateDir: string, identity: OpenClawRuntimeIdentity, template?: OpenClawRuntimeTemplate): Promise<void> {
  const patch = defaultRuntimeConfig(identity, template);
  const configPath = path.join(stateDir, 'openclaw.json');
  let existing: JsonObject = {};
  try {
    const content = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(content);
    if (isObject(parsed)) existing = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  if (isObject(existing.agents) && isObject(existing.agents.defaults)) {
    delete existing.agents.defaults.contextInjection;
    delete existing.agents.defaults.skills;
    delete existing.agents.defaults.systemPrompt;
    delete existing.agents.defaults.instructions;
  }

  await fs.writeFile(configPath, `${JSON.stringify(mergeObject(existing, patch), null, 2)}\n`);
}

function safeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) return 'README.md';
  return normalized;
}

function cleanSourceList(value?: string[]): string[] {
  return Array.isArray(value) ? value.map((item) => item.trim()).filter(Boolean) : [];
}

function cleanSecretEnv(value?: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  if (!value) return result;
  for (const [key, item] of Object.entries(value)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof item === 'string') {
      result[key] = item;
    }
  }
  return result;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => JSON.parse(stableJson(item))));
  if (!isObject(value)) return JSON.stringify(value);
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
}

function templateSecretHash(template?: OpenClawRuntimeTemplate): string {
  return shortHash(stableJson(cleanSecretEnv(template?.secretEnv)));
}

function templateWorkspaceHash(template: OpenClawRuntimeTemplate): string {
  return shortHash(stableJson({
    name: template.name ?? null,
    versionId: template.versionId ?? null,
    version: template.version ?? null,
    modelProvider: template.modelProvider ? {
      id: template.modelProvider.id,
      provider: template.modelProvider.provider,
      baseUrl: template.modelProvider.baseUrl ?? null,
      model: template.modelProvider.model ?? null,
      api: template.modelProvider.api ?? null,
    } : null,
    workspace: customWorkspaceFiles(template).map((file) => ({ path: safeRelativePath(file.path), content: file.content })),
    knowledgeBase: template.knowledgeBase ?? [],
    workspaceSources: cleanSourceList(template.workspaceSources),
    skillSources: cleanSourceList(template.skillSources),
    secretEnvKeys: Object.keys(cleanSecretEnv(template.secretEnv)).sort(),
  }));
}

interface GitHubTreeSource {
  owner: string;
  repo: string;
  branch: string;
  sourcePath: string;
}

function parseGitHubTreeSource(value: string): GitHubTreeSource | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.hostname !== 'github.com') return null;
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo] = parts;
  if (!owner || !repo) return null;
  const treeIndex = parts.indexOf('tree');
  if (treeIndex === -1) {
    return { owner, repo, branch: 'main', sourcePath: '' };
  }
  const branch = parts[treeIndex + 1];
  if (!branch) return null;
  return {
    owner,
    repo,
    branch,
    sourcePath: parts.slice(treeIndex + 2).join('/'),
  };
}

async function syncGitHubSource(
  workspaceDir: string,
  sourceUrl: string,
  mode: 'workspace' | 'skills',
): Promise<string[]> {
  const parsed = parseGitHubTreeSource(sourceUrl);
  if (!parsed) throw new Error(`Unsupported source URL: ${sourceUrl}`);
  const sourcePath = mode === 'skills' && !parsed.sourcePath ? 'skills' : parsed.sourcePath;
  const repoDir = await ensureGitHubSourceCache(parsed, sourcePath);
  const sourceRoot = path.join(repoDir, sourcePath);
  const files = await listFiles(sourceRoot);
  const written: string[] = [];
  for (const file of files) {
    const stat = await fs.stat(file);
    if (stat.size > 1024 * 1024) continue;
    const relative = safeRelativePath(path.relative(sourceRoot, file));
    if (!relative) continue;
    const targetRelative = mode === 'skills'
      ? path.posix.join('skills', sourcePath && sourcePath !== 'skills' ? path.posix.basename(sourcePath) : '', relative)
      : relative;
    const target = path.join(workspaceDir, safeRelativePath(targetRelative));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(file, target);
    written.push(targetRelative);
  }
  return written;
}

async function ensureGitHubSourceCache(source: GitHubTreeSource, sourcePath: string): Promise<string> {
  const cacheDir = path.resolve(OPENCLAW_DATA_DIR, 'cache', 'sources', shortHash([
    source.owner,
    source.repo,
    source.branch,
    sourcePath,
  ].join(':')));
  const repoDir = path.join(cacheDir, 'repo');
  try {
    await fs.access(path.join(repoDir, '.git'));
    return repoDir;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  await fs.rm(cacheDir, { recursive: true, force: true });
  await fs.mkdir(cacheDir, { recursive: true });
  const repoUrl = `https://github.com/${source.owner}/${source.repo}.git`;
  await execFileAsync('git', ['clone', '--depth', '1', '--branch', source.branch, '--filter=blob:none', '--sparse', repoUrl, repoDir], {
    maxBuffer: 1024 * 1024,
    timeout: DOCKER_TIMEOUT_MS,
  });
  const sparsePath = sourcePath.replace(/^\/+|\/+$/g, '');
  if (sparsePath) {
    await execFileAsync('git', ['-C', repoDir, 'sparse-checkout', 'set', sparsePath], {
      maxBuffer: 1024 * 1024,
      timeout: DOCKER_TIMEOUT_MS,
    });
  }
  return repoDir;
}

async function listFiles(root: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

async function writeTemplateWorkspace(workspaceDir: string, template?: OpenClawRuntimeTemplate): Promise<void> {
  if (!template) return;
  const root = path.join(workspaceDir, '.clawbot');
  await fs.mkdir(root, { recursive: true });
  const workspaceHash = templateWorkspaceHash(template);
  const manifestPath = path.join(root, 'manifest.json');
  try {
    const existing = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { workspaceHash?: unknown };
    if (existing.workspaceHash === workspaceHash) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  }

  const workspaceFiles = customWorkspaceFiles(template);
  const managedPaths = new Set<string>();
  for (const file of workspaceFiles) {
    const safePath = safeRelativePath(file.path);
    managedPaths.add(safePath.toLowerCase());
    const target = path.join(workspaceDir, safePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content);
  }
  await writeMissingDefaultWorkspaceFiles(workspaceDir, managedPaths);

  const knowledge = template.knowledgeBase ?? [];
  if (knowledge.length > 0) {
    await fs.writeFile(path.join(root, 'knowledge.md'), knowledge.map((item) =>
      `# ${item.title}\n\n${item.content}`,
    ).join('\n\n---\n\n') + '\n');
    await fs.mkdir(path.join(workspaceDir, 'docs'), { recursive: true });
    await fs.writeFile(path.join(workspaceDir, 'docs', 'knowledge.md'), knowledge.map((item) =>
      `# ${item.title}\n\n${item.content}`,
    ).join('\n\n---\n\n') + '\n');
  }

  const syncedWorkspaceFiles: string[] = [];
  for (const source of cleanSourceList(template.workspaceSources)) {
    syncedWorkspaceFiles.push(...await syncGitHubSource(workspaceDir, source, 'workspace'));
  }
  const syncedSkillFiles: string[] = [];
  for (const source of cleanSourceList(template.skillSources)) {
    syncedSkillFiles.push(...await syncGitHubSource(workspaceDir, source, 'skills'));
  }

  const manifest = {
    workspaceHash,
    name: template.name,
    versionId: template.versionId,
    version: template.version,
    modelProvider: template.modelProvider ? {
      id: template.modelProvider.id,
      provider: template.modelProvider.provider,
      baseUrl: template.modelProvider.baseUrl,
      model: template.modelProvider.model,
    } : null,
    workspaceFiles: workspaceFiles.map((file) => file.path),
    knowledgeItems: knowledge.map((item) => item.title),
    workspaceSources: cleanSourceList(template.workspaceSources),
    skillSources: cleanSourceList(template.skillSources),
    syncedWorkspaceFiles,
    syncedSkillFiles,
    secretEnvKeys: Object.keys(cleanSecretEnv(template.secretEnv)),
  };
  await fs.writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(root, 'version.json'), `${JSON.stringify({ versionId: template.versionId ?? null, version: template.version ?? null }, null, 2)}\n`);
}

async function writeMissingDefaultWorkspaceFiles(workspaceDir: string, managedPaths: Set<string>): Promise<void> {
  for (const file of OPENCLAW_DEFAULT_WORKSPACE) {
    const safePath = safeRelativePath(file.path);
    if (managedPaths.has(safePath.toLowerCase())) continue;
    const target = path.join(workspaceDir, safePath);
    try {
      await fs.access(target);
      continue;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content);
  }
}

function customWorkspaceFiles(template: OpenClawRuntimeTemplate): Array<{ path: string; content: string }> {
  const files = (template.workspace ?? []).filter((file) => file.path.trim());
  if (files.length !== 1) return files;
  const file = files[0]!;
  const filePath = file.path.trim().toLowerCase();
  const content = file.content.trim();
  if (filePath === 'readme.md' && (
    content === '# Workspace\n\nAgent workspace notes go here.'
    || content === '# README.md\nAgent workspace notes go here.'
  )) {
    return [];
  }
  return files;
}

async function inspectContainer(name: string): Promise<DockerInspect | null> {
  try {
    const out = await docker(['inspect', name]);
    return (JSON.parse(out) as DockerInspect[])[0] ?? null;
  } catch {
    return null;
  }
}

function getGatewayPort(inspect: DockerInspect): string | null {
  const bindings = inspect.NetworkSettings?.Ports?.['18789/tcp'];
  return bindings?.[0]?.HostPort ?? null;
}

function isConnectedToNetwork(inspect: DockerInspect, network: string): boolean {
  return Boolean(inspect.NetworkSettings?.Networks?.[network]);
}

function getRuntimeUrl(containerName: string, inspect: DockerInspect): string {
  if (OPENCLAW_DOCKER_NETWORK && isConnectedToNetwork(inspect, OPENCLAW_DOCKER_NETWORK)) {
    return `http://${containerName}:18789`;
  }

  const port = getGatewayPort(inspect);
  if (!port) throw new Error(`OpenClaw container ${containerName} has no published gateway port`);
  return `http://127.0.0.1:${port}`;
}

async function ensureNetwork(containerName: string, inspect: DockerInspect): Promise<DockerInspect> {
  if (!OPENCLAW_DOCKER_NETWORK || isConnectedToNetwork(inspect, OPENCLAW_DOCKER_NETWORK)) {
    return inspect;
  }

  await docker(['network', 'connect', OPENCLAW_DOCKER_NETWORK, containerName]);
  return (await inspectContainer(containerName)) ?? inspect;
}

async function waitForHealth(baseUrl: string): Promise<void> {
  const deadline = Date.now() + OPENCLAW_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    for (const path of ['/healthz', '/']) {
      try {
        const res = await fetch(`${baseUrl}${path}`, {
          signal: AbortSignal.timeout(2_000),
        });
        if (res.status < 500) return;
      } catch {
        // Container may still be booting.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`OpenClaw Docker runtime did not become ready at ${baseUrl}`);
}

async function createContainer(
  identity: OpenClawRuntimeIdentity,
  name: string,
  stateDir: string,
  workspaceDir: string,
  runtimeDepsDir: string | null,
  secretEnv: Record<string, string> = {},
): Promise<void> {
  const envArgs = [
    '-e', 'HOME=/home/node',
    '-e', 'TERM=xterm-256color',
    '-e', `TZ=${process.env.OPENCLAW_TZ ?? process.env.TZ ?? 'UTC'}`,
  ];
  if (OPENCLAW_GATEWAY_TOKEN) {
    envArgs.push('-e', `OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN}`);
  }
  if (OPENCLAW_MODEL_PROVIDER_API_KEY) {
    envArgs.push('-e', `OPENCLAW_MODEL_PROVIDER_API_KEY=${OPENCLAW_MODEL_PROVIDER_API_KEY}`);
  }
  for (const [key, value] of Object.entries(cleanSecretEnv(secretEnv))) {
    envArgs.push('-e', `${key}=${value}`);
  }

  await docker([
    'run',
    '-d',
    '--name', name,
    '--restart', process.env.OPENCLAW_DOCKER_RESTART ?? 'unless-stopped',
    '--init',
    '--cap-drop', 'NET_RAW',
    '--cap-drop', 'NET_ADMIN',
    '--security-opt', 'no-new-privileges:true',
    ...(OPENCLAW_DOCKER_NETWORK ? ['--network', OPENCLAW_DOCKER_NETWORK] : []),
    '--label', 'clawscale.openclaw=true',
    '--label', `clawscale.tenantId=${identity.tenantId}`,
    '--label', `clawscale.channelId=${identity.channelId}`,
    '--label', `clawscale.endUserId=${identity.endUserId}`,
    '--label', `clawscale.backendId=${identity.backendId}`,
    '--label', `clawscale.secretEnvHash=${shortHash(stableJson(cleanSecretEnv(secretEnv)))}`,
    '-p', '127.0.0.1::18789',
    '-p', '127.0.0.1::18790',
    '-v', `${stateDir}:/home/node/.openclaw`,
    ...(runtimeDepsDir ? ['-v', `${runtimeDepsDir}:/home/node/.openclaw/plugin-runtime-deps`] : []),
    '-v', `${workspaceDir}:/home/node/.openclaw/workspace`,
    ...envArgs,
    OPENCLAW_IMAGE,
    'node',
    'openclaw.mjs',
    'gateway',
    '--allow-unconfigured',
    '--bind',
    'lan',
    '--port',
    '18789',
  ]);
}

async function doEnsureOpenClawDockerRuntime(identity: OpenClawRuntimeIdentity, template?: OpenClawRuntimeTemplate): Promise<OpenClawDockerRuntime> {
  const startedAt = Date.now();
  let configMs = 0;
  let workspaceMs = 0;
  let chownMs = 0;
  let containerMs = 0;
  let waitMs = 0;
  const containerName = openClawContainerName(identity);
  const { stateDir, workspaceDir } = openClawRuntimeDirs(identity);
  const runtimeDepsDir = OPENCLAW_SHARED_RUNTIME_DEPS ? openClawSharedRuntimeDepsDir() : null;
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });
  if (runtimeDepsDir) await fs.mkdir(runtimeDepsDir, { recursive: true });

  let inspect = await inspectContainer(containerName);
  const expectedSecretHash = templateSecretHash(template);
  const actualSecretHash = inspect?.Config?.Labels?.['clawscale.secretEnvHash'];
  if (inspect && actualSecretHash !== expectedSecretHash) {
    await docker(['rm', '-f', containerName]);
    inspect = null;
  }
  if (!inspect) {
    let stepAt = Date.now();
    await writeDefaultRuntimeConfig(stateDir, identity, template);
    configMs += Date.now() - stepAt;
    stepAt = Date.now();
    await writeTemplateWorkspace(workspaceDir, template);
    workspaceMs += Date.now() - stepAt;
    stepAt = Date.now();
    await chownRecursive(stateDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
    await chownRecursive(workspaceDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
    if (runtimeDepsDir) await chownRecursive(runtimeDepsDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
    chownMs += Date.now() - stepAt;
    stepAt = Date.now();
    await createContainer(identity, containerName, stateDir, workspaceDir, runtimeDepsDir, cleanSecretEnv(template?.secretEnv));
    containerMs += Date.now() - stepAt;
    inspect = await inspectContainer(containerName);
  } else if (!inspect.State?.Running) {
    let stepAt = Date.now();
    await writeDefaultRuntimeConfig(stateDir, identity, template);
    configMs += Date.now() - stepAt;
    stepAt = Date.now();
    await writeTemplateWorkspace(workspaceDir, template);
    workspaceMs += Date.now() - stepAt;
    stepAt = Date.now();
    await chownRecursive(stateDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
    await chownRecursive(workspaceDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
    if (runtimeDepsDir) await chownRecursive(runtimeDepsDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
    chownMs += Date.now() - stepAt;
    stepAt = Date.now();
    await docker(['start', containerName]);
    containerMs += Date.now() - stepAt;
    inspect = await inspectContainer(containerName);
  } else {
    let stepAt = Date.now();
    await writeDefaultRuntimeConfig(stateDir, identity, template);
    configMs += Date.now() - stepAt;
    stepAt = Date.now();
    await writeTemplateWorkspace(workspaceDir, template);
    workspaceMs += Date.now() - stepAt;
    stepAt = Date.now();
    await chownRecursive(stateDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
    await chownRecursive(workspaceDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
    chownMs += Date.now() - stepAt;
  }

  if (!inspect) throw new Error(`Failed to inspect OpenClaw container ${containerName}`);
  inspect = await ensureNetwork(containerName, inspect);
  const baseUrl = getRuntimeUrl(containerName, inspect);

  const waitStartedAt = Date.now();
  await waitForHealth(baseUrl);
  waitMs += Date.now() - waitStartedAt;
  const totalMs = Date.now() - startedAt;
  console.log(`[openclaw] Runtime ready ${containerName} in ${totalMs}ms (config=${configMs}ms workspace=${workspaceMs}ms chown=${chownMs}ms container=${containerMs}ms wait=${waitMs}ms)`);
  return {
    baseUrl,
    containerName,
    gatewayToken: openClawGatewayToken(identity),
    stateDir,
    workspaceDir,
    timings: { totalMs, configMs, workspaceMs, chownMs, containerMs, waitMs },
  };
}

export async function ensureOpenClawDockerRuntime(identity: OpenClawRuntimeIdentity, template?: OpenClawRuntimeTemplate): Promise<OpenClawDockerRuntime> {
  const key = openClawContainerName(identity);
  const existing = ensureTasks.get(key);
  if (existing) return existing;

  const task = doEnsureOpenClawDockerRuntime(identity, template);
  ensureTasks.set(key, task);
  try {
    return await task;
  } finally {
    ensureTasks.delete(key);
  }
}

export function prewarmOpenClawDockerRuntime(identity: OpenClawRuntimeIdentity, template?: OpenClawRuntimeTemplate): void {
  const key = openClawContainerName(identity);
  if (prewarmTasks.has(key)) return;

  const task = (async () => {
    const startedAt = Date.now();
    try {
      const runtime = await ensureOpenClawDockerRuntime(identity, template);
      const headers = {
        Authorization: `Bearer ${runtime.gatewayToken}`,
        'Content-Type': 'application/json',
        'x-openclaw-scopes': 'operator.read,operator.write',
      };

      await fetch(`${runtime.baseUrl}/v1/models`, {
        headers,
        signal: AbortSignal.timeout(30_000),
      });

      if (OPENCLAW_PREWARM_CHAT) {
        await fetch(`${runtime.baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: 'openclaw/default',
            messages: [{ role: 'user', content: 'Reply with OK.' }],
            max_completion_tokens: 8,
            user: '__clawscale_prewarm__',
          }),
          signal: AbortSignal.timeout(180_000),
        });
      }

      console.log(`[openclaw] Prewarmed ${runtime.containerName} in ${Date.now() - startedAt}ms`);
    } catch (error) {
      console.warn(`[openclaw] Prewarm failed for ${key}:`, error);
      prewarmTasks.delete(key);
    }
  })();

  prewarmTasks.set(key, task);
}
