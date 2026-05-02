import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface OpenClawRuntimeIdentity {
  tenantId: string;
  channelId: string;
  endUserId: string;
  backendId: string;
}

interface DockerInspect {
  State?: { Running?: boolean };
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
  systemPrompt?: string | null;
  skills?: Array<{ name: string; description?: string; enabled?: boolean }>;
  workspace?: Array<{ path: string; content: string }>;
  knowledgeBase?: Array<{ title: string; content: string }>;
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

  const providerId = template?.modelProvider?.id || OPENCLAW_MODEL_PROVIDER_ID;
  const providerBaseUrl = template?.modelProvider?.baseUrl || OPENCLAW_MODEL_PROVIDER_BASE_URL;
  const providerApiKey = template?.modelProvider?.apiKey || (OPENCLAW_MODEL_PROVIDER_API_KEY ? '${OPENCLAW_MODEL_PROVIDER_API_KEY}' : '');
  const providerApi = template?.modelProvider?.api || OPENCLAW_MODEL_PROVIDER_API;
  const defaultModel = template?.modelProvider?.model || OPENCLAW_DEFAULT_MODEL;
  if (!providerId || !providerBaseUrl || !defaultModel) {
    return config;
  }

  return mergeObject(config, {
    models: {
      providers: {
        [providerId]: {
          baseUrl: providerBaseUrl,
          ...(providerApiKey ? { apiKey: providerApiKey } : {}),
          api: providerApi,
          models: [
            {
              id: defaultModel,
              name: defaultModel,
              reasoning: true,
              input: ['text'],
              contextWindow: 200000,
              maxTokens: 8192,
            },
          ],
        },
      },
    },
    agents: {
      defaults: {
        skipBootstrap: true,
        model: { primary: `${providerId}/${defaultModel}` },
        ...(template?.systemPrompt ? { systemPrompt: template.systemPrompt, instructions: template.systemPrompt } : {}),
      },
    },
  });
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
  }

  await fs.writeFile(configPath, `${JSON.stringify(mergeObject(existing, patch), null, 2)}\n`);
}

function safeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..')) return 'README.md';
  return normalized;
}

async function writeTemplateWorkspace(workspaceDir: string, template?: OpenClawRuntimeTemplate): Promise<void> {
  if (!template) return;
  const root = path.join(workspaceDir, '.clawbot');
  await fs.mkdir(root, { recursive: true });

  const workspaceFiles = template.workspace ?? [];
  const managedPaths = new Set<string>();
  for (const file of workspaceFiles) {
    const safePath = safeRelativePath(file.path);
    managedPaths.add(safePath);
    const target = path.join(workspaceDir, safePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, file.content);
  }

  await writeManagedMarkdown(workspaceDir, managedPaths, 'IDENTITY.md', identityMarkdown(template));
  await writeManagedMarkdown(workspaceDir, managedPaths, 'SOUL.md', soulMarkdown(template));
  await writeManagedMarkdown(workspaceDir, managedPaths, 'AGENTS.md', agentsMarkdown(template));
  await writeManagedMarkdown(workspaceDir, managedPaths, 'TOOLS.md', toolsMarkdown(template));
  await writeManagedMarkdown(workspaceDir, managedPaths, 'USER.md', userMarkdown());

  const skills = (template.skills ?? []).filter((skill) => skill.enabled !== false);
  if (skills.length > 0) {
    await fs.writeFile(path.join(root, 'skills.md'), skills.map((skill) =>
      `- ${skill.name}${skill.description ? `: ${skill.description}` : ''}`,
    ).join('\n') + '\n');
    for (const skill of skills) {
      const skillDir = path.join(workspaceDir, 'skills', safeRelativePath(skill.name));
      await fs.mkdir(skillDir, { recursive: true });
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillMarkdown(skill));
    }
  }

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

  const manifest = {
    name: template.name,
    versionId: template.versionId,
    version: template.version,
    modelProvider: template.modelProvider ? {
      id: template.modelProvider.id,
      provider: template.modelProvider.provider,
      baseUrl: template.modelProvider.baseUrl,
      model: template.modelProvider.model,
    } : null,
    skills: skills.map((skill) => skill.name),
    workspaceFiles: workspaceFiles.map((file) => file.path),
    knowledgeItems: knowledge.map((item) => item.title),
  };
  await fs.writeFile(path.join(root, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await fs.writeFile(path.join(root, 'version.json'), `${JSON.stringify({ versionId: template.versionId ?? null, version: template.version ?? null }, null, 2)}\n`);
}

async function writeManagedMarkdown(workspaceDir: string, existing: Set<string>, file: string, content: string): Promise<void> {
  if (existing.has(file)) return;
  await fs.writeFile(path.join(workspaceDir, file), content);
}

function identityMarkdown(template: OpenClawRuntimeTemplate): string {
  return `# Identity\n\nName: ${template.name ?? 'ClawBot Agent'}\n`;
}

function soulMarkdown(template: OpenClawRuntimeTemplate): string {
  return `# Soul\n\n${template.systemPrompt?.trim() || 'Follow the channel agent template instructions and respond helpfully.'}\n`;
}

function agentsMarkdown(template: OpenClawRuntimeTemplate): string {
  const model = template.modelProvider?.model ? `\nDefault model: ${template.modelProvider.model}` : '';
  return `# Agent Operating Instructions\n\nYou are running inside an isolated ClawBot-managed OpenClaw runtime.${model}\n\nUse this workspace as the source of truth for this user, channel, and agent instance. Preserve user memory and session state inside this runtime.\n`;
}

function toolsMarkdown(template: OpenClawRuntimeTemplate): string {
  const skills = (template.skills ?? []).filter((skill) => skill.enabled !== false).map((skill) => `- ${skill.name}${skill.description ? `: ${skill.description}` : ''}`);
  return `# Tools\n\n${skills.length > 0 ? skills.join('\n') : 'Use only the tools enabled by the runtime configuration.'}\n`;
}

function userMarkdown(): string {
  return '# User\n\nThis file is managed per isolated runtime. Learn user preferences from conversation and runtime memory.\n';
}

function skillMarkdown(skill: { name: string; description?: string }): string {
  return `# ${skill.name}\n\n${skill.description || `Use the ${skill.name} capability when it is relevant to the user's request.`}\n`;
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
  const containerName = openClawContainerName(identity);
  const { stateDir, workspaceDir } = openClawRuntimeDirs(identity);
  const runtimeDepsDir = OPENCLAW_SHARED_RUNTIME_DEPS ? openClawSharedRuntimeDepsDir() : null;
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });
  if (runtimeDepsDir) await fs.mkdir(runtimeDepsDir, { recursive: true });

  let inspect = await inspectContainer(containerName);
  if (!inspect) {
    await writeDefaultRuntimeConfig(stateDir, identity, template);
    await writeTemplateWorkspace(workspaceDir, template);
    await chownRecursive(stateDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
    await chownRecursive(workspaceDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
    if (runtimeDepsDir) await chownRecursive(runtimeDepsDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
    await createContainer(identity, containerName, stateDir, workspaceDir, runtimeDepsDir);
    inspect = await inspectContainer(containerName);
  } else if (!inspect.State?.Running) {
    await writeDefaultRuntimeConfig(stateDir, identity, template);
    await writeTemplateWorkspace(workspaceDir, template);
    await chownRecursive(stateDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
    await chownRecursive(workspaceDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
    if (runtimeDepsDir) await chownRecursive(runtimeDepsDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
    await docker(['start', containerName]);
    inspect = await inspectContainer(containerName);
  } else {
    await writeDefaultRuntimeConfig(stateDir, identity, template);
    await writeTemplateWorkspace(workspaceDir, template);
    await chownRecursive(stateDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
    await chownRecursive(workspaceDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
  }

  if (!inspect) throw new Error(`Failed to inspect OpenClaw container ${containerName}`);
  inspect = await ensureNetwork(containerName, inspect);
  const baseUrl = getRuntimeUrl(containerName, inspect);

  await waitForHealth(baseUrl);
  return {
    baseUrl,
    containerName,
    gatewayToken: openClawGatewayToken(identity),
    stateDir,
    workspaceDir,
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
