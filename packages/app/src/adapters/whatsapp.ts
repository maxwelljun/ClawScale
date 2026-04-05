/**
 * WhatsApp Adapter (via @whiskeysockets/baileys)
 *
 * Manages one Baileys socket per connected WhatsApp channel.
 * Connection is established by scanning a QR code.
 *
 * Flow:
 *   1. Owner requests QR → startWhatsAppQR() → returns base64 PNG
 *   2. Owner scans QR with phone → socket connects → status = connected
 *   3. Incoming message → normalize → POST /gateway/:channelId → reply
 */

import path from 'path';
import fs from 'fs';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import type { WASocket } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode';
import pino from 'pino';
import { db } from '../db/index.js';
import { routeInboundMessage } from '../lib/route-message.js';
import type { Attachment } from '../lib/route-message.js';

const logger = pino({ level: 'silent' });

// Cache the WA version so we only fetch it once per process
let waVersion: [number, number, number] | null = null;
async function getWAVersion(): Promise<[number, number, number]> {
  if (!waVersion) {
    const { version } = await fetchLatestBaileysVersion();
    waVersion = version;
    console.log(`[whatsapp] Using WA version ${version.join('.')}`);
  }
  return waVersion;
}

const AUTH_BASE = process.env['WHATSAPP_AUTH_DIR'] ?? path.join(process.cwd(), 'data', 'whatsapp');

// ── State per channel ─────────────────────────────────────────────────────────

interface ChannelState {
  socket: WASocket | null;
  qr: string | null;          // base64 PNG, set while waiting for scan
  qrUrl: string | null;       // raw string encoded in the QR
  status: 'qr_pending' | 'connected' | 'disconnected';
}

const channels = new Map<string, ChannelState>();

function getAuthDir(channelId: string): string {
  const dir = path.join(AUTH_BASE, channelId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Start / connect a WhatsApp session ───────────────────────────────────────

export async function startWhatsAppBot(channelId: string, isReconnect = false): Promise<void> {
  const existing = channels.get(channelId);
  if (!isReconnect && existing?.status === 'connected') return;
  // Clear stale state so the new socket takes over cleanly
  channels.delete(channelId);

  const authDir = getAuthDir(channelId);
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const version = await getWAVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger,
  });

  channels.set(channelId, { socket: sock, qr: null, qrUrl: null, status: 'qr_pending' });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      const png = await qrcode.toDataURL(qr);
      const ch = channels.get(channelId);
      if (ch) { ch.qr = png; ch.qrUrl = qr; }
      console.log(`[whatsapp:${channelId}] QR code ready`);
    }

    if (connection === 'open') {
      const ch = channels.get(channelId);
      if (ch) { ch.status = 'connected'; ch.qr = null; }
      await db.channel.update({ where: { id: channelId }, data: { status: 'connected' } });
      console.log(`[whatsapp:${channelId}] Connected`);
    }

    if (connection === 'close') {
      const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
      const shouldReconnect = reason !== DisconnectReason.loggedOut;
      console.log(`[whatsapp:${channelId}] Disconnected, reason: ${reason}, reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        // Re-create socket after a short delay
        setTimeout(() => startWhatsAppBot(channelId, true), 3000);
      } else {
        // Logged out — clear credentials
        fs.rmSync(getAuthDir(channelId), { recursive: true, force: true });
        channels.delete(channelId);
        await db.channel.update({ where: { id: channelId }, data: { status: 'disconnected' } });
      }
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    console.log(`[whatsapp:${channelId}] messages.upsert type=${type} count=${messages.length}`);
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (!msg.message) continue;

      let text =
        msg.message.conversation ??
        msg.message.extendedTextMessage?.text ??
        '';

      // Extract attachments from media messages
      const attachments: Attachment[] = [];
      const m = msg.message;

      if (m.imageMessage) {
        text = text || m.imageMessage.caption || '(image)';
        attachments.push({
          url: m.imageMessage.url ?? '',
          filename: 'image.jpg',
          contentType: m.imageMessage.mimetype ?? 'image/jpeg',
          size: m.imageMessage.fileLength ? Number(m.imageMessage.fileLength) : undefined,
        });
      }
      if (m.videoMessage) {
        text = text || m.videoMessage.caption || '(video)';
        attachments.push({
          url: m.videoMessage.url ?? '',
          filename: 'video.mp4',
          contentType: m.videoMessage.mimetype ?? 'video/mp4',
          size: m.videoMessage.fileLength ? Number(m.videoMessage.fileLength) : undefined,
        });
      }
      if (m.audioMessage) {
        text = text || '(audio)';
        attachments.push({
          url: m.audioMessage.url ?? '',
          filename: 'audio.ogg',
          contentType: m.audioMessage.mimetype ?? 'audio/ogg',
          size: m.audioMessage.fileLength ? Number(m.audioMessage.fileLength) : undefined,
        });
      }
      if (m.documentMessage) {
        text = text || m.documentMessage.caption || '(document)';
        attachments.push({
          url: m.documentMessage.url ?? '',
          filename: m.documentMessage.fileName ?? 'file',
          contentType: m.documentMessage.mimetype ?? 'application/octet-stream',
          size: m.documentMessage.fileLength ? Number(m.documentMessage.fileLength) : undefined,
        });
      }
      if (m.stickerMessage) {
        text = text || '(sticker)';
        attachments.push({
          url: m.stickerMessage.url ?? '',
          filename: 'sticker.webp',
          contentType: m.stickerMessage.mimetype ?? 'image/webp',
          size: m.stickerMessage.fileLength ? Number(m.stickerMessage.fileLength) : undefined,
        });
      }

      const validAttachments = attachments.filter((a) => a.url);

      console.log(`[whatsapp:${channelId}] Incoming from ${msg.key.remoteJid}: "${text}"${validAttachments.length ? ` (+${validAttachments.length} attachment(s))` : ''}`);
      if (!text.trim() && validAttachments.length === 0) continue;

      const externalId = msg.key.remoteJid ?? 'unknown';
      const displayName = msg.pushName ?? undefined;

      try {
        const result = await routeInboundMessage({
          channelId, externalId, displayName,
          text: text.trim() || '(attachment)',
          attachments: validAttachments.length > 0 ? validAttachments : undefined,
          meta: { platform: 'whatsapp', messageId: msg.key.id },
        });
        if (result?.reply && sock) await sock.sendMessage(externalId, { text: result.reply });
      } catch (err) {
        console.error(`[whatsapp:${channelId}] Error routing message:`, err);
      }
    }
  });
}

// ── Get current QR code (base64 PNG + raw URL) ───────────────────────────────

export function getWhatsAppQR(channelId: string): { image: string; url: string } | null {
  const ch = channels.get(channelId);
  if (!ch?.qr) return null;
  return { image: ch.qr, url: ch.qrUrl ?? '' };
}

// ── Get current status ────────────────────────────────────────────────────────

export function getWhatsAppStatus(channelId: string): ChannelState['status'] | null {
  return channels.get(channelId)?.status ?? null;
}

// ── Stop / disconnect ─────────────────────────────────────────────────────────

export async function stopWhatsAppBot(channelId: string): Promise<void> {
  const ch = channels.get(channelId);
  if (!ch) return;
  try { await ch.socket?.logout(); } catch { /* ignore */ }
  fs.rmSync(getAuthDir(channelId), { recursive: true, force: true });
  channels.delete(channelId);
  console.log(`[whatsapp:${channelId}] Stopped and logged out`);
}

// ── Boot all connected WhatsApp channels on startup ───────────────────────────

export async function initWhatsAppAdapters(): Promise<void> {
  const rows = await db.channel.findMany({
    where: { type: 'whatsapp', status: 'connected' },
    select: { id: true },
  });

  for (const row of rows) {
    try {
      await startWhatsAppBot(row.id);
    } catch (err) {
      console.error(`[whatsapp:${row.id}] Failed to start:`, err);
    }
  }

  console.log(`[whatsapp] Initialized ${rows.length} WhatsApp bot(s)`);
}
