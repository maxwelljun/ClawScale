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
  stateDir: string;
  workspaceDir: string;
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

export function openClawContainerName(identity: OpenClawRuntimeIdentity): string {
  return `clawscale-openclaw-${shortHash([
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

function defaultModelConfig(): JsonObject | null {
  if (!OPENCLAW_MODEL_PROVIDER_ID || !OPENCLAW_MODEL_PROVIDER_BASE_URL || !OPENCLAW_DEFAULT_MODEL) {
    return null;
  }

  return {
    models: {
      providers: {
        [OPENCLAW_MODEL_PROVIDER_ID]: {
          baseUrl: OPENCLAW_MODEL_PROVIDER_BASE_URL,
          apiKey: '${OPENCLAW_MODEL_PROVIDER_API_KEY}',
          api: OPENCLAW_MODEL_PROVIDER_API,
          models: [
            {
              id: OPENCLAW_DEFAULT_MODEL,
              name: OPENCLAW_DEFAULT_MODEL,
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
        model: { primary: `${OPENCLAW_MODEL_PROVIDER_ID}/${OPENCLAW_DEFAULT_MODEL}` },
      },
    },
  };
}

async function writeDefaultModelConfig(stateDir: string): Promise<void> {
  const patch = defaultModelConfig();
  if (!patch) return;

  const configPath = path.join(stateDir, 'openclaw.json');
  let existing: JsonObject = {};
  try {
    const content = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(content);
    if (isObject(parsed)) existing = parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  await fs.writeFile(configPath, `${JSON.stringify(mergeObject(existing, patch), null, 2)}\n`);
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
  const deadline = Date.now() + 60_000;
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

async function createContainer(identity: OpenClawRuntimeIdentity, name: string, stateDir: string, workspaceDir: string): Promise<void> {
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

export async function ensureOpenClawDockerRuntime(identity: OpenClawRuntimeIdentity): Promise<OpenClawDockerRuntime> {
  const containerName = openClawContainerName(identity);
  const { stateDir, workspaceDir } = openClawRuntimeDirs(identity);
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(workspaceDir, { recursive: true });

  let inspect = await inspectContainer(containerName);
  if (!inspect) {
    await writeDefaultModelConfig(stateDir);
    await chownRecursive(stateDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
    await chownRecursive(workspaceDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
    await createContainer(identity, containerName, stateDir, workspaceDir);
    inspect = await inspectContainer(containerName);
  } else if (!inspect.State?.Running) {
    await writeDefaultModelConfig(stateDir);
    await chownRecursive(stateDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
    await chownRecursive(workspaceDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
    await docker(['start', containerName]);
    inspect = await inspectContainer(containerName);
  }

  if (!inspect) throw new Error(`Failed to inspect OpenClaw container ${containerName}`);
  inspect = await ensureNetwork(containerName, inspect);
  const baseUrl = getRuntimeUrl(containerName, inspect);

  await waitForHealth(baseUrl);
  return {
    baseUrl,
    containerName,
    stateDir,
    workspaceDir,
  };
}
