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
  await fs.chown(target, uid, gid);
  const entries = await fs.readdir(target, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      await chownRecursive(entryPath, uid, gid);
      return;
    }
    await fs.chown(entryPath, uid, gid);
  }));
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

async function waitForHealth(port: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    for (const path of ['/healthz', '/']) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}${path}`, {
          signal: AbortSignal.timeout(2_000),
        });
        if (res.status < 500) return;
      } catch {
        // Container may still be booting.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`OpenClaw Docker runtime did not become ready on port ${port}`);
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

  await docker([
    'run',
    '-d',
    '--name', name,
    '--restart', process.env.OPENCLAW_DOCKER_RESTART ?? 'unless-stopped',
    '--init',
    '--cap-drop', 'NET_RAW',
    '--cap-drop', 'NET_ADMIN',
    '--security-opt', 'no-new-privileges:true',
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
  await chownRecursive(stateDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);
  await chownRecursive(workspaceDir, OPENCLAW_CONTAINER_UID, OPENCLAW_CONTAINER_GID);

  let inspect = await inspectContainer(containerName);
  if (!inspect) {
    await createContainer(identity, containerName, stateDir, workspaceDir);
    inspect = await inspectContainer(containerName);
  } else if (!inspect.State?.Running) {
    await docker(['start', containerName]);
    inspect = await inspectContainer(containerName);
  }

  if (!inspect) throw new Error(`Failed to inspect OpenClaw container ${containerName}`);
  const port = getGatewayPort(inspect);
  if (!port) throw new Error(`OpenClaw container ${containerName} has no published gateway port`);

  await waitForHealth(port);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    containerName,
    stateDir,
    workspaceDir,
  };
}
