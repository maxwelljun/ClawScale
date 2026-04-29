import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface OpenClawRuntimeContext {
  tenantId: string;
  channelId: string;
  endUserId: string;
  backendId: string;
}

interface RuntimeInstance {
  baseUrl: string;
  port: number;
  profile: string;
  stateDir: string;
  workspaceDir: string;
  proc: ChildProcessWithoutNullStreams;
  ready: Promise<void>;
}

const instances = new Map<string, RuntimeInstance>();
let cleanupRegistered = false;

export function isOpenClawBinEnabled(): boolean {
  return Boolean(process.env.OPENCLAW_BIN?.trim());
}

export async function getOpenClawRuntime(ctx: OpenClawRuntimeContext): Promise<{ baseUrl: string }> {
  const bin = process.env.OPENCLAW_BIN?.trim();
  if (!bin) throw new Error('OPENCLAW_BIN is not configured');

  const key = runtimeKey(ctx);
  const existing = instances.get(key);
  if (existing && !existing.proc.killed && existing.proc.exitCode == null) {
    await existing.ready;
    return { baseUrl: existing.baseUrl };
  }

  const paths = resolveRuntimePaths(ctx);
  await prepareRuntimeConfig(paths);

  const proc = spawn(bin, buildArgs(paths), {
    cwd: paths.workspaceDir,
    env: {
      ...process.env,
      HOME: paths.stateHomeDir,
      OPENCLAW_PROFILE: paths.profile,
      OPENCLAW_STATE_DIR: paths.profileStateDir,
      OPENCLAW_WORKSPACE_DIR: paths.workspaceDir,
      OPENCLAW_GATEWAY_PORT: String(paths.port),
      NO_COLOR: process.env.NO_COLOR ?? '1',
    },
  });

  proc.stdout.on('data', (chunk) => {
    console.log(`[openclaw:${paths.profile}] ${String(chunk).trimEnd()}`);
  });
  proc.stderr.on('data', (chunk) => {
    console.warn(`[openclaw:${paths.profile}] ${String(chunk).trimEnd()}`);
  });
  const startupError = new Promise<never>((_, reject) => {
    proc.once('error', (err) => {
      const current = instances.get(key);
      if (current?.proc === proc) instances.delete(key);
      console.error(`[openclaw:${paths.profile}] failed to start ${bin}: ${formatError(err)}`);
      reject(err);
    });
  });
  proc.on('exit', (code, signal) => {
    const current = instances.get(key);
    if (current?.proc === proc) instances.delete(key);
    console.warn(`[openclaw:${paths.profile}] exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
  });

  const instance: RuntimeInstance = {
    baseUrl: `http://127.0.0.1:${paths.port}`,
    port: paths.port,
    profile: paths.profile,
    stateDir: paths.profileStateDir,
    workspaceDir: paths.workspaceDir,
    proc,
    ready: Promise.race([waitForGateway(`http://127.0.0.1:${paths.port}`, proc), startupError]),
  };
  instances.set(key, instance);
  registerCleanup();

  await instance.ready;
  return { baseUrl: instance.baseUrl };
}

function runtimeKey(ctx: OpenClawRuntimeContext): string {
  return [ctx.tenantId, ctx.channelId, ctx.endUserId, ctx.backendId].join(':');
}

function resolveRuntimePaths(ctx: OpenClawRuntimeContext) {
  const profile = `clawscale-${shortHash(runtimeKey(ctx))}`;
  const dataRoot = path.resolve(process.env.OPENCLAW_DATA_DIR ?? './data/tenants');
  const instanceDir = path.join(
    dataRoot,
    safeSegment(ctx.tenantId),
    safeSegment(ctx.channelId),
    safeSegment(ctx.endUserId),
    safeSegment(ctx.backendId),
  );
  const stateHomeDir = path.join(instanceDir, 'state');
  const profileStateDir = path.join(stateHomeDir, `.openclaw-${profile}`);
  const workspaceDir = path.join(instanceDir, 'workspace');
  const portBase = parseInt(process.env.OPENCLAW_PORT_BASE ?? '19000', 10);
  const port = (Number.isFinite(portBase) ? portBase : 19000) + (hashNumber(runtimeKey(ctx)) % 10000);
  return { profile, instanceDir, stateHomeDir, profileStateDir, workspaceDir, port };
}

async function prepareRuntimeConfig(paths: ReturnType<typeof resolveRuntimePaths>): Promise<void> {
  await mkdir(paths.profileStateDir, { recursive: true });
  await mkdir(paths.workspaceDir, { recursive: true });

  const configPath = path.join(paths.profileStateDir, 'openclaw.json');
  const existing = await readJsonObject(configPath);
  const config = {
    ...existing,
    gateway: {
      ...objectValue(existing.gateway),
      mode: typeof objectValue(existing.gateway).mode === 'string'
        ? objectValue(existing.gateway).mode
        : 'local',
      port: paths.port,
    },
    agents: {
      ...objectValue(existing.agents),
      defaults: {
        ...objectValue(objectValue(existing.agents).defaults),
        workspace: paths.workspaceDir,
      },
    },
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

function buildArgs(paths: ReturnType<typeof resolveRuntimePaths>): string[] {
  const template = process.env.OPENCLAW_ARGS?.trim() || '--profile {profile} gateway --port {port}';
  return splitArgs(template).map((arg) =>
    arg
      .replaceAll('{profile}', paths.profile)
      .replaceAll('{port}', String(paths.port))
      .replaceAll('{stateDir}', paths.profileStateDir)
      .replaceAll('{workspaceDir}', paths.workspaceDir),
  );
}

function splitArgs(input: string): string[] {
  const args: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (const ch of input) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        args.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (escaped) current += '\\';
  if (quote) throw new Error(`OPENCLAW_ARGS has an unterminated ${quote} quote`);
  if (current) args.push(current);
  return args;
}

async function waitForGateway(baseUrl: string, proc: ChildProcessWithoutNullStreams): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    if (proc.exitCode != null) {
      throw new Error(`OpenClaw gateway exited before becoming ready (code ${proc.exitCode})`);
    }
    try {
      const res = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(1000) });
      if (res.status < 500) return;
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`OpenClaw gateway did not become ready at ${baseUrl}: ${formatError(lastError)}`);
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_') || '_';
}

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function hashNumber(value: string): number {
  return parseInt(createHash('sha256').update(value).digest('hex').slice(0, 8), 16);
}

function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function registerCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  const cleanup = () => {
    for (const instance of instances.values()) {
      if (instance.proc.exitCode == null) instance.proc.kill('SIGTERM');
    }
  };
  process.once('exit', cleanup);
  process.once('SIGINT', () => {
    cleanup();
    process.exit(130);
  });
  process.once('SIGTERM', () => {
    cleanup();
    process.exit(143);
  });
}
