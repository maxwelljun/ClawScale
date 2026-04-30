import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { generateId } from '../lib/id.js';
import { audit } from '../lib/audit.js';

const PROVIDERS = ['openai', 'anthropic', 'minimax', 'google', 'mistral', 'deepseek', 'openrouter', 'ollama', 'xai', 'custom'] as const;

const modelProviderSchema = z.object({
  name: z.string().min(1).max(80),
  provider: z.enum(PROVIDERS),
  baseUrl: z.string().url().optional().or(z.literal('')),
  apiKey: z.string().optional(),
  models: z.array(z.string().min(1).max(120)).default([]),
  config: z.record(z.unknown()).default({}),
  isActive: z.boolean().default(true),
});

const updateModelProviderSchema = modelProviderSchema.partial();

function redactProvider<T extends { apiKey?: string | null }>(row: T): Omit<T, 'apiKey'> & { apiKeySet: boolean } {
  const { apiKey, ...rest } = row;
  return { ...rest, apiKeySet: Boolean(apiKey) };
}

export const modelsRouter = Router();
modelsRouter.use(requireAuth);

modelsRouter.get('/', async (req, res) => {
  const { tenantId } = req.auth!;
  const rows = await db.modelProvider.findMany({
    where: { tenantId },
    orderBy: [{ createdAt: 'asc' }],
  });
  res.json({ ok: true, data: rows.map(redactProvider) });
});

modelsRouter.post('/', requireAdmin, validate(modelProviderSchema), async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const body = req.body;
  const id = generateId('mdl');
  const row = await db.modelProvider.create({
    data: {
      id,
      tenantId,
      name: body.name,
      provider: body.provider,
      baseUrl: body.baseUrl || null,
      apiKey: body.apiKey || null,
      models: body.models,
      config: body.config,
      isActive: body.isActive,
    },
  });
  await audit({ tenantId, memberId: userId, action: 'create_model_provider', resource: 'model_provider', resourceId: id });
  res.status(201).json({ ok: true, data: redactProvider(row) });
});

modelsRouter.get('/:id', requireAdmin, async (req, res) => {
  const { tenantId } = req.auth!;
  const id = req.params.id as string;
  const row = await db.modelProvider.findFirst({ where: { id, tenantId } });
  if (!row) { res.status(404).json({ ok: false, error: 'Model provider not found' }); return; }
  res.json({ ok: true, data: redactProvider(row) });
});

modelsRouter.patch('/:id', requireAdmin, validate(updateModelProviderSchema), async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const id = req.params.id as string;
  const body = req.body;
  const existing = await db.modelProvider.findFirst({ where: { id, tenantId } });
  if (!existing) { res.status(404).json({ ok: false, error: 'Model provider not found' }); return; }

  const data: Record<string, unknown> = { ...body };
  if ('baseUrl' in data && !data.baseUrl) data.baseUrl = null;
  if (!body.apiKey) delete data.apiKey;

  const row = await db.modelProvider.update({ where: { id }, data });
  await audit({ tenantId, memberId: userId, action: 'update_model_provider', resource: 'model_provider', resourceId: id });
  res.json({ ok: true, data: redactProvider(row) });
});

modelsRouter.delete('/:id', requireAdmin, async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const id = req.params.id as string;
  const existing = await db.modelProvider.findFirst({ where: { id, tenantId } });
  if (!existing) { res.status(404).json({ ok: false, error: 'Model provider not found' }); return; }
  await db.aiBackend.updateMany({ where: { tenantId, modelProviderId: id }, data: { modelProviderId: null } });
  await db.modelProvider.delete({ where: { id } });
  await audit({ tenantId, memberId: userId, action: 'delete_model_provider', resource: 'model_provider', resourceId: id });
  res.json({ ok: true, data: null });
});

