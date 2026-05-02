import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { openClawContainerName, openClawRuntimeDirs } from '../lib/openclaw-docker.js';

const execFileAsync = promisify(execFile);

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

agentInstancesRouter.post('/:containerName/:action', requireAdmin, async (req, res) => {
  const containerName = req.params.containerName as string;
  const action = req.params.action as string;
  if (!/^clawscale-openclaw-[a-f0-9]{12}$/.test(containerName)) {
    res.status(400).json({ ok: false, error: 'Invalid runtime container' });
    return;
  }
  if (!['start', 'stop', 'restart'].includes(action)) {
    res.status(400).json({ ok: false, error: 'Unsupported runtime action' });
    return;
  }
  await execFileAsync('docker', [action, containerName], { timeout: 60_000 });
  res.json({ ok: true, data: await inspectContainer(containerName) });
});

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

function readLatency(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>).latencyMs;
  return typeof value === 'number' ? value : null;
}
