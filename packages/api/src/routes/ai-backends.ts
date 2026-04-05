import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { generateId } from '../lib/id.js';
import { audit } from '../lib/audit.js';

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
  config:    configSchema,
  isActive:  z.boolean().default(true),
  isDefault: z.boolean().default(false),
});

const updateSchema = z.object({
  name:      z.string().min(1).max(80).optional(),
  type:      z.enum(BACKEND_TYPES).optional(),
  config:    configSchema.optional(),
  isActive:  z.boolean().optional(),
  isDefault: z.boolean().optional(),
});

export const aiBackendsRouter = new Hono()
  .use('*', requireAuth)

  // ── GET /api/ai-backends ─────────────────────────────────────────────────────
  .get('/', async (c) => {
    const { tenantId } = c.get('auth');

    const rows = await db.aiBackend.findMany({
      where: { tenantId },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true, tenantId: true, name: true, type: true,
        isActive: true, isDefault: true, createdAt: true, updatedAt: true,
      },
    });

    return c.json({ ok: true, data: rows });
  })

  // ── POST /api/ai-backends ────────────────────────────────────────────────────
  .post('/', requireAdmin, zValidator('json', createSchema), async (c) => {
    const { tenantId, userId } = c.get('auth');
    const body = c.req.valid('json');

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
      data: { id, tenantId, name: body.name, type: body.type, config, isActive: body.isActive, isDefault: body.isDefault },
    });

    await audit({ tenantId, memberId: userId, action: 'create_ai_backend', resource: 'ai_backend', resourceId: id });

    return c.json({ ok: true, data: await db.aiBackend.findUnique({ where: { id } }) }, 201);
  })

  // ── GET /api/ai-backends/:id ─────────────────────────────────────────────────
  .get('/:id', requireAdmin, async (c) => {
    const { tenantId } = c.get('auth');
    const id = c.req.param('id')!;
    const backend = await db.aiBackend.findFirst({ where: { id, tenantId } });
    if (!backend) return c.json({ ok: false, error: 'AI backend not found' }, 404);
    return c.json({ ok: true, data: backend });
  })

  // ── PATCH /api/ai-backends/:id ───────────────────────────────────────────────
  .patch('/:id', requireAdmin, zValidator('json', updateSchema), async (c) => {
    const { tenantId, userId } = c.get('auth');
    const id = c.req.param('id')!;
    const body = c.req.valid('json');

    const existing = await db.aiBackend.findFirst({ where: { id, tenantId } });
    if (!existing) return c.json({ ok: false, error: 'AI backend not found' }, 404);

    if (body.isDefault) {
      await db.aiBackend.updateMany({
        where: { tenantId, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }

    await db.aiBackend.update({ where: { id }, data: body });

    await audit({ tenantId, memberId: userId, action: 'update_ai_backend', resource: 'ai_backend', resourceId: id });
    return c.json({ ok: true, data: await db.aiBackend.findUnique({ where: { id } }) });
  })

  // ── DELETE /api/ai-backends/:id ──────────────────────────────────────────────
  .delete('/:id', requireAdmin, async (c) => {
    const { tenantId, userId } = c.get('auth');
    const id = c.req.param('id')!;

    const existing = await db.aiBackend.findFirst({ where: { id, tenantId } });
    if (!existing) return c.json({ ok: false, error: 'AI backend not found' }, 404);

    await db.endUserBackend.deleteMany({ where: { backendId: id } });
    await db.aiBackend.delete({ where: { id } });
    await audit({ tenantId, memberId: userId, action: 'delete_ai_backend', resource: 'ai_backend', resourceId: id });

    return c.json({ ok: true, data: null });
  });
