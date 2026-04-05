import { Hono } from 'hono';
import { db } from '../db/index.js';
import type { TenantSettings, OnboardingBranding } from '@clawscale/shared';

const onboardRouter = new Hono();

/**
 * GET /api/onboard/channels
 * Public endpoint — returns active channels for the project
 * plus onboarding branding settings.
 * Single-project deployment: fetches the first (only) tenant.
 */
onboardRouter.get('/channels', async (c) => {
  const tenant = await db.tenant.findFirst({
    select: { id: true, name: true, settings: true },
  });

  if (!tenant) {
    return c.json({ error: 'No project configured' }, 404);
  }

  const settings = (tenant.settings ?? {}) as unknown as TenantSettings;
  const branding: OnboardingBranding = settings.onboarding ?? {};

  const channels = await db.channel.findMany({
    where: { tenantId: tenant.id, status: 'connected' },
    select: {
      id: true,
      type: true,
      name: true,
      config: true,
    },
  });

  // Extract only public connect info from each channel's config
  const publicChannels = channels.map((ch) => {
    const cfg = (ch.config ?? {}) as Record<string, unknown>;
    return {
      id: ch.id,
      type: ch.type,
      name: ch.name,
      connectUrl: cfg.connectUrl ?? cfg.botInviteUrl ?? cfg.botLink ?? null,
      phoneNumber: cfg.publicPhoneNumber ?? cfg.phoneNumber ?? null,
      qrAvailable: ch.type === 'wechat_personal',
    };
  });

  return c.json({
    tenantName: tenant.name,
    branding,
    channels: publicChannels,
  });
});

export { onboardRouter };
