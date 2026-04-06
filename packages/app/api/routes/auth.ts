import { Router } from 'express';
import { z } from 'zod';
import slugify from 'slugify';
import { db } from '../db/index.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { signToken } from '../lib/jwt.js';
import { generateId } from '../lib/id.js';
import { requireAuth } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { validate } from '../middleware/validate.js';
import type { TenantSettings } from '../../shared/index.js';

const registerSchema = z.object({
  tenantSlug: z
    .string()
    .min(3)
    .max(48)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only')
    .optional(),
  tenantName: z.string().min(2).max(80).optional(),
  name: z.string().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const defaultSettings: TenantSettings = {
  personaName: 'Assistant',
  personaPrompt: 'You are a helpful assistant.',
  endUserAccess: 'anonymous',
  features: { knowledgeBase: false },
  allowRegistration: true,
};

const memberSelect = {
  id: true,
  tenantId: true,
  email: true,
  name: true,
  role: true,
  createdAt: true,
  lastActiveAt: true,
} as const;

export const authRouter = Router();

// ── POST /auth/register ──────────────────────────────────────────────────────
authRouter.post('/register', validate(registerSchema), async (req, res) => {
  const body = req.body;

  // Check if a project already exists
  const existingTenant = await db.tenant.findFirst();

  // If a project exists, check whether registration is open
  if (existingTenant) {
    const s = existingTenant.settings as TenantSettings | null;
    if (s?.allowRegistration === false) {
      res.status(403).json({ ok: false, error: 'Registration is currently disabled' });
      return;
    }
  }

  // Check for duplicate email across all members
  const emailTaken = await db.member.findFirst({ where: { email: body.email.toLowerCase() } });
  if (emailTaken) {
    res.status(409).json({ ok: false, error: 'An account with this email already exists' });
    return;
  }

  const memberId = generateId('mbr');
  const passwordHash = await hashPassword(body.password);

  let tenantId: string;
  let role: 'admin' | 'member';

  if (existingTenant) {
    // Join existing project as a regular member
    tenantId = existingTenant.id;
    role = 'member';

    await db.member.create({
      data: {
        id: memberId,
        tenantId,
        email: body.email.toLowerCase(),
        name: body.name,
        passwordHash,
        role,
      },
    });
  } else {
    // First user — create the project and become admin
    if (!body.tenantSlug || !body.tenantName) {
      res.status(400).json({ ok: false, error: 'Project name and URL are required for initial setup' });
      return;
    }
    tenantId = generateId('tnt');
    role = 'admin';
    const slug = (slugify as any)(body.tenantSlug, { lower: true, strict: true }) as string;

    await db.$transaction(async (tx) => {
      await tx.tenant.create({
        data: {
          id: tenantId,
          slug,
          name: body.tenantName,
          settings: defaultSettings as object,
        },
      });
      await tx.member.create({
        data: {
          id: memberId,
          tenantId,
          email: body.email.toLowerCase(),
          name: body.name,
          passwordHash,
          role,
        },
      });
    });
  }

  const token = signToken({ sub: memberId, tid: tenantId, role });

  await audit({ tenantId, memberId, action: 'register', resource: 'tenant', resourceId: tenantId });

  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  const member = await db.member.findUnique({ where: { id: memberId }, select: memberSelect });

  res.json({
    ok: true,
    data: {
      tokens: { accessToken: token, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() },
      user: member,
      tenant,
    },
  });
});

// ── GET /auth/status — public check whether a project exists ─────────────────
authRouter.get('/status', async (_req, res) => {
  const tenant = await db.tenant.findFirst({ select: { name: true, settings: true } });
  const settings = tenant?.settings as TenantSettings | null;
  const allowRegistration = settings?.allowRegistration !== false;
  res.json({ ok: true, data: { hasProject: !!tenant, projectName: tenant?.name ?? null, allowRegistration, logoUrl: settings?.logoUrl ?? null, defaultHomePage: settings?.defaultHomePage ?? null } });
});

// ── POST /auth/login ─────────────────────────────────────────────────────────
authRouter.post('/login', validate(loginSchema), async (req, res) => {
  const { email, password } = req.body;

  const member = await db.member.findFirst({
    where: { email: email.toLowerCase(), isActive: true },
  });

  if (!member) {
    res.status(401).json({ ok: false, error: 'Invalid email or password' });
    return;
  }

  const valid = await verifyPassword(password, member.passwordHash);
  if (!valid) {
    res.status(401).json({ ok: false, error: 'Invalid email or password' });
    return;
  }

  await db.member.update({
    where: { id: member.id },
    data: { lastActiveAt: new Date() },
  });

  const token = signToken({ sub: member.id, tid: member.tenantId, role: member.role });

  const tenant = await db.tenant.findUnique({ where: { id: member.tenantId } });

  await audit({ tenantId: member.tenantId, memberId: member.id, action: 'login', resource: 'session' });

  res.json({
    ok: true,
    data: {
      tokens: { accessToken: token, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString() },
      user: {
        id: member.id,
        tenantId: member.tenantId,
        email: member.email,
        name: member.name,
        role: member.role,
        createdAt: member.createdAt,
        lastActiveAt: member.lastActiveAt,
      },
      tenant,
    },
  });
});

// ── GET /auth/me ─────────────────────────────────────────────────────────────
authRouter.get('/me', requireAuth, async (req, res) => {
  const { userId, tenantId } = req.auth!;

  const member = await db.member.findUnique({
    where: { id: userId },
    select: memberSelect,
  });

  if (!member) {
    res.status(404).json({ ok: false, error: 'Member not found' });
    return;
  }

  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });

  res.json({ ok: true, data: { user: member, tenant } });
});

// ── DELETE /auth/account ────────────────────────────────────────────────────
authRouter.delete('/account', requireAuth, async (req, res) => {
  const { userId, tenantId } = req.auth!;

  const member = await db.member.findUnique({ where: { id: userId } });
  if (!member) {
    res.status(404).json({ ok: false, error: 'Member not found' });
    return;
  }

  // If user is the only admin, prevent deletion to avoid orphaning the tenant
  if (member.role === 'admin') {
    const adminCount = await db.member.count({
      where: { tenantId, role: 'admin', isActive: true },
    });
    if (adminCount <= 1) {
      res.status(422).json(
        { ok: false, error: 'You are the only admin. Transfer ownership or delete the workspace first.' },
      );
      return;
    }
  }

  await audit({ tenantId, memberId: userId, action: 'delete_own_account', resource: 'member', resourceId: userId });

  // Hard delete — cascades to sessions and sets auditLog.memberId to null
  await db.member.delete({ where: { id: userId } });

  res.json({ ok: true, data: null });
});
