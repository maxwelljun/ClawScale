import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/index.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { generateId } from '../lib/id.js';
import { audit } from '../lib/audit.js';
import { validate } from '../middleware/validate.js';
import { startDiscordBot, stopDiscordBot } from '../adapters/discord.js';
import { startWeChatBot, stopWeChatBot } from '../adapters/wecom.js';
import { startWeixinBot, startWeixinQR, stopWeixinBot, getWeixinQR, getWeixinStatus } from '../adapters/wechat.js';
import { startWhatsAppBot, stopWhatsAppBot, getWhatsAppQR, getWhatsAppStatus } from '../adapters/whatsapp.js';
import { startWABusinessBot, stopWABusinessBot, reloadWABusinessBot } from '../adapters/whatsapp-business.js';
import { startTelegramBot, stopTelegramBot } from '../adapters/telegram.js';
import { startSlackBot, stopSlackBot } from '../adapters/slack.js';
import { startMatrixBot, stopMatrixBot } from '../adapters/matrix.js';
import { startLineBot, stopLineBot } from '../adapters/line.js';
import { startSignalBot, stopSignalBot } from '../adapters/signal.js';
import { startTeamsBot, stopTeamsBot } from '../adapters/teams.js';

const CHANNEL_TYPES = [
  'whatsapp', 'whatsapp_business', 'telegram', 'slack', 'discord', 'instagram',
  'facebook', 'line', 'signal', 'teams', 'matrix', 'web', 'wechat_work', 'wechat_personal',
] as const;

const createSchema = z.object({
  type: z.enum(CHANNEL_TYPES),
  name: z.string().min(1).max(80),
  config: z.record(z.unknown()).default({}),
});

const updateSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  config: z.record(z.unknown()).optional(),
});

const channelListSelect = {
  id: true,
  tenantId: true,
  type: true,
  name: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  // config intentionally omitted (contains secrets)
} as const;

export const channelsRouter = Router();
channelsRouter.use(requireAuth);

// ── GET /api/channels ────────────────────────────────────────────────────────
channelsRouter.get('/', async (req, res) => {
  const { tenantId } = req.auth!;

  const rows = await db.channel.findMany({
    where: { tenantId },
    select: channelListSelect,
  });

  res.json({ ok: true, data: rows });
});

// ── POST /api/channels ───────────────────────────────────────────────────────
channelsRouter.post('/', requireAdmin, validate(createSchema), async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const body = req.body;

  const id = generateId('ch');
  await db.channel.create({
    data: {
      id,
      tenantId,
      type: body.type,
      name: body.name,
      config: body.config as any,
      status: 'disconnected',
    },
  });

  await audit({ tenantId, memberId: userId, action: 'create_channel', resource: 'channel', resourceId: id });

  const created = await db.channel.findUnique({ where: { id }, select: channelListSelect });
  res.status(201).json({ ok: true, data: created });
});

// ── GET /api/channels/:id ────────────────────────────────────────────────────
channelsRouter.get('/:id', requireAdmin, async (req, res) => {
  const { tenantId } = req.auth!;
  const id = req.params.id as string;

  // Return config only on single-channel fetch (for editing)
  const channel = await db.channel.findFirst({ where: { id, tenantId } });

  if (!channel) { res.status(404).json({ ok: false, error: 'Channel not found' }); return; }
  res.json({ ok: true, data: channel });
});

// ── PATCH /api/channels/:id ──────────────────────────────────────────────────
channelsRouter.patch('/:id', requireAdmin, validate(updateSchema), async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const id = req.params.id as string;
  const body = req.body;

  const existing = await db.channel.findFirst({
    where: { id, tenantId },
    select: { id: true },
  });

  if (!existing) { res.status(404).json({ ok: false, error: 'Channel not found' }); return; }

  await db.channel.update({ where: { id }, data: body as any });
  await audit({ tenantId, memberId: userId, action: 'update_channel', resource: 'channel', resourceId: id });

  // Reload in-memory config for adapters that cache it
  const full = await db.channel.findUnique({ where: { id } });
  if (full?.type === 'whatsapp_business') {
    reloadWABusinessBot(id).catch((err) =>
      console.error(`[wa-business:${id}] Failed to reload config:`, err),
    );
  }

  const updated = await db.channel.findUnique({ where: { id }, select: channelListSelect });
  res.json({ ok: true, data: updated });
});

// ── DELETE /api/channels/:id ─────────────────────────────────────────────────
channelsRouter.delete('/:id', requireAdmin, async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const id = req.params.id as string;

  const existing = await db.channel.findFirst({ where: { id, tenantId } });
  if (!existing) { res.status(404).json({ ok: false, error: 'Channel not found' }); return; }

  if (existing.type === 'discord') {
    stopDiscordBot(id).catch(() => {});
  } else if (existing.type === 'wechat_work') {
    stopWeChatBot(id).catch(() => {});
  } else if (existing.type === 'wechat_personal') {
    stopWeixinBot(id).catch(() => {});
  } else if (existing.type === 'whatsapp') {
    stopWhatsAppBot(id).catch(() => {});
  } else if (existing.type === 'whatsapp_business') {
    stopWABusinessBot(id).catch(() => {});
  } else if (existing.type === 'telegram') {
    stopTelegramBot(id).catch(() => {});
  } else if (existing.type === 'slack') {
    stopSlackBot(id).catch(() => {});
  } else if (existing.type === 'matrix') {
    stopMatrixBot(id).catch(() => {});
  } else if (existing.type === 'line') {
    stopLineBot(id).catch(() => {});
  } else if (existing.type === 'signal') {
    stopSignalBot(id).catch(() => {});
  } else if (existing.type === 'teams') {
    stopTeamsBot(id).catch(() => {});
  }

  await db.channel.delete({ where: { id } });
  await audit({ tenantId, memberId: userId, action: 'delete_channel', resource: 'channel', resourceId: id });

  res.json({ ok: true, data: null });
});

// ── POST /api/channels/:id/connect ──────────────────────────────────────────
channelsRouter.post('/:id/connect', requireAdmin, async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const id = req.params.id as string;

  const channel = await db.channel.findFirst({ where: { id, tenantId } });
  if (!channel) { res.status(404).json({ ok: false, error: 'Channel not found' }); return; }
  if (channel.status === 'connected') {
    res.json({ ok: true, data: { status: 'connected' } });
    return;
  }

  await db.channel.update({ where: { id }, data: { status: 'connected' } });
  await audit({ tenantId, memberId: userId, action: 'connect_channel', resource: 'channel', resourceId: id });

  // Start platform-specific adapter
  if (channel.type === 'discord') {
    const config = channel.config as Record<string, string> | null;
    const botToken = config?.['botToken'];
    if (botToken) {
      startDiscordBot(id, botToken).catch((err) =>
        console.error(`[discord:${id}] Failed to start bot:`, err),
      );
    }
  } else if (channel.type === 'wechat_work') {
    const config = channel.config as Record<string, string> | null;
    const botId = config?.['botId'];
    const secret = config?.['secret'];
    if (botId && secret) {
      startWeChatBot(id, botId, secret).catch((err) =>
        console.error(`[wechat:${id}] Failed to start bot:`, err),
      );
    }
  } else if (channel.type === 'wechat_personal') {
    await db.channel.update({ where: { id }, data: { status: 'pending' } });
    startWeixinQR(id).catch((err) =>
      console.error(`[weixin:${id}] Failed to start QR:`, err),
    );
    res.json({ ok: true, data: { status: 'pending' } });
    return;
  } else if (channel.type === 'whatsapp') {
    // WhatsApp: start QR flow, status stays 'pending' until phone scans
    await db.channel.update({ where: { id }, data: { status: 'pending' } });
    startWhatsAppBot(id).catch((err) =>
      console.error(`[whatsapp:${id}] Failed to start bot:`, err),
    );
    res.json({ ok: true, data: { status: 'pending' } });
    return;
  } else if (channel.type === 'whatsapp_business') {
    startWABusinessBot(id).catch((err) =>
      console.error(`[wa-business:${id}] Failed to start:`, err),
    );
  } else if (channel.type === 'telegram') {
    const config = channel.config as Record<string, string> | null;
    const botToken = config?.['botToken'];
    if (botToken) {
      startTelegramBot(id, botToken).catch((err) =>
        console.error(`[telegram:${id}] Failed to start bot:`, err),
      );
    }
  } else if (channel.type === 'slack') {
    const config = channel.config as Record<string, string> | null;
    const botToken = config?.['botToken'];
    const appToken = config?.['appToken'];
    if (botToken && appToken) {
      startSlackBot(id, botToken, appToken).catch((err) =>
        console.error(`[slack:${id}] Failed to start bot:`, err),
      );
    }
  } else if (channel.type === 'matrix') {
    const config = channel.config as Record<string, string> | null;
    const homeserverUrl = config?.['homeserverUrl'];
    const accessToken = config?.['accessToken'];
    if (homeserverUrl && accessToken) {
      startMatrixBot(id, homeserverUrl, accessToken).catch((err) =>
        console.error(`[matrix:${id}] Failed to start bot:`, err),
      );
    }
  } else if (channel.type === 'line') {
    const config = channel.config as Record<string, string> | null;
    const channelAccessToken = config?.['channelAccessToken'];
    const channelSecret = config?.['channelSecret'];
    if (channelAccessToken && channelSecret) {
      startLineBot(id, channelAccessToken, channelSecret).catch((err) =>
        console.error(`[line:${id}] Failed to start bot:`, err),
      );
    }
  } else if (channel.type === 'signal') {
    const config = channel.config as Record<string, string> | null;
    const phoneNumber = config?.['phoneNumber'];
    const signalCliUrl = config?.['signalCliUrl'] ?? 'http://localhost:8080';
    if (phoneNumber) {
      startSignalBot(id, phoneNumber, signalCliUrl).catch((err) =>
        console.error(`[signal:${id}] Failed to start bot:`, err),
      );
    }
  } else if (channel.type === 'teams') {
    const config = channel.config as Record<string, string> | null;
    const appId = config?.['appId'];
    const appPassword = config?.['appPassword'];
    if (appId && appPassword) {
      startTeamsBot(id, appId, appPassword).catch((err) =>
        console.error(`[teams:${id}] Failed to start bot:`, err),
      );
    }
  }

  res.json({ ok: true, data: { status: 'connected' } });
});

// ── POST /api/channels/:id/disconnect ───────────────────────────────────────
channelsRouter.post('/:id/disconnect', requireAdmin, async (req, res) => {
  const { tenantId, userId } = req.auth!;
  const id = req.params.id as string;

  const channel = await db.channel.findFirst({ where: { id, tenantId } });
  if (!channel) { res.status(404).json({ ok: false, error: 'Channel not found' }); return; }

  await db.channel.update({ where: { id }, data: { status: 'disconnected' } });
  await audit({ tenantId, memberId: userId, action: 'disconnect_channel', resource: 'channel', resourceId: id });

  // Stop platform-specific adapter
  if (channel.type === 'discord') {
    stopDiscordBot(id).catch((err) =>
      console.error(`[discord:${id}] Failed to stop bot:`, err),
    );
  } else if (channel.type === 'wechat_work') {
    stopWeChatBot(id).catch((err) =>
      console.error(`[wechat:${id}] Failed to stop bot:`, err),
    );
  } else if (channel.type === 'wechat_personal') {
    stopWeixinBot(id).catch((err) =>
      console.error(`[weixin:${id}] Failed to stop:`, err),
    );
  } else if (channel.type === 'whatsapp') {
    stopWhatsAppBot(id).catch((err) =>
      console.error(`[whatsapp:${id}] Failed to stop bot:`, err),
    );
  } else if (channel.type === 'whatsapp_business') {
    stopWABusinessBot(id).catch((err) =>
      console.error(`[wa-business:${id}] Failed to stop:`, err),
    );
  } else if (channel.type === 'telegram') {
    stopTelegramBot(id).catch((err) =>
      console.error(`[telegram:${id}] Failed to stop bot:`, err),
    );
  } else if (channel.type === 'slack') {
    stopSlackBot(id).catch((err) =>
      console.error(`[slack:${id}] Failed to stop bot:`, err),
    );
  } else if (channel.type === 'matrix') {
    stopMatrixBot(id).catch((err) =>
      console.error(`[matrix:${id}] Failed to stop bot:`, err),
    );
  } else if (channel.type === 'line') {
    stopLineBot(id).catch((err) =>
      console.error(`[line:${id}] Failed to stop bot:`, err),
    );
  } else if (channel.type === 'signal') {
    stopSignalBot(id).catch((err) =>
      console.error(`[signal:${id}] Failed to stop bot:`, err),
    );
  } else if (channel.type === 'teams') {
    stopTeamsBot(id).catch((err) =>
      console.error(`[teams:${id}] Failed to stop bot:`, err),
    );
  }

  res.json({ ok: true, data: { status: 'disconnected' } });
});

// ── GET /api/channels/:id/qr ─────────────────────────────────────────────────
channelsRouter.get('/:id/qr', requireAdmin, async (req, res) => {
  const { tenantId } = req.auth!;
  const id = req.params.id as string;

  const channel = await db.channel.findFirst({ where: { id, tenantId }, select: { id: true, type: true } });
  if (!channel) { res.status(404).json({ ok: false, error: 'Channel not found' }); return; }
  if (channel.type !== 'whatsapp' && channel.type !== 'wechat_personal') {
    res.status(400).json({ ok: false, error: 'Channel does not support QR login' });
    return;
  }

  if (channel.type === 'wechat_personal') {
    let qr = getWeixinQR(id);
    if (!qr && getWeixinStatus(id) === 'qr_pending') {
      await new Promise<void>((resolve) => {
        const deadline = Date.now() + 35_000;
        const check = setInterval(() => {
          qr = getWeixinQR(id);
          if (qr || Date.now() > deadline) { clearInterval(check); resolve(); }
        }, 300);
      });
    }
    const status = getWeixinStatus(id);
    res.json({ ok: true, data: { qr: qr?.image ?? null, qrUrl: qr?.url ?? null, status } });
    return;
  }

  // Wait up to 10s for QR to be ready if not yet available
  let qr = getWhatsAppQR(id);
  if (!qr && getWhatsAppStatus(id) === 'qr_pending') {
    await new Promise<void>((resolve) => {
      const deadline = Date.now() + 10_000;
      const check = setInterval(() => {
        qr = getWhatsAppQR(id);
        if (qr || Date.now() > deadline) { clearInterval(check); resolve(); }
      }, 300);
    });
  }

  const status = getWhatsAppStatus(id);
  res.json({ ok: true, data: { qr: qr?.image ?? null, qrUrl: qr?.url ?? null, status } });
});
