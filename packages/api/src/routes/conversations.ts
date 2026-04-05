import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

export const conversationsRouter = Router();
conversationsRouter.use(requireAuth);

// ── GET /api/conversations ───────────────────────────────────────────────────
conversationsRouter.get('/', async (req, res) => {
  const { tenantId } = req.auth!;
  const limit = Math.min(parseInt(req.query.limit as string ?? '50', 10), 200);
  const offset = parseInt(req.query.offset as string ?? '0', 10);
  const channelId = req.query.channelId as string | undefined;

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

  res.json({ ok: true, data: rows });
});

// ── GET /api/conversations/:id ───────────────────────────────────────────────
conversationsRouter.get('/:id', async (req, res) => {
  const { tenantId } = req.auth!;
  const id = req.params.id as string;
  const limit = Math.min(parseInt(req.query.limit as string ?? '100', 10), 500);

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

  if (!conversation) { res.status(404).json({ ok: false, error: 'Conversation not found' }); return; }

  res.json({ ok: true, data: conversation });
});

// ── DELETE /api/conversations/:id ─────────────────────────────────────────────
conversationsRouter.delete('/:id', async (req, res) => {
  const { tenantId } = req.auth!;
  const id = req.params.id as string;

  const conversation = await db.conversation.findFirst({ where: { id, tenantId } });
  if (!conversation) { res.status(404).json({ ok: false, error: 'Conversation not found' }); return; }

  await db.message.deleteMany({ where: { conversationId: id } });
  await db.conversation.delete({ where: { id } });

  res.json({ ok: true });
});
