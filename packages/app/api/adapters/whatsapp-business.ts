/**
 * WhatsApp Business API Adapter (Meta Cloud API)
 *
 * Webhook-based: Meta sends inbound messages to /gateway/whatsapp/:channelId.
 * Replies are sent via the Graph API.
 *
 * Config fields (stored in channel.config):
 *   - phoneNumberId: Meta phone number ID
 *   - accessToken:   Permanent or long-lived access token
 *   - verifyToken:   Webhook verification token (chosen by the admin)
 *
 * Flow:
 *   1. Admin creates channel with config, sets webhook URL on Meta dashboard
 *   2. Meta sends GET for verification → we respond with hub.challenge
 *   3. Meta POSTs inbound messages → parse → routeInboundMessage() → reply via Graph API
 */

import { db } from '../db/index.js';
import { routeInboundMessage } from '../lib/route-message.js';
import type { Attachment } from '../lib/route-message.js';

const GRAPH_API_VERSION = 'v21.0';

interface WABusinessConfig {
  phoneNumberId: string;
  accessToken: string;
  verifyToken: string;
}

// ── In-memory config cache (channelId → config) ─────────────────────────────

const configs = new Map<string, WABusinessConfig>();

export function getWABusinessConfig(channelId: string): WABusinessConfig | null {
  return configs.get(channelId) ?? null;
}

// ── Start / stop ─────────────────────────────────────────────────────────────

export async function startWABusinessBot(channelId: string): Promise<void> {
  const channel = await db.channel.findUnique({ where: { id: channelId } });
  if (!channel) throw new Error(`Channel ${channelId} not found`);

  const cfg = channel.config as Record<string, string> | null;
  const phoneNumberId = cfg?.['phoneNumberId'];
  const accessToken = cfg?.['accessToken'];
  const verifyToken = cfg?.['verifyToken'];

  if (!phoneNumberId || !accessToken || !verifyToken) {
    throw new Error('WhatsApp Business: phoneNumberId, accessToken, and verifyToken are required');
  }

  configs.set(channelId, { phoneNumberId, accessToken, verifyToken });
  console.log(`[wa-business:${channelId}] Started (webhook mode, phone=${phoneNumberId})`);
}

export async function stopWABusinessBot(channelId: string): Promise<void> {
  configs.delete(channelId);
  console.log(`[wa-business:${channelId}] Stopped`);
}

/** Reload config from DB (call after config update) */
export async function reloadWABusinessBot(channelId: string): Promise<void> {
  if (configs.has(channelId)) {
    await startWABusinessBot(channelId);
  }
}

// ── Webhook verification (GET) ───────────────────────────────────────────────

export async function verifyWebhook(
  channelId: string,
  mode: string,
  token: string,
  challenge: string,
): Promise<string | null> {
  let cfg = configs.get(channelId);
  if (!cfg) {
    try {
      await startWABusinessBot(channelId);
      cfg = configs.get(channelId);
    } catch { /* ignore */ }
  }
  if (!cfg) return null;
  if (mode === 'subscribe' && token === cfg.verifyToken) return challenge;
  return null;
}

// ── Handle inbound webhook (POST) ────────────────────────────────────────────

export async function handleWABusinessWebhook(
  channelId: string,
  body: unknown,
): Promise<void> {
  let cfg = configs.get(channelId);

  // Config might not be in memory after a restart — lazy-load from DB
  if (!cfg) {
    console.warn(`[wa-business:${channelId}] Config not in memory, loading from DB…`);
    try {
      await startWABusinessBot(channelId);
      cfg = configs.get(channelId);
    } catch (err) {
      console.error(`[wa-business:${channelId}] Failed to load config:`, err);
    }
  }
  if (!cfg) {
    console.error(`[wa-business:${channelId}] No config available, dropping webhook`);
    return;
  }

  const payload = body as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<{
            from: string;
            id: string;
            type: string;
            text?: { body: string };
            image?: { id: string; mime_type?: string; caption?: string };
            video?: { id: string; mime_type?: string; caption?: string };
            audio?: { id: string; mime_type?: string };
            document?: { id: string; mime_type?: string; filename?: string; caption?: string };
            sticker?: { id: string; mime_type?: string };
          }>;
          contacts?: Array<{
            profile?: { name?: string };
            wa_id?: string;
          }>;
        };
      }>;
    }>;
  };

  if (!payload.entry) return;

  for (const entry of payload.entry) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      if (!value?.messages) continue;

      // Build a contact lookup for display names
      const contactNames = new Map<string, string>();
      for (const contact of value.contacts ?? []) {
        if (contact.wa_id && contact.profile?.name) {
          contactNames.set(contact.wa_id, contact.profile.name);
        }
      }

      for (const msg of value.messages) {
        let text = '';
        const attachments: Attachment[] = [];

        if (msg.type === 'text' && msg.text?.body) {
          text = msg.text.body.trim();
        } else if (msg.type === 'image' && msg.image) {
          text = msg.image.caption?.trim() || '(image)';
          attachments.push({
            url: `https://graph.facebook.com/${GRAPH_API_VERSION}/${msg.image.id}`,
            filename: 'image.jpg',
            contentType: msg.image.mime_type ?? 'image/jpeg',
          });
        } else if (msg.type === 'video' && msg.video) {
          text = msg.video.caption?.trim() || '(video)';
          attachments.push({
            url: `https://graph.facebook.com/${GRAPH_API_VERSION}/${msg.video.id}`,
            filename: 'video.mp4',
            contentType: msg.video.mime_type ?? 'video/mp4',
          });
        } else if (msg.type === 'audio' && msg.audio) {
          text = '(audio)';
          attachments.push({
            url: `https://graph.facebook.com/${GRAPH_API_VERSION}/${msg.audio.id}`,
            filename: 'audio.ogg',
            contentType: msg.audio.mime_type ?? 'audio/ogg',
          });
        } else if (msg.type === 'document' && msg.document) {
          text = msg.document.caption?.trim() || '(document)';
          attachments.push({
            url: `https://graph.facebook.com/${GRAPH_API_VERSION}/${msg.document.id}`,
            filename: msg.document.filename ?? 'file',
            contentType: msg.document.mime_type ?? 'application/octet-stream',
          });
        } else if (msg.type === 'sticker' && msg.sticker) {
          text = '(sticker)';
          attachments.push({
            url: `https://graph.facebook.com/${GRAPH_API_VERSION}/${msg.sticker.id}`,
            filename: 'sticker.webp',
            contentType: msg.sticker.mime_type ?? 'image/webp',
          });
        } else {
          continue;
        }

        if (!text && attachments.length === 0) continue;

        const externalId = msg.from;
        const displayName = contactNames.get(msg.from);

        try {
          console.log(`[wa-business:${channelId}] Incoming from ${externalId}: "${text}"${attachments.length ? ` (+${attachments.length} attachment(s))` : ''}`);
          const result = await routeInboundMessage({
            channelId,
            externalId,
            displayName,
            text: text || '(attachment)',
            attachments: attachments.length > 0 ? attachments : undefined,
            meta: { platform: 'whatsapp_business', messageId: msg.id },
          });

          if (result?.reply) {
            console.log(`[wa-business:${channelId}] Sending reply to ${externalId} (${result.reply.length} chars)`);
            await sendTextMessage(cfg, externalId, result.reply);
          } else {
            console.warn(`[wa-business:${channelId}] No reply from routeInboundMessage`);
          }
        } catch (err) {
          console.error(`[wa-business:${channelId}] Error routing message:`, err);
        }
      }
    }
  }
}

// ── Send message via Graph API ───────────────────────────────────────────────

async function sendTextMessage(
  cfg: WABusinessConfig,
  to: string,
  text: string,
): Promise<void> {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${cfg.phoneNumberId}/messages`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`[wa-business] Send failed (${res.status}): ${body}`);
  }
}

// ── Boot all connected WA Business channels on startup ───────────────────────

export async function initWABusinessAdapters(): Promise<void> {
  const rows = await db.channel.findMany({
    where: { type: 'whatsapp_business', status: 'connected' },
    select: { id: true },
  });

  for (const row of rows) {
    try {
      await startWABusinessBot(row.id);
    } catch (err) {
      console.error(`[wa-business:${row.id}] Failed to start:`, err);
    }
  }

  console.log(`[wa-business] Initialized ${rows.length} WhatsApp Business channel(s)`);
}
