import { Router } from 'express';
import { db } from '../db/index.js';
import { generateId } from '../lib/id.js';
import { startWhatsAppBot, getWhatsAppQR, getWhatsAppStatus } from '../adapters/whatsapp.js';
import { startWeixinQR, getWeixinQR, getWeixinStatus } from '../adapters/wechat.js';
import { USER_PROVISIONED_CHANNELS, CHANNEL_CONFIG_SCHEMA } from '@clawscale/shared';
import type { TenantSettings, OnboardingBranding, ChannelType } from '@clawscale/shared';

const onboardRouter = Router();

/* ─── Rate limiter (in-memory, per IP) ─── */
const connectAttempts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 5;
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = connectAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    connectAttempts.set(ip, { count: 1, resetAt: now + RATE_WINDOW });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

/**
 * GET /api/onboard/channels
 * Public endpoint — returns active channels for the project
 * plus user-provisioned channel types.
 */
onboardRouter.get('/channels', async (req, res) => {
  const tenant = await db.tenant.findFirst({
    select: { id: true, name: true, settings: true },
  });

  if (!tenant) {
    res.status(404).json({ error: 'No project configured' });
    return;
  }

  const settings = (tenant.settings ?? {}) as unknown as TenantSettings;
  const branding: OnboardingBranding = settings.onboarding ?? {};

  const channels = await db.channel.findMany({
    where: { tenantId: tenant.id, status: 'connected' },
    select: { id: true, type: true, name: true, config: true },
  });

  const publicChannels = channels.map((ch) => {
    const cfg = (ch.config ?? {}) as Record<string, unknown>;

    // Auto-derive connect URLs from existing config when possible
    let connectUrl = (cfg.connectUrl ?? cfg.botInviteUrl ?? cfg.botLink ?? null) as string | null;
    let botUsername = (cfg.botUsername ?? null) as string | null;
    let phoneNumber = (cfg.publicPhoneNumber ?? cfg.phoneNumber ?? null) as string | null;

    if (!connectUrl) {
      switch (ch.type) {
        case 'discord':
          if (cfg.applicationId) connectUrl = `https://discord.com/oauth2/authorize?client_id=${cfg.applicationId}&permissions=274877910016&scope=bot`;
          break;
        case 'telegram':
          if (cfg.botUsername) connectUrl = `https://t.me/${cfg.botUsername}`;
          else if (cfg.botToken && typeof cfg.botToken === 'string') {
            // Can't derive username from token, but set a placeholder instruction
          }
          break;
        case 'whatsapp_business':
          if (phoneNumber) connectUrl = `https://wa.me/${(phoneNumber as string).replace(/[^0-9]/g, '')}`;
          break;
        case 'line':
          if (cfg.botBasicId) connectUrl = `https://line.me/R/ti/p/${cfg.botBasicId}`;
          break;
        case 'facebook':
          if (cfg.pageId) connectUrl = `https://m.me/${cfg.pageId}`;
          break;
        case 'instagram':
          if (botUsername) connectUrl = `https://ig.me/m/${botUsername}`;
          break;
      }
    }

    return {
      id: ch.id,
      type: ch.type,
      name: ch.name,
      connectUrl,
      phoneNumber,
      botUsername,
    };
  });

  // User-provisioned types are always available for new connections
  const userProvisionedTypes = USER_PROVISIONED_CHANNELS.map((type) => ({
    type,
    label: CHANNEL_CONFIG_SCHEMA[type].label,
  }));

  res.json({
    tenantName: tenant.name,
    branding,
    channels: publicChannels,
    userProvisionedTypes,
  });
});

/**
 * POST /api/onboard/connect
 * Public endpoint — starts a QR session for a user-provisioned channel.
 * Auto-creates the channel record if it doesn't exist.
 */
onboardRouter.post('/connect', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] as string ?? req.headers['x-real-ip'] as string ?? 'unknown';
  if (isRateLimited(ip)) {
    res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    return;
  }

  const body = req.body ?? {};
  const type = body.type as ChannelType | undefined;

  if (!type || !USER_PROVISIONED_CHANNELS.includes(type)) {
    res.status(400).json({ error: 'Invalid channel type' });
    return;
  }

  const tenant = await db.tenant.findFirst({ select: { id: true } });
  if (!tenant) { res.status(404).json({ error: 'No project configured' }); return; }

  // Create a new channel for each user connection
  const id = generateId('ch');
  const label = CHANNEL_CONFIG_SCHEMA[type].label;
  const channel = await db.channel.create({
    data: {
      id,
      tenantId: tenant.id,
      type,
      name: label,
      status: 'pending',
      config: {},
    },
    select: { id: true, status: true },
  });

  if (type === 'whatsapp') {
    startWhatsAppBot(channel.id).catch(() => {});
  } else if (type === 'wechat_personal') {
    startWeixinQR(channel.id).catch(() => {});
  }

  res.json({ ok: true, data: { channelId: channel.id, status: 'pending' } });
});

/**
 * GET /api/onboard/qr/:channelId
 * Public QR polling endpoint — only for user-provisioned channels.
 */
onboardRouter.get('/qr/:channelId', async (req, res) => {
  const channelId = req.params.channelId as string;

  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { id: true, type: true, status: true },
  });

  if (!channel) { res.status(404).json({ ok: false, error: 'Channel not found' }); return; }
  if (!USER_PROVISIONED_CHANNELS.includes(channel.type as ChannelType)) {
    res.status(400).json({ ok: false, error: 'Channel does not support QR login' });
    return;
  }

  // Already connected
  if (channel.status === 'connected') {
    res.json({ ok: true, data: { qr: null, qrUrl: null, status: 'connected' } });
    return;
  }

  if (channel.type === 'wechat_personal') {
    let qr = getWeixinQR(channelId);
    if (!qr && getWeixinStatus(channelId) === 'qr_pending') {
      await new Promise<void>((resolve) => {
        const deadline = Date.now() + 35_000;
        const check = setInterval(() => {
          qr = getWeixinQR(channelId);
          if (qr || Date.now() > deadline) { clearInterval(check); resolve(); }
        }, 300);
      });
    }
    const status = getWeixinStatus(channelId);
    res.json({ ok: true, data: { qr: qr?.image ?? null, qrUrl: qr?.url ?? null, status } });
    return;
  }

  // WhatsApp
  let qr = getWhatsAppQR(channelId);
  if (!qr && getWhatsAppStatus(channelId) === 'qr_pending') {
    await new Promise<void>((resolve) => {
      const deadline = Date.now() + 10_000;
      const check = setInterval(() => {
        qr = getWhatsAppQR(channelId);
        if (qr || Date.now() > deadline) { clearInterval(check); resolve(); }
      }, 300);
    });
  }

  const status = getWhatsAppStatus(channelId);
  res.json({ ok: true, data: { qr: qr?.image ?? null, qrUrl: qr?.url ?? null, status } });
});

export { onboardRouter };
