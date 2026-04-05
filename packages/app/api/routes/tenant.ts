import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { validate } from '../middleware/validate.js';

const updateSettingsSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  settings: z
    .object({
      siteTitle:     z.string().max(100).optional(),
      personaName:   z.string().min(1).max(80).optional(),
      personaPrompt: z.string().max(4000).optional(),
      endUserAccess: z.enum(['anonymous', 'whitelist', 'blacklist']).optional(),
      clawscale: z.object({
        name:        z.string().min(1).max(80).optional(),
        answerStyle: z.string().max(500).optional(),
        isActive:    z.boolean().optional(),
        rateLimit: z.object({
          maxMessages: z.number().int().min(0).max(10000),
          windowSeconds: z.number().int().min(1).max(86400),
        }).nullable().optional(),
        llm: z.object({
          model: z.string().min(1).max(100),
          apiKey: z.string().max(500).optional(),
          multimodal: z.boolean().optional(),
        }).nullable().optional(),
      }).optional(),
      onboarding: z.object({
        headline:    z.string().max(200).optional(),
        subtitle:    z.string().max(400).optional(),
        logoUrl:     z.string().max(500).optional(),
        accentColor: z.string().max(20).optional(),
      }).optional(),
    })
    .optional(),
});

export const tenantRouter = Router();
tenantRouter.use(requireAuth);

// ── GET /api/tenant ──────────────────────────────────────────────────────────
tenantRouter.get('/', async (req, res) => {
  const { tenantId } = req.auth!;
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) { res.status(404).json({ ok: false, error: 'Tenant not found' }); return; }
  res.json({ ok: true, data: maskTenantSecrets(tenant) });
});

// ── PATCH /api/tenant ────────────────────────────────────────────────────────
tenantRouter.patch('/', requireAdmin, validate(updateSettingsSchema), async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const body = req.body;

  const current = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!current) { res.status(404).json({ ok: false, error: 'Tenant not found' }); return; }

  let updatedSettings = current.settings as Record<string, unknown>;
  if (body.settings != null) {
    const { clawscale, onboarding, ...flatSettings } = body.settings;
    updatedSettings = { ...updatedSettings, ...flatSettings };
    if (onboarding !== undefined) {
      const existingOb = (updatedSettings.onboarding as Record<string, unknown>) ?? {};
      updatedSettings.onboarding = { ...existingOb, ...onboarding };
    }
    if (clawscale !== undefined) {
      const existing = (updatedSettings.clawscale as Record<string, unknown>) ?? {};
      const merged = { ...existing, ...clawscale };
      // Deep-merge llm so partial updates (e.g. model only) don't wipe apiKey
      if (clawscale.llm && typeof clawscale.llm === 'object' && existing.llm && typeof existing.llm === 'object') {
        merged.llm = { ...(existing.llm as Record<string, unknown>), ...(clawscale.llm as Record<string, unknown>) } as typeof clawscale.llm;
      }
      // Remove keys explicitly set to null (e.g. llm: null → delete llm)
      for (const key of Object.keys(merged)) {
        if ((merged as any)[key] === null) delete (merged as any)[key];
      }
      updatedSettings.clawscale = merged;
    }
  }

  await db.tenant.update({
    where: { id: tenantId },
    data: {
      ...(body.name != null ? { name: body.name } : {}),
      settings: updatedSettings as object,
    },
  });

  await audit({ tenantId, memberId: userId, action: 'update_tenant_settings', resource: 'tenant', resourceId: tenantId });

  const updated = await db.tenant.findUnique({ where: { id: tenantId } });
  res.json({ ok: true, data: maskTenantSecrets(updated) });
});

// ── GET /api/tenant/audit ────────────────────────────────────────────────────
tenantRouter.get('/audit', requireAdmin, async (req, res) => {
  const { tenantId } = req.auth!;
  const limit = Math.min(parseInt(req.query.limit as string ?? '50', 10), 200);
  const offset = parseInt(req.query.offset as string ?? '0', 10);

  const rows = await db.auditLog.findMany({
    where: { tenantId },
    select: {
      id: true,
      memberId: true,
      member: { select: { name: true } },
      action: true,
      resource: true,
      resourceId: true,
      meta: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });

  const mapped = rows.map((row) => ({
    id: row.id,
    memberId: row.memberId,
    memberName: row.member?.name ?? null,
    action: row.action,
    resource: row.resource,
    resourceId: row.resourceId,
    meta: row.meta,
    createdAt: row.createdAt,
  }));

  res.json({ ok: true, data: mapped });
});

// ── GET /api/tenant/stats ────────────────────────────────────────────────────
tenantRouter.get('/stats', async (req, res) => {
  const { tenantId } = req.auth!;

  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });

  const [totalMembers, activeMembers, totalConversations, activeChannels, totalBackends, totalEndUsers] = await Promise.all([
    db.member.count({ where: { tenantId } }),
    db.member.count({ where: { tenantId, isActive: true } }),
    db.conversation.count({ where: { tenantId } }),
    db.channel.count({ where: { tenantId, status: 'connected' } }),
    db.aiBackend.count({ where: { tenantId } }),
    db.endUser.count({ where: { tenantId } }),
  ]);

  res.json({
    ok: true,
    data: {
      totalMembers,
      activeMembers,
      totalConversations,
      activeChannels,
      totalBackends,
      totalEndUsers,
      settings: tenant?.settings,
    },
  });
});

/** Strip secrets from tenant before sending to the client. */
function maskTenantSecrets(tenant: unknown) {
  if (!tenant || typeof tenant !== 'object') return tenant;
  const t = tenant as Record<string, unknown>;
  const settings = t.settings as Record<string, unknown> | undefined;
  if (!settings?.clawscale) return tenant;
  const cs = settings.clawscale as Record<string, unknown>;
  const llm = cs.llm as Record<string, unknown> | undefined;
  if (!llm?.apiKey) return tenant;
  return {
    ...t,
    settings: {
      ...settings,
      clawscale: {
        ...cs,
        llm: { ...llm, apiKey: '••••••••' },
      },
    },
  };
}
