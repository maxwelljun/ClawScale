import { Hono } from 'hono';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

export const conversationsRouter = new Hono()
  .use('*', requireAuth)

  // ── GET /api/conversations ───────────────────────────────────────────────────
  .get('/', async (c) => {
    const { tenantId } = c.get('auth');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
    const offset = parseInt(c.req.query('offset') ?? '0', 10);
    const channelId = c.req.query('channelId');

    const rows = await db.conversation.findMany({
      where: { tenantId, ...(channelId ? { channelId } : {}) },
      select: {
        id: true,
        tenantId: true,
        channelId: true,
        endUserId: true,
        createdAt: true,
        updatedAt: true,
        endUser: {
          select: { id: true, externalId: true, name: true, email: true, status: true, linkedTo: true },
        },
        channel: {
          select: { id: true, name: true, type: true },
        },
        _count: { select: { messages: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: limit,
      skip: offset,
    });

    return c.json({ ok: true, data: rows });
  })

  // ── GET /api/conversations/:id ───────────────────────────────────────────────
  .get('/:id', async (c) => {
    const { tenantId } = c.get('auth');
    const id = c.req.param('id');
    const limit = Math.min(parseInt(c.req.query('limit') ?? '100', 10), 500);

    const conversation = await db.conversation.findFirst({
      where: { id, tenantId },
      include: {
        endUser: true,
        channel: { select: { id: true, name: true, type: true } },
        messages: {
          orderBy: { createdAt: 'asc' },
          take: limit,
          select: { id: true, role: true, content: true, metadata: true, createdAt: true },
        },
      },
    });

    if (!conversation) return c.json({ ok: false, error: 'Conversation not found' }, 404);

    return c.json({ ok: true, data: conversation });
  })

  // ── DELETE /api/conversations/:id ─────────────────────────────────────────────
  .delete('/:id', async (c) => {
    const { tenantId } = c.get('auth');
    const id = c.req.param('id');

    const conversation = await db.conversation.findFirst({ where: { id, tenantId } });
    if (!conversation) return c.json({ ok: false, error: 'Conversation not found' }, 404);

    await db.message.deleteMany({ where: { conversationId: id } });
    await db.conversation.delete({ where: { id } });

    return c.json({ ok: true });
  });
