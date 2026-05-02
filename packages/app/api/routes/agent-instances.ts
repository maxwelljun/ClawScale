import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { openClawContainerName, openClawRuntimeDirs } from '../lib/openclaw-docker.js';
import { validate } from '../middleware/validate.js';

const execFileAsync = promisify(execFile);
const containerNamePattern = /^clawscale-openclaw-[a-f0-9]{12}$/;
const execSchema = z.object({
  command: z.string().min(1).max(500).default('pwd'),
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
  const [inspect, openclawConfig, manifest, version] = await Promise.all([
    inspectRaw(containerName),
    dirs ? readJsonFile(path.join(dirs.stateDir, 'openclaw.json')) : null,
    dirs ? readJsonFile(path.join(dirs.workspaceDir, '.clawbot', 'manifest.json')) : null,
    dirs ? readJsonFile(path.join(dirs.workspaceDir, '.clawbot', 'version.json')) : null,
  ]);
  res.json({ ok: true, data: { identity, dirs, inspect, openclawConfig, manifest, version } });
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

function readLatency(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>).latencyMs;
  return typeof value === 'number' ? value : null;
}
