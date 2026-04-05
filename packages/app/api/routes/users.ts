import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { generateId } from '../lib/id.js';
import { hashPassword } from '../lib/password.js';
import { audit } from '../lib/audit.js';
import { validate } from '../middleware/validate.js';

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(80),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
  /** Temporary password — user should change on first login */
  temporaryPassword: z.string().min(8),
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  role: z.enum(['admin', 'member', 'viewer']).optional(),
  isActive: z.boolean().optional(),
});

const memberSelect = {
  id: true,
  tenantId: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
  lastActiveAt: true,
} as const;

export const usersRouter = Router();
usersRouter.use(requireAuth);

// ── GET /api/users ───────────────────────────────────────────────────────────
usersRouter.get('/', async (req, res) => {
  const { tenantId } = req.auth!;

  const rows = await db.member.findMany({
    where: { tenantId },
    select: memberSelect,
  });

  res.json({ ok: true, data: rows });
});

// ── POST /api/users — invite a new member ────────────────────────────────────
usersRouter.post('/', requireAdmin, validate(inviteSchema), async (req, res) => {
  const { tenantId, userId: actorId } = req.auth!;
  const body = req.body;

  // Check duplicate email within tenant
  const existing = await db.member.findUnique({
    where: { tenantId_email: { tenantId, email: body.email.toLowerCase() } },
    select: { id: true },
  });

  if (existing) {
    res.status(409).json({ ok: false, error: 'A member with this email already exists' });
    return;
  }

  const id = generateId('mbr');
  const passwordHash = await hashPassword(body.temporaryPassword);

  await db.member.create({
    data: {
      id,
      tenantId,
      email: body.email.toLowerCase(),
      name: body.name,
      passwordHash,
      role: body.role,
    },
  });

  await audit({ tenantId, memberId: actorId, action: 'invite_member', resource: 'member', resourceId: id });

  const created = await db.member.findUnique({ where: { id }, select: memberSelect });
  res.status(201).json({ ok: true, data: created });
});

// ── GET /api/users/:id ───────────────────────────────────────────────────────
usersRouter.get('/:id', async (req, res) => {
  const { tenantId } = req.auth!;
  const id = req.params.id as string;

  const member = await db.member.findFirst({
    where: { id, tenantId },
    select: memberSelect,
  });

  if (!member) { res.status(404).json({ ok: false, error: 'Member not found' }); return; }
  res.json({ ok: true, data: member });
});

// ── PATCH /api/users/:id ─────────────────────────────────────────────────────
usersRouter.patch('/:id', requireAdmin, validate(updateSchema), async (req, res) => {
  const { tenantId, userId: actorId } = req.auth!;
  const id = req.params.id as string;
  const body = req.body;

  const existing = await db.member.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });

  if (!existing) { res.status(404).json({ ok: false, error: 'Member not found' }); return; }

  await db.member.update({ where: { id }, data: body });

  await audit({ tenantId, memberId: actorId, action: 'update_member', resource: 'member', resourceId: id, meta: body });

  const updated = await db.member.findUnique({ where: { id }, select: memberSelect });
  res.json({ ok: true, data: updated });
});

// ── DELETE /api/users/:id — deactivate (not hard delete) ────────────────────
usersRouter.delete('/:id', requireAdmin, async (req, res) => {
  const { tenantId, userId: actorId } = req.auth!;
  const id = req.params.id as string;

  if (id === actorId) {
    res.status(422).json({ ok: false, error: 'You cannot deactivate your own account' });
    return;
  }

  const existing = await db.member.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });

  if (!existing) { res.status(404).json({ ok: false, error: 'Member not found' }); return; }

  await db.member.update({ where: { id }, data: { isActive: false } });

  await audit({ tenantId, memberId: actorId, action: 'deactivate_member', resource: 'member', resourceId: id });

  res.json({ ok: true, data: null });
});
