import type { IncomingMessage, Server } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Router } from 'express';
import { z } from 'zod';
import { WebSocketServer, WebSocket } from 'ws';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { openClawContainerName, openClawRuntimeDirs } from '../lib/openclaw-docker.js';
import { validate } from '../middleware/validate.js';
import { verifyToken } from '../lib/jwt.js';

const execFileAsync = promisify(execFile);
const containerNamePattern = /^clawscale-openclaw-[a-f0-9]{12}$/;
const execSchema = z.object({
  command: z.string().min(1).max(500).default('pwd'),
});
const configPatchSchema = z.object({
  modelProviderId: z.string().min(1),
  model: z.string().min(1).max(160),
});

export const agentInstancesRouter = Router();
agentInstancesRouter.use(requireAuth);

agentInstancesRouter.get('/', async (req, res) => {
  const { tenantId } = req.auth!;
  const rows = await db.conversation.findMany({
    where: { tenantId, backendId: { not: null } },
    include: {
      channel: { select: { id: true, name: true, type: true } },
      endUser: { select: { id: true, externalId: true, name: true, email: true } },
      backend: { select: { id: true, name: true, runtimeType: true, type: true } },
      modelProvider: { select: { id: true, name: true, provider: true } },
      agentTemplateVersion: { select: { id: true, version: true, name: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { createdAt: true, metadata: true } },
    },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  });

  const seen = new Set<string>();
  const instances = [];
  for (const row of rows) {
    if (!row.backendId) continue;
    const identity = {
      tenantId,
      channelId: row.channelId,
      endUserId: row.endUserId,
      backendId: row.backendId,
    };
    const key = [identity.tenantId, identity.channelId, identity.endUserId, identity.backendId].join(':');
    if (seen.has(key)) continue;
    seen.add(key);
    const containerName = openClawContainerName(identity);
    const dirs = openClawRuntimeDirs(identity);
    instances.push({
      id: key,
      tenantId,
      channel: row.channel,
      endUser: row.endUser,
      backend: row.backend,
      modelProvider: row.modelProvider,
      agentTemplateVersion: row.agentTemplateVersion,
      conversationId: row.id,
      containerName,
      runtime: await inspectContainer(containerName),
      stateDir: dirs.stateDir,
      workspaceDir: dirs.workspaceDir,
      lastMessageAt: row.messages[0]?.createdAt ?? row.updatedAt,
      lastLatencyMs: readLatency(row.messages[0]?.metadata),
    });
  }

  res.json({ ok: true, data: instances });
});

agentInstancesRouter.get('/:containerName/config', requireAdmin, async (req, res) => {
  const containerName = req.params.containerName as string;
  if (!isRuntimeContainer(containerName, res)) return;
  const identity = await readIdentity(containerName);
  const dirs = identity ? openClawRuntimeDirs(identity) : null;
  const [inspect, openclawConfig, manifest, version, modelProviders] = await Promise.all([
    inspectRaw(containerName),
    dirs ? readJsonFile(path.join(dirs.stateDir, 'openclaw.json')) : null,
    dirs ? readJsonFile(path.join(dirs.workspaceDir, '.clawbot', 'manifest.json')) : null,
    dirs ? readJsonFile(path.join(dirs.workspaceDir, '.clawbot', 'version.json')) : null,
    identity ? db.modelProvider.findMany({
      where: { tenantId: identity.tenantId, isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, provider: true, baseUrl: true, models: true, config: true },
    }) : [],
  ]);
  res.json({
    ok: true,
    data: {
      identity,
      dirs,
      inspect: simplifyInspect(inspect),
      openclawConfig: redactConfig(openclawConfig),
      currentModel: readCurrentModel(openclawConfig),
      manifest,
      version,
      modelProviders,
    },
  });
});

agentInstancesRouter.patch('/:containerName/config', requireAdmin, validate(configPatchSchema), async (req, res) => {
  const containerName = req.params.containerName as string;
  if (!isRuntimeContainer(containerName, res)) return;
  const identity = await readIdentity(containerName);
  if (!identity) { res.status(404).json({ ok: false, error: 'Runtime identity not found' }); return; }
  const provider = await db.modelProvider.findFirst({
    where: { id: req.body.modelProviderId, tenantId: identity.tenantId, isActive: true },
  });
  if (!provider) { res.status(404).json({ ok: false, error: 'Model provider not found' }); return; }
  const dirs = openClawRuntimeDirs(identity);
  const configPath = path.join(dirs.stateDir, 'openclaw.json');
  const existing = await readJsonFile(configPath);
  const config = isObject(existing) ? existing : {};
  const providerApi = readProviderApi(provider.provider, provider.config);
  config.models = {
    ...(isObject(config.models) ? config.models : {}),
    providers: {
      ...(isObject((config.models as Record<string, unknown>).providers) ? (config.models as Record<string, Record<string, unknown>>).providers : {}),
      [provider.id]: {
        baseUrl: provider.baseUrl,
        ...(provider.apiKey ? { apiKey: provider.apiKey } : {}),
        api: providerApi,
        models: [{
          id: req.body.model,
          name: req.body.model,
          reasoning: true,
          input: ['text'],
          contextWindow: 200000,
          maxTokens: 8192,
        }],
      },
    },
  };
  config.agents = {
    ...(isObject(config.agents) ? config.agents : {}),
    defaults: {
      ...(isObject((config.agents as Record<string, unknown>).defaults) ? (config.agents as Record<string, unknown>).defaults as Record<string, unknown> : {}),
      model: { primary: `${provider.id}/${req.body.model}` },
    },
  };
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  res.json({ ok: true, data: { openclawConfig: redactConfig(config), currentModel: readCurrentModel(config) } });
});

agentInstancesRouter.get('/:containerName/logs', requireAdmin, async (req, res) => {
  const containerName = req.params.containerName as string;
  if (!isRuntimeContainer(containerName, res)) return;
  const tail = String(req.query.tail ?? '300').replace(/\D/g, '') || '300';
  try {
    const { stdout, stderr } = await execFileAsync('docker', ['logs', '--tail', tail, containerName], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024 * 4,
    });
    res.json({ ok: true, data: { logs: `${stdout}${stderr}` } });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

agentInstancesRouter.post('/:containerName/exec', requireAdmin, validate(execSchema), async (req, res) => {
  const containerName = req.params.containerName as string;
  if (!isRuntimeContainer(containerName, res)) return;
  try {
    const { stdout, stderr } = await execFileAsync('docker', ['exec', containerName, 'sh', '-lc', req.body.command], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    res.json({ ok: true, data: { stdout, stderr, output: `${stdout}${stderr}` } });
  } catch (error: unknown) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    res.status(500).json({ ok: false, error: `${err.stdout ?? ''}${err.stderr ?? err.message ?? String(error)}` });
  }
});

agentInstancesRouter.post('/:containerName/:action', requireAdmin, async (req, res) => {
  const containerName = req.params.containerName as string;
  const action = req.params.action as string;
  if (!isRuntimeContainer(containerName, res)) return;
  if (!['start', 'stop', 'restart'].includes(action)) {
    res.status(400).json({ ok: false, error: 'Unsupported runtime action' });
    return;
  }
  await execFileAsync('docker', [action, containerName], { timeout: 60_000 });
  res.json({ ok: true, data: await inspectContainer(containerName) });
});

agentInstancesRouter.delete('/:containerName', requireAdmin, async (req, res) => {
  const containerName = req.params.containerName as string;
  if (!isRuntimeContainer(containerName, res)) return;
  const identity = await readIdentity(containerName);
  await execFileAsync('docker', ['rm', '-f', containerName], { timeout: 60_000 }).catch(() => undefined);
  if (req.query.data === 'true' && identity) {
    const dirs = openClawRuntimeDirs(identity);
    await Promise.all([
      fs.rm(dirs.stateDir, { recursive: true, force: true }),
      fs.rm(dirs.workspaceDir, { recursive: true, force: true }),
    ]);
  }
  res.json({ ok: true, data: null });
});

export function initAgentTerminalWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);
    if (url.pathname !== '/api/agent-instances/terminal') return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      void handleTerminalConnection(ws, url);
    });
  });
  console.log('[agent-terminal] WebSocket terminal endpoint ready at /api/agent-instances/terminal');
}

async function handleTerminalConnection(ws: WebSocket, url: URL): Promise<void> {
  const token = url.searchParams.get('token') ?? '';
  const containerName = url.searchParams.get('container') ?? '';
  const shell = url.searchParams.get('shell') || 'sh';
  try {
    const payload = verifyToken(token);
    if (payload.role !== 'admin') throw new Error('Admin role required');
    if (!containerNamePattern.test(containerName)) throw new Error('Invalid runtime container');
    const identity = await readIdentity(containerName);
    if (!identity || identity.tenantId !== payload.tid) throw new Error('Runtime not found');
    const safeShell = shell === 'bash' ? 'bash' : 'sh';
    const child = spawn('docker', ['exec', '-i', containerName, safeShell, '-lc', `cd /home/node/.openclaw/workspace 2>/dev/null || cd /home/node/.openclaw 2>/dev/null || cd /; exec ${safeShell} -i`], { stdio: ['pipe', 'pipe', 'pipe'] });
    ws.send(`Connected to ${containerName} (${safeShell})\n`);
    child.stdout.on('data', (chunk) => ws.readyState === WebSocket.OPEN && ws.send(chunk.toString()));
    child.stderr.on('data', (chunk) => ws.readyState === WebSocket.OPEN && ws.send(chunk.toString()));
    child.on('close', (code) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(`\n[process exited: ${code ?? 0}]\n`);
      ws.close();
    });
    ws.on('message', (raw) => child.stdin.write(raw.toString()));
    ws.on('close', () => child.kill('SIGTERM'));
  } catch (error) {
    ws.send(`Terminal error: ${error instanceof Error ? error.message : String(error)}\n`);
    ws.close();
  }
}

function isRuntimeContainer(containerName: string, res: { status: (code: number) => { json: (body: unknown) => void } }): boolean {
  if (!containerNamePattern.test(containerName)) {
    res.status(400).json({ ok: false, error: 'Invalid runtime container' });
    return false;
  }
  return true;
}

async function inspectRaw(name: string): Promise<unknown | null> {
  try {
    const { stdout } = await execFileAsync('docker', ['inspect', name], { timeout: 10_000, maxBuffer: 1024 * 1024 * 4 });
    return JSON.parse(stdout)[0] ?? null;
  } catch {
    return null;
  }
}

async function inspectContainer(name: string): Promise<{ status: string; running: boolean; health?: string | null } | null> {
  try {
    const { stdout } = await execFileAsync('docker', ['inspect', name], { timeout: 10_000, maxBuffer: 1024 * 1024 });
    const inspect = JSON.parse(stdout)[0] as { State?: { Status?: string; Running?: boolean; Health?: { Status?: string } } } | undefined;
    if (!inspect) return null;
    return {
      status: inspect.State?.Status ?? 'unknown',
      running: Boolean(inspect.State?.Running),
      health: inspect.State?.Health?.Status ?? null,
    };
  } catch {
    return null;
  }
}

async function readIdentity(containerName: string): Promise<{ tenantId: string; channelId: string; endUserId: string; backendId: string } | null> {
  const inspect = await inspectRaw(containerName) as { Config?: { Labels?: Record<string, string> } } | null;
  const labels = inspect?.Config?.Labels;
  if (!labels?.['clawscale.tenantId'] || !labels['clawscale.channelId'] || !labels['clawscale.endUserId'] || !labels['clawscale.backendId']) return null;
  return {
    tenantId: labels['clawscale.tenantId'],
    channelId: labels['clawscale.channelId'],
    endUserId: labels['clawscale.endUserId'],
    backendId: labels['clawscale.backendId'],
  };
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function redactConfig(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactConfig);
  if (!isObject(value)) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    copy[key] = key.toLowerCase().includes('key') || key.toLowerCase().includes('token')
      ? (entry ? '********' : entry)
      : redactConfig(entry);
  }
  return copy;
}

function readCurrentModel(config: unknown): { providerId: string | null; model: string | null; primary: string | null } {
  const primary = isObject(config)
    && isObject(config.agents)
    && isObject(config.agents.defaults)
    && isObject(config.agents.defaults.model)
    && typeof config.agents.defaults.model.primary === 'string'
    ? config.agents.defaults.model.primary
    : null;
  if (!primary) return { providerId: null, model: null, primary: null };
  const slash = primary.indexOf('/');
  return slash > 0
    ? { providerId: primary.slice(0, slash), model: primary.slice(slash + 1), primary }
    : { providerId: null, model: primary, primary };
}

function readProviderApi(provider: string, config: unknown): string {
  if (isObject(config) && (config.api === 'anthropic-messages' || config.api === 'openai-completions')) return config.api;
  return provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions';
}

function simplifyInspect(inspect: unknown): unknown {
  if (!isObject(inspect)) return inspect;
  return {
    id: inspect.Id,
    image: inspect.Config && isObject(inspect.Config) ? inspect.Config.Image : undefined,
    created: inspect.Created,
    state: inspect.State,
    labels: inspect.Config && isObject(inspect.Config) ? inspect.Config.Labels : undefined,
    mounts: inspect.Mounts,
    networkSettings: inspect.NetworkSettings,
  };
}

function readLatency(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>).latencyMs;
  return typeof value === 'number' ? value : null;
}
