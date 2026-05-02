import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { generateId } from '../lib/id.js';
import { audit } from '../lib/audit.js';

const PROVIDERS = ['openai', 'anthropic', 'minimax', 'google', 'mistral', 'deepseek', 'openrouter', 'ollama', 'xai', 'custom'] as const;
const PROVIDER_APIS = ['openai-completions', 'anthropic-messages'] as const;

const modelProviderSchema = z.object({
  name: z.string().min(1).max(80),
  provider: z.enum(PROVIDERS),
  baseUrl: z.string().url().optional().or(z.literal('')),
  apiKey: z.string().optional(),
  models: z.array(z.string().min(1).max(120)).default([]),
  config: z.object({
    api: z.enum(PROVIDER_APIS).optional(),
  }).catchall(z.unknown()).default({}),
  isActive: z.boolean().default(true),
});

const updateModelProviderSchema = modelProviderSchema.partial();
const runSchema = z.object({
  model: z.string().min(1).max(160).optional(),
  prompt: z.string().min(1).max(2000).default('Reply with OK.'),
});

function redactProvider<T extends { apiKey?: string | null }>(row: T): Omit<T, 'apiKey'> & { apiKeySet: boolean } {
  const { apiKey, ...rest } = row;
  return { ...rest, apiKeySet: Boolean(apiKey) };
}

export const modelsRouter = Router();
modelsRouter.use(requireAuth);

function defaultBaseUrl(provider: string): string {
  switch (provider) {
    case 'openai': return 'https://api.openai.com/v1';
    case 'anthropic': return 'https://api.anthropic.com';
    case 'minimax': return 'https://api.minimaxi.com/v1';
    case 'google': return 'https://generativelanguage.googleapis.com/v1beta/openai';
    case 'mistral': return 'https://api.mistral.ai/v1';
    case 'deepseek': return 'https://api.deepseek.com';
    case 'openrouter': return 'https://openrouter.ai/api/v1';
    case 'ollama': return 'http://localhost:11434/v1';
    case 'xai': return 'https://api.x.ai/v1';
    default: return '';
  }
}

function providerBaseUrl(row: { provider: string; baseUrl?: string | null }): string {
  return (row.baseUrl || defaultBaseUrl(row.provider)).replace(/\/$/, '');
}

function providerApi(row: { provider: string; config?: unknown }): typeof PROVIDER_APIS[number] {
  if (row.config && typeof row.config === 'object') {
    const api = (row.config as Record<string, unknown>).api;
    if (api === 'anthropic-messages' || api === 'openai-completions') return api;
  }
  return row.provider === 'anthropic' ? 'anthropic-messages' : 'openai-completions';
}

function providerHeaders(row: { provider: string; apiKey?: string | null; config?: unknown }): Record<string, string> {
  if (providerApi(row) === 'anthropic-messages') {
    return {
      'Content-Type': 'application/json',
      ...(row.apiKey ? { 'x-api-key': row.apiKey } : {}),
      'anthropic-version': '2023-06-01',
    };
  }
  return {
    'Content-Type': 'application/json',
    ...(row.apiKey ? { Authorization: `Bearer ${row.apiKey}` } : {}),
  };
}

function anthropicUrl(baseUrl: string, path: string): string {
  return baseUrl.endsWith('/v1') ? `${baseUrl}${path}` : `${baseUrl}/v1${path}`;
}

async function fetchModelIds(row: { provider: string; baseUrl?: string | null; apiKey?: string | null; config?: unknown }): Promise<string[]> {
  const baseUrl = providerBaseUrl(row);
  if (!baseUrl) throw new Error('Base URL is required for this provider');
  const url = providerApi(row) === 'anthropic-messages' ? anthropicUrl(baseUrl, '/models') : `${baseUrl}/models`;
  const res = await fetch(url, {
    headers: providerHeaders(row),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${res.status} ${body.slice(0, 300)}`);
  }
  const data = await res.json() as { data?: Array<{ id?: string; name?: string }>; models?: Array<{ id?: string; name?: string } | string> };
  const items = data.data ?? data.models ?? [];
  return items.map((item) => typeof item === 'string' ? item : item.id ?? item.name).filter((item): item is string => Boolean(item));
}

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

modelsRouter.post('/:id/test', requireAdmin, async (req, res) => {
  const { tenantId } = req.auth!;
  const id = req.params.id as string;
  const row = await db.modelProvider.findFirst({ where: { id, tenantId } });
  if (!row) { res.status(404).json({ ok: false, error: 'Model provider not found' }); return; }
  try {
    const startedAt = Date.now();
    const models = await fetchModelIds(row);
    res.json({ ok: true, data: { latencyMs: Date.now() - startedAt, models: models.slice(0, 20) } });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

modelsRouter.post('/:id/sync', requireAdmin, async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const id = req.params.id as string;
  const row = await db.modelProvider.findFirst({ where: { id, tenantId } });
  if (!row) { res.status(404).json({ ok: false, error: 'Model provider not found' }); return; }
  try {
    const models = await fetchModelIds(row);
    const updated = await db.modelProvider.update({ where: { id }, data: { models } });
    await audit({ tenantId, memberId: userId, action: 'sync_model_provider', resource: 'model_provider', resourceId: id });
    res.json({ ok: true, data: redactProvider(updated) });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

modelsRouter.post('/:id/run', requireAdmin, validate(runSchema), async (req, res) => {
  const { tenantId } = req.auth!;
  const id = req.params.id as string;
  const body = req.body as z.infer<typeof runSchema>;
  const row = await db.modelProvider.findFirst({ where: { id, tenantId } });
  if (!row) { res.status(404).json({ ok: false, error: 'Model provider not found' }); return; }
  const model = body.model || (Array.isArray(row.models) ? row.models.find((m): m is string => typeof m === 'string') : undefined);
  if (!model) { res.status(400).json({ ok: false, error: 'No model configured for this provider' }); return; }
  try {
    const startedAt = Date.now();
    let reply = '';
    if (providerApi(row) === 'anthropic-messages') {
      const response = await fetch(anthropicUrl(providerBaseUrl(row), '/messages'), {
        method: 'POST',
        headers: providerHeaders(row),
        body: JSON.stringify({ model, max_tokens: 128, messages: [{ role: 'user', content: body.prompt }] }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 300)}`);
      const data = await response.json() as { content?: Array<{ text?: string }> };
      reply = data.content?.map((part) => part.text).filter(Boolean).join('') ?? '';
    } else {
      const response = await fetch(`${providerBaseUrl(row)}/chat/completions`, {
        method: 'POST',
        headers: providerHeaders(row),
        body: JSON.stringify({ model, messages: [{ role: 'user', content: body.prompt }], max_completion_tokens: 128 }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`${response.status} ${(await response.text()).slice(0, 300)}`);
      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      reply = data.choices?.[0]?.message?.content ?? '';
    }
    res.json({ ok: true, data: { model, latencyMs: Date.now() - startedAt, reply } });
  } catch (error) {
    res.status(502).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
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
