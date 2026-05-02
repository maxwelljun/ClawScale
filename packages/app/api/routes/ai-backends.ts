import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { generateId } from '../lib/id.js';
import { audit } from '../lib/audit.js';
import { validate } from '../middleware/validate.js';

const BACKEND_TYPES = ['llm', 'openclaw', 'palmos', 'claude-code', 'custom', 'cli-bridge', 'local-bridge'] as const;

const configSchema = z.object({
  apiKey:         z.string().optional(),
  model:          z.string().optional(),
  systemPrompt:   z.string().max(2000).optional(),
  baseUrl:        z.string().url().optional(),
  commandAlias:   z.string().max(30).regex(/^\S*$/, 'Alias must not contain spaces').optional(),
  authHeader:     z.string().max(500).optional(),
  transport:      z.enum(['http', 'sse', 'websocket', 'pty-websocket'] as const).optional(),
  responseFormat: z.enum(['json-auto', 'langgraph', 'raw-text'] as const).optional(),
  bridgeToken:    z.string().optional(),
}).default({});

const createSchema = z.object({
  name:      z.string().min(1).max(80),
  type:      z.enum(BACKEND_TYPES),
  modelProviderId: z.string().nullable().optional(),
  runtimeType: z.string().min(1).max(40).default('openclaw'),
  skills: z.array(z.object({
    name: z.string().min(1).max(80),
    description: z.string().max(500).optional(),
    enabled: z.boolean().optional(),
  })).default([]),
  workspace: z.array(z.object({
    path: z.string().min(1).max(200),
    content: z.string().max(20000),
  })).default([]),
  knowledgeBase: z.array(z.object({
    title: z.string().min(1).max(120),
    content: z.string().max(20000),
  })).default([]),
  config:    configSchema,
  isActive:  z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

const updateSchema = z.object({
  name:      z.string().min(1).max(80).optional(),
  type:      z.enum(BACKEND_TYPES).optional(),
  modelProviderId: z.string().nullable().optional(),
  runtimeType: z.string().min(1).max(40).optional(),
  skills: z.array(z.object({
    name: z.string().min(1).max(80),
    description: z.string().max(500).optional(),
    enabled: z.boolean().optional(),
  })).optional(),
  workspace: z.array(z.object({
    path: z.string().min(1).max(200),
    content: z.string().max(20000),
  })).optional(),
  knowledgeBase: z.array(z.object({
    title: z.string().min(1).max(120),
    content: z.string().max(20000),
  })).optional(),
  config:    configSchema.optional(),
  isActive:  z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

const publishSchema = z.object({
  notes: z.string().max(1000).optional(),
});

export const aiBackendsRouter = Router();
aiBackendsRouter.use(requireAuth);

// ── GET /api/ai-backends ─────────────────────────���───────────────────────────
aiBackendsRouter.get('/', async (req, res) => {
  const { tenantId } = req.auth!;

  const rows = await db.aiBackend.findMany({
    where: { tenantId },
    orderBy: [{ createdAt: 'asc' }],
    select: {
      id: true, tenantId: true, name: true, type: true,
      modelProviderId: true, runtimeType: true, skills: true, workspace: true, knowledgeBase: true,
      isActive: true, isDefault: true, createdAt: true, updatedAt: true,
      modelProvider: { select: { id: true, name: true, provider: true } },
    },
  });

  res.json({ ok: true, data: rows });
});

// ── POST /api/ai-backends ──────────────���─────────────────────────────────────
aiBackendsRouter.post('/', requireAdmin, validate(createSchema), async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const body = req.body;

  // If marking as default, unset any existing default first
  if (body.isDefault) {
    await db.aiBackend.updateMany({
      where: { tenantId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const id = generateId('aib');
  // Auto-generate bridge token for cli-bridge backends
  const config = body.type === 'cli-bridge'
    ? { ...body.config, bridgeToken: body.config.bridgeToken || generateId('brg') }
    : body.config;
  await db.aiBackend.create({
    data: {
      id,
      tenantId,
      name: body.name,
      type: body.type,
      modelProviderId: body.modelProviderId || null,
      runtimeType: body.runtimeType,
      skills: body.skills,
      workspace: body.workspace,
      knowledgeBase: body.knowledgeBase,
      config,
      isActive: body.isActive,
      isDefault: body.isDefault,
    },
  });

  await audit({ tenantId, memberId: userId, action: 'create_ai_backend', resource: 'ai_backend', resourceId: id });

  res.status(201).json({ ok: true, data: await db.aiBackend.findUnique({ where: { id } }) });
});

// ── GET /api/ai-backends/:id ───────��──────────────────────────────────��──────
aiBackendsRouter.get('/:id', requireAdmin, async (req, res) => {
  const { tenantId } = req.auth!;
  const id = req.params.id as string;
  const backend = await db.aiBackend.findFirst({ where: { id, tenantId } });
  if (!backend) { res.status(404).json({ ok: false, error: 'AI backend not found' }); return; }
  res.json({ ok: true, data: backend });
});

// ── GET /api/agents/:id/versions ─────────────────────────────────────────────
aiBackendsRouter.get('/:id/versions', requireAdmin, async (req, res) => {
  const { tenantId } = req.auth!;
  const id = req.params.id as string;
  const backend = await db.aiBackend.findFirst({ where: { id, tenantId }, select: { id: true } });
  if (!backend) { res.status(404).json({ ok: false, error: 'Agent template not found' }); return; }

  const rows = await db.agentTemplateVersion.findMany({
    where: { tenantId, agentTemplateId: id },
    orderBy: { version: 'desc' },
  });
  res.json({ ok: true, data: rows });
});

// ── POST /api/agents/:id/publish ─────────────────────────────────────────────
aiBackendsRouter.post('/:id/publish', requireAdmin, validate(publishSchema), async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const id = req.params.id as string;
  const backend = await db.aiBackend.findFirst({
    where: { id, tenantId },
    include: { modelProvider: { select: { id: true, name: true, provider: true, baseUrl: true, models: true } } },
  });
  if (!backend) { res.status(404).json({ ok: false, error: 'Agent template not found' }); return; }

  const latest = await db.agentTemplateVersion.findFirst({
    where: { tenantId, agentTemplateId: id },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const version = (latest?.version ?? 0) + 1;
  const row = await db.agentTemplateVersion.create({
    data: {
      id: generateId('agtv'),
      tenantId,
      agentTemplateId: id,
      version,
      name: backend.name,
      notes: req.body.notes ?? null,
      snapshot: {
        name: backend.name,
        type: backend.type,
        runtimeType: backend.runtimeType,
        modelProviderId: backend.modelProviderId,
        modelProvider: backend.modelProvider,
        config: backend.config,
        skills: backend.skills,
        workspace: backend.workspace,
        knowledgeBase: backend.knowledgeBase,
      },
    },
  });

  await audit({ tenantId, memberId: userId, action: 'publish_agent_template', resource: 'agent_template_version', resourceId: row.id });
  res.status(201).json({ ok: true, data: row });
});

// ── PATCH /api/ai-backends/:id ───────────────────────────────────────────────
aiBackendsRouter.patch('/:id', requireAdmin, validate(updateSchema), async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const id = req.params.id as string;
  const body = req.body;

  const existing = await db.aiBackend.findFirst({ where: { id, tenantId } });
  if (!existing) { res.status(404).json({ ok: false, error: 'AI backend not found' }); return; }

  if (body.isDefault) {
    await db.aiBackend.updateMany({
      where: { tenantId, isDefault: true, id: { not: id } },
      data: { isDefault: false },
    });
  }

  await db.aiBackend.update({ where: { id }, data: body });

  await audit({ tenantId, memberId: userId, action: 'update_ai_backend', resource: 'ai_backend', resourceId: id });
  res.json({ ok: true, data: await db.aiBackend.findUnique({ where: { id } }) });
});

// ── DELETE /api/ai-backends/:id ──────────────────────���───────────────────────
aiBackendsRouter.delete('/:id', requireAdmin, async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const id = req.params.id as string;

  const existing = await db.aiBackend.findFirst({ where: { id, tenantId } });
  if (!existing) { res.status(404).json({ ok: false, error: 'AI backend not found' }); return; }

  await db.endUserBackend.deleteMany({ where: { backendId: id } });
  await db.aiBackend.delete({ where: { id } });
  await audit({ tenantId, memberId: userId, action: 'delete_ai_backend', resource: 'ai_backend', resourceId: id });

  res.json({ ok: true, data: null });
});
