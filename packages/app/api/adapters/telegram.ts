/**
 * Telegram Adapter (via grammy, long-polling)
 */

import { Bot } from 'grammy';
import type { Context } from 'grammy';
import { db } from '../db/index.js';
import { routeInboundMessage } from '../lib/route-message.js';
import type { Attachment } from '../lib/route-message.js';

const bots = new Map<string, Bot>();

export async function startTelegramBot(channelId: string, token: string): Promise<void> {
  if (bots.has(channelId)) return;

  const bot = new Bot(token);

  async function extractAttachments(ctx: Context, token: string): Promise<Attachment[]> {
    const attachments: Attachment[] = [];
    const msg = ctx.message;
    if (!msg) return attachments;

    const items: { fileId: string; filename?: string; contentType: string; size?: number }[] = [];

    if (msg.photo?.length) {
      const largest = msg.photo[msg.photo.length - 1]!;
      items.push({ fileId: largest.file_id, filename: 'photo.jpg', contentType: 'image/jpeg', size: largest.file_size });
    }
    if (msg.document) {
      items.push({ fileId: msg.document.file_id, filename: msg.document.file_name ?? 'file', contentType: msg.document.mime_type ?? 'application/octet-stream', size: msg.document.file_size });
    }
    if (msg.audio) {
      items.push({ fileId: msg.audio.file_id, filename: msg.audio.file_name ?? 'audio', contentType: msg.audio.mime_type ?? 'audio/mpeg', size: msg.audio.file_size });
    }
    if (msg.video) {
      items.push({ fileId: msg.video.file_id, filename: msg.video.file_name ?? 'video.mp4', contentType: msg.video.mime_type ?? 'video/mp4', size: msg.video.file_size });
    }
    if (msg.voice) {
      items.push({ fileId: msg.voice.file_id, filename: 'voice.ogg', contentType: msg.voice.mime_type ?? 'audio/ogg', size: msg.voice.file_size });
    }
    if (msg.sticker) {
      items.push({ fileId: msg.sticker.file_id, filename: 'sticker.webp', contentType: 'image/webp', size: msg.sticker.file_size });
    }
    if (msg.video_note) {
      items.push({ fileId: msg.video_note.file_id, filename: 'video_note.mp4', contentType: 'video/mp4', size: msg.video_note.file_size });
    }

    for (const item of items) {
      try {
        const file = await ctx.api.getFile(item.fileId);
        if (file.file_path) {
          attachments.push({
            url: `https://api.telegram.org/file/bot${token}//${file.file_path}`,
            filename: item.filename ?? 'file',
            contentType: item.contentType,
            size: item.size,
          });
        }
      } catch (err) {
        console.error(`[telegram:${channelId}] Failed to get file URL:`, err);
      }
    }

    return attachments;
  }

  bot.on('message', async (ctx) => {
    const text = (ctx.message.text ?? ctx.message.caption ?? '').trim();
    const externalId = String(ctx.from.id);
    const displayName = ctx.from.first_name + (ctx.from.last_name ? ` ${ctx.from.last_name}` : '');

    const attachments = await extractAttachments(ctx, token);
    if (!text && attachments.length === 0) return;

    console.log(`[telegram:${channelId}] Incoming from ${externalId}: "${text}"${attachments.length ? ` (+${attachments.length} attachment(s))` : ''}`);

    try {
      const result = await routeInboundMessage({
        channelId, externalId, displayName,
        text: text || '(attachment)',
        attachments: attachments.length > 0 ? attachments : undefined,
        meta: { platform: 'telegram', chatId: ctx.chat.id },
      });
      if (result?.reply) await ctx.reply(result.reply);
    } catch (err) {
      console.error(`[telegram:${channelId}] Error routing message:`, err);
    }
  });

  bot.catch((err) => console.error(`[telegram:${channelId}] Bot error:`, err));

  bots.set(channelId, bot);
  bot.start({ drop_pending_updates: true }).catch((err) => console.error(`[telegram:${channelId}] Start error:`, err));
  console.log(`[telegram:${channelId}] Bot started`);
}

export async function stopTelegramBot(channelId: string): Promise<void> {
  const bot = bots.get(channelId);
  if (!bot) return;
  await bot.stop();
  bots.delete(channelId);
  console.log(`[telegram:${channelId}] Stopped`);
}

export async function initTelegramAdapters(): Promise<void> {
  const rows = await db.channel.findMany({
    where: { type: 'telegram', status: 'connected' },
    select: { id: true, config: true },
  });
  for (const row of rows) {
    const config = row.config as Record<string, string> | null;
    const token = config?.['botToken'];
    if (!token) continue;
    try { await startTelegramBot(row.id, token); } catch (err) { console.error(`[telegram:${row.id}] Init error:`, err); }
  }
  console.log(`[telegram] Initialized ${rows.length} bot(s)`);
}
