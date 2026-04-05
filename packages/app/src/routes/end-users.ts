import { Router } from 'express';
import { db } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';

const endUserSelect = {
  id: true,
  tenantId: true,
  channelId: true,
  externalId: true,
  name: true,
  email: true,
  status: true,
  linkedTo: true,
  createdAt: true,
  updatedAt: true,
  channel: { select: { name: true, type: true } },
  _count: { select: { conversations: true } },
} as const;

export const endUsersRouter = Router();
endUsersRouter.use(requireAuth);

// ── GET /api/end-users ──────────────────────────────────────────────────────
endUsersRouter.get('/', async (req, res) => {
  const { tenantId } = req.auth!;
  const limit = Math.min(parseInt(req.query.limit as string ?? '100', 10), 500);
  const offset = parseInt(req.query.offset as string ?? '0', 10);

  const [rows, total] = await Promise.all([
    db.endUser.findMany({
      where: { tenantId },
      select: endUserSelect,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.endUser.count({ where: { tenantId } }),
  ]);

  res.json({ ok: true, data: { rows, total } });
});

// ── GET /api/end-users/:id ──────────────────────────────────────────────────
endUsersRouter.get('/:id', async (req, res) => {
  const { tenantId } = req.auth!;
  const id = req.params.id as string;

  const endUser = await db.endUser.findFirst({
    where: { id, tenantId },
    select: endUserSelect,
  });

  if (!endUser) { res.status(404).json({ ok: false, error: 'End user not found' }); return; }
  res.json({ ok: true, data: endUser });
});
