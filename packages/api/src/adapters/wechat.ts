/**
 * WeChat Personal Adapter
 *
 * Implements QR login + messaging against Tencent's iLink Bot API directly.
 *
 * Login flow:
 *   GET /ilink/bot/get_bot_qrcode  → qrcode + qrcode_img_content (SVG/PNG)
 *   Poll GET /ilink/bot/get_qrcode_status → wait | scaned | confirmed | expired
 *   On confirmed → bot_token, baseurl, ilink_bot_id saved to channel config
 *
 * Messaging:
 *   POST /ilink/bot/getupdates  (35s long-poll)
 *   POST /ilink/bot/sendmessage
 */

import crypto from 'node:crypto';
import qrcode from 'qrcode';
import { db } from '../db/index.js';
import { routeInboundMessage } from '../lib/route-message.js';
import type { Attachment } from '../lib/route-message.js';

const DEFAULT_BASE_URL = 'https://ilinkai.weixin.qq.com';

// ── State ─────────────────────────────────────────────────────────────────────

interface WeixinState {
  running: boolean;
  cursor: string;
  qr: string | null;         // base64 PNG for dashboard
  qrUrl: string | null;      // raw string encoded in the QR
  status: 'qr_pending' | 'connected' | 'disconnected';
}

const channels = new Map<string, WeixinState>();

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function msgHeaders(token: string, body?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'Authorization': `Bearer ${token}`,
    'X-WECHAT-UIN': Buffer.from(String(Math.floor(Math.random() * 0xffffffff))).toString('base64'),
  };
  if (body !== undefined) headers['Content-Length'] = String(Buffer.byteLength(body, 'utf-8'));
  return headers;
}

/**
 * Download and decrypt WeChat CDN media.
 * Content is AES-128-ECB encrypted. The key is a 32-char hex string.
 * Returns a data: URL with the decrypted content.
 */
async function downloadCdnMedia(
  cdnUrl: string,
  aesKeyHex: string,
  contentType: string,
): Promise<string | null> {
  try {
    const res = await fetch(cdnUrl, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) {
      console.error(`[weixin] CDN download failed: ${res.status}`);
      return null;
    }

    const encrypted = Buffer.from(await res.arrayBuffer());
    const key = Buffer.from(aesKeyHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
    decipher.setAutoPadding(true);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);

    return `data:${contentType};base64,${decrypted.toString('base64')}`;
  } catch (err) {
    console.error('[weixin] CDN media decrypt error:', err);
    return null;
  }
}

// ── QR Login ──────────────────────────────────────────────────────────────────

export async function startWeixinQR(channelId: string): Promise<void> {
  const state: WeixinState = { running: true, cursor: '', qr: null, qrUrl: null, status: 'qr_pending' };
  channels.set(channelId, state);

  // Run login flow in background
  loginFlow(channelId).catch((err) =>
    console.error(`[weixin:${channelId}] Login flow error:`, err),
  );
}

async function loginFlow(channelId: string): Promise<void> {
  const state = channels.get(channelId);
  if (!state) return;

  let attempts = 0;

  while (state.running && attempts < 3) {
    // 1. Fetch QR code
    const qrRes = await fetch(`${DEFAULT_BASE_URL}/ilink/bot/get_bot_qrcode?bot_type=3`, {
      headers: { 'iLink-App-ClientVersion': '1' },
      signal: AbortSignal.timeout(30_000),
    });

    const qrRaw = await qrRes.text();
    console.log(`[weixin:${channelId}] QR response (${qrRes.status}):`, qrRaw.slice(0, 500));
    const qrData = JSON.parse(qrRaw) as { qrcode?: string; qrcode_img_content?: string };
    const qrcodeId = qrData.qrcode;
    const imgContent = qrData.qrcode_img_content;

    if (!qrcodeId || !imgContent) {
      console.error(`[weixin:${channelId}] Failed to get QR code`);
      return;
    }

    // Convert QR content to PNG data URL for dashboard display
    state.qr = await qrcode.toDataURL(imgContent);
    state.qrUrl = imgContent;
    console.log(`[weixin:${channelId}] QR code ready`);

    // 2. Poll for scan status (max 8 hours)
    const deadline = Date.now() + 8 * 60 * 60 * 1000;

    while (state.running && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1000));

      const statusRes = await fetch(
        `${DEFAULT_BASE_URL}/ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcodeId)}`,
        { headers: { 'iLink-App-ClientVersion': '1' }, signal: AbortSignal.timeout(30_000) },
      );

      const statusData = (await statusRes.json()) as {
        status?: 'wait' | 'scaned' | 'confirmed' | 'expired';
        bot_token?: string;
        ilink_bot_id?: string;
        baseurl?: string;
        ilink_user_id?: string;
      };

      if (statusData.status === 'confirmed' && statusData.bot_token) {
        const botBaseUrl = statusData.baseurl ?? DEFAULT_BASE_URL;
        const token = statusData.bot_token;

        // Save credentials to channel config
        await db.channel.update({
          where: { id: channelId },
          data: {
            status: 'connected',
            config: { baseUrl: botBaseUrl, token, botId: statusData.ilink_bot_id ?? '' },
          },
        });

        state.qr = null;
        state.status = 'connected';
        console.log(`[weixin:${channelId}] Logged in, starting poll loop`);
        pollLoop(channelId, botBaseUrl, token);
        return;
      }

      if (statusData.status === 'expired') {
        console.log(`[weixin:${channelId}] QR expired, refreshing (attempt ${attempts + 1})`);
        attempts++;
        break;
      }

      if (statusData.status === 'scaned') {
        console.log(`[weixin:${channelId}] QR scanned, waiting for confirmation…`);
      }
    }
  }

  if (state.running) {
    state.status = 'disconnected';
    await db.channel.update({ where: { id: channelId }, data: { status: 'disconnected' } });
    console.error(`[weixin:${channelId}] Login timed out`);
  }
}

// ── Message splitting ────────────────────────────────────────────────────────

/**
 * Split a long message into chunks that each stay under `maxWords` words.
 * Splits on paragraph boundaries first (\n\n), then sentence boundaries (.!?),
 * then single newlines as a last resort.
 */
function splitMessage(text: string, maxWords: number): string[] {
  if (wordCount(text) <= maxWords) return [text];

  // Split into paragraphs first
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (wordCount(candidate) <= maxWords) {
      current = candidate;
    } else if (!current) {
      // Single paragraph exceeds limit — split by sentences
      chunks.push(...splitBySentences(para, maxWords));
    } else {
      chunks.push(current);
      if (wordCount(para) <= maxWords) {
        current = para;
      } else {
        chunks.push(...splitBySentences(para, maxWords));
        current = '';
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function splitBySentences(text: string, maxWords: number): string[] {
  // Split on sentence endings or newlines while keeping the delimiter
  const sentences = text.split(/(?<=[.!?。！？\n])\s*/);
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (wordCount(candidate) <= maxWords) {
      current = candidate;
    } else if (!current) {
      // Single sentence exceeds limit — just push it as-is
      chunks.push(sentence);
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function wordCount(text: string): number {
  // Count CJK characters individually + whitespace-separated words for mixed content
  let count = 0;
  // Each CJK character counts as ~1 word
  const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g);
  if (cjk) count += cjk.length;
  // Non-CJK portions: count whitespace-separated tokens
  const nonCjk = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, ' ').trim();
  if (nonCjk) count += nonCjk.split(/\s+/).filter(Boolean).length;
  return count;
}

// ── Message poll loop ─────────────────────────────────────────────────────────

async function pollLoop(channelId: string, baseUrl: string, token: string): Promise<void> {
  let existing = channels.get(channelId);
  if (!existing) {
    existing = { running: true, cursor: '', qr: null, qrUrl: null, status: 'connected' };
    channels.set(channelId, existing);
  }
  const state = existing;
  state.status = 'connected';

  while (state.running) {
    try {
      const res = await fetch(`${baseUrl}/ilink/bot/getupdates`, {
        method: 'POST',
        headers: msgHeaders(token),
        body: JSON.stringify({ get_updates_buf: state.cursor }),
        signal: AbortSignal.timeout(40_000),
      });

      interface CDNMediaRef {
        encrypt_query_param?: string;
        aes_key?: string;
        full_url?: string;
      }

      interface MediaItem {
        aeskey?: string;
        media?: CDNMediaRef;
      }

      const data = (await res.json()) as {
        msgs?: Array<{
          from_user_id?: string;
          context_token?: string;
          item_list?: Array<{
            type?: number;
            text_item?: { text?: string };
            image_item?: MediaItem & { hd_size?: number };
            voice_item?: MediaItem & { duration_ms?: number; text?: string };
            file_item?: MediaItem & { file_name?: string; file_size?: number; len?: string };
            video_item?: MediaItem & { duration_ms?: number };
          }>;
        }>;
        get_updates_buf?: string;
      };

      if (data.get_updates_buf) state.cursor = data.get_updates_buf;

      for (const msg of data.msgs ?? []) {
        if (!msg.from_user_id) continue;

        let text = msg.item_list?.find((i) => i.type === 1)?.text_item?.text?.trim() ?? '';

        // Use voice transcription as text if no text message was sent
        if (!text) {
          const voiceText = msg.item_list?.find((i) => i.type === 3)?.voice_item?.text?.trim();
          if (voiceText) text = voiceText;
        }

        // Download and decrypt CDN media (type 2=IMAGE, 3=VOICE, 4=FILE, 5=VIDEO)
        const attachments: Attachment[] = [];
        const MEDIA_MAP: Record<number, { filename: string; contentType: string }> = {
          2: { filename: 'image.jpg', contentType: 'image/jpeg' },
          3: { filename: 'voice.silk', contentType: 'audio/silk' },
          4: { filename: 'file', contentType: 'application/octet-stream' },
          5: { filename: 'video.mp4', contentType: 'video/mp4' },
        };

        // Track whether we got a voice transcription so we can skip the audio attachment
        const hasVoiceTranscription = msg.item_list?.some((i) => i.type === 3 && i.voice_item?.text?.trim()) ?? false;

        for (const item of msg.item_list ?? []) {
          const mediaMeta = MEDIA_MAP[item.type ?? 0];
          if (!mediaMeta) continue;

          // Skip voice audio attachment when transcription is available — treat as text instead
          if (item.type === 3 && hasVoiceTranscription) continue;

          const itemKey = item.type === 2 ? 'image_item' :
                          item.type === 3 ? 'voice_item' :
                          item.type === 4 ? 'file_item' : 'video_item';
          const cdnItem = item[itemKey as keyof typeof item] as MediaItem & { file_name?: string; file_size?: number } | undefined;
          if (!cdnItem) continue;

          const cdnUrl = cdnItem.media?.full_url;
          // aeskey can be at top level (hex) or only in media.aes_key (base64 of hex)
          let aesKey = cdnItem.aeskey;
          if (!aesKey && cdnItem.media?.aes_key) {
            aesKey = Buffer.from(cdnItem.media.aes_key, 'base64').toString('utf-8');
          }
          if (!cdnUrl || !aesKey) continue;

          const filename = (cdnItem as any).file_name ?? mediaMeta.filename;
          // Infer content type from filename extension for files
          let contentType = mediaMeta.contentType;
          if (item.type === 4 && filename) {
            const ext = filename.split('.').pop()?.toLowerCase();
            const extMap: Record<string, string> = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', zip: 'application/zip', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
            if (ext && extMap[ext]) contentType = extMap[ext];
          }
          const dataUrl = await downloadCdnMedia(cdnUrl, aesKey, contentType);

          if (dataUrl) {
            attachments.push({
              url: dataUrl,
              filename,
              contentType,
              size: (cdnItem as any).file_size ?? (cdnItem as any).hd_size ?? ((cdnItem as any).len ? Number((cdnItem as any).len) : undefined),
            });
          }
        }

        if (!text && attachments.length === 0) continue;

        console.log(`[weixin:${channelId}] Incoming from ${msg.from_user_id}: "${text}"${attachments.length ? ` (+${attachments.length} attachment(s))` : ''}`);

        try {
          const result = await routeInboundMessage({
            channelId,
            externalId: msg.from_user_id,
            text: text || '(attachment)',
            attachments: attachments.length > 0 ? attachments : undefined,
            meta: { platform: 'wechat_personal', contextToken: msg.context_token },
          });

          if (result?.reply) {
            const chunks = splitMessage(result.reply, 600);
            for (const chunk of chunks) {
              const sendBody = {
                msg: {
                  from_user_id: '',
                  to_user_id: msg.from_user_id,
                  client_id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
                  message_type: 2,
                  message_state: 2,
                  context_token: msg.context_token ?? '',
                  item_list: [{ type: 1, text_item: { text: chunk } }],
                },
                base_info: { channel_version: '1.0.0' },
              };
              const sendBodyStr = JSON.stringify(sendBody);
              console.log(`[weixin:${channelId}] Sending reply to ${msg.from_user_id}:`, sendBodyStr);
              const sendRes = await fetch(`${baseUrl}/ilink/bot/sendmessage`, {
                method: 'POST',
                headers: msgHeaders(token, sendBodyStr),
                body: sendBodyStr,
                signal: AbortSignal.timeout(15_000),
              });
              const sendData = await sendRes.text();
              console.log(`[weixin:${channelId}] sendmessage response (${sendRes.status}):`, sendData);
            }
          } else {
            console.warn(`[weixin:${channelId}] No reply returned for message from ${msg.from_user_id}`);
          }
        } catch (err) {
          console.error(`[weixin:${channelId}] Error routing message:`, err);
        }
      }
    } catch (err) {
      if (!state.running) break;
      console.error(`[weixin:${channelId}] Poll error, retrying in 3s:`, err);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getWeixinQR(channelId: string): { image: string; url: string } | null {
  const ch = channels.get(channelId);
  if (!ch?.qr) return null;
  return { image: ch.qr, url: ch.qrUrl ?? '' };
}

export function getWeixinStatus(channelId: string): WeixinState['status'] | null {
  return channels.get(channelId)?.status ?? null;
}

export async function stopWeixinBot(channelId: string): Promise<void> {
  const state = channels.get(channelId);
  if (!state) return;
  state.running = false;
  channels.delete(channelId);
  console.log(`[weixin:${channelId}] Stopped`);
}

export async function startWeixinBot(channelId: string, baseUrl: string, token: string): Promise<void> {
  if (channels.has(channelId)) return;
  pollLoop(channelId, baseUrl, token).catch((err) =>
    console.error(`[weixin:${channelId}] Poll loop crashed:`, err),
  );
}

export async function initWeixinAdapters(): Promise<void> {
  const rows = await db.channel.findMany({
    where: { type: 'wechat_personal', status: 'connected' },
    select: { id: true, config: true },
  });

  for (const row of rows) {
    const config = row.config as Record<string, string> | null;
    const baseUrl = config?.['baseUrl'];
    const token = config?.['token'];
    if (!baseUrl || !token) continue;
    try {
      await startWeixinBot(row.id, baseUrl, token);
    } catch (err) {
      console.error(`[weixin:${row.id}] Failed to start:`, err);
    }
  }

  console.log(`[weixin] Initialized ${rows.length} WeChat Personal bot(s)`);
}
