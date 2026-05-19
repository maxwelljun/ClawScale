/**
 * Telegram Adapter (via grammy, long-polling)
 */

import { Bot } from 'grammy';
import type { Context } from 'grammy';
import { run, type RunnerHandle } from '@grammyjs/runner';
import { db } from '../db/index.js';
import { routeInboundMessage } from '../lib/route-message.js';
import type { Attachment } from '../lib/route-message.js';

const bots = new Map<string, { bot: Bot; runner: RunnerHandle }>();
type TelegramAbortSignal = Parameters<Bot['api']['sendMessage']>[3];
const TELEGRAM_TEXT_LIMIT = 4096;
const TELEGRAM_DRAFT_THROTTLE_MS = 1000;
const TELEGRAM_DRAFT_TIMEOUT_MS = Number(process.env.TELEGRAM_DRAFT_TIMEOUT_MS ?? 2500);
const TELEGRAM_SEND_TIMEOUT_MS = Number(process.env.TELEGRAM_SEND_TIMEOUT_MS ?? 20000);
const TELEGRAM_DRAFT_ID_MAX = 2_147_483_647;

let nextDraftId = 0;

function allocateDraftId(): number {
  nextDraftId = nextDraftId >= TELEGRAM_DRAFT_ID_MAX ? 1 : nextDraftId + 1;
  return nextDraftId;
}

function withAbortSignal<T>(timeoutMs: number, run: (signal: TelegramAbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return run(controller.signal as TelegramAbortSignal).finally(() => clearTimeout(timer));
}

function telegramTextChunks(value: string): string[] {
  const text = value.trim();
  if (!text) return [];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += TELEGRAM_TEXT_LIMIT) {
    chunks.push(text.slice(i, i + TELEGRAM_TEXT_LIMIT));
  }
  return chunks;
}

async function sendTelegramMessage(
  ctx: Context,
  chatId: number,
  text: string,
  channelId: string,
): Promise<void> {
  for (const chunk of telegramTextChunks(text)) {
    try {
      await withAbortSignal(TELEGRAM_SEND_TIMEOUT_MS, (signal) =>
        ctx.api.sendMessage(chatId, chunk, undefined, signal),
      );
    } catch (err) {
      console.warn(`[telegram:${channelId}] sendMessage failed, retrying once:`, err);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await withAbortSignal(TELEGRAM_SEND_TIMEOUT_MS, (signal) =>
        ctx.api.sendMessage(chatId, chunk, undefined, signal),
      );
    }
  }
}

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

    const chatId = ctx.chat.id;
    const messageText = text || '(attachment)';
    const messageAttachments = attachments.length > 0 ? attachments : undefined;

    void (async () => {
      const startedAt = Date.now();
      const draftId = allocateDraftId();
      let draftSent = false;
      let draftDisabled = ctx.chat.type !== 'private';
      let lastStreamText = '';
      let lastDraftAt = 0;
      let draftChain = Promise.resolve();

      const telegramText = (value: string) => {
        const text = value.trim();
        return text.length > TELEGRAM_TEXT_LIMIT ? text.slice(0, TELEGRAM_TEXT_LIMIT - 3) + '...' : text;
      };

      const queueDraft = (nextText: string, force = false) => {
        if (draftDisabled) return;
        const trimmed = telegramText(nextText);
        if (!trimmed || trimmed === lastStreamText) return;
        const now = Date.now();
        if (!force && now - lastDraftAt < TELEGRAM_DRAFT_THROTTLE_MS) return;

        lastStreamText = trimmed;
        lastDraftAt = now;
        draftSent = true;
        draftChain = draftChain.then(async () => {
          if (draftDisabled) return;
          try {
            await withAbortSignal(TELEGRAM_DRAFT_TIMEOUT_MS, (signal) =>
              ctx.api.sendMessageDraft(chatId, draftId, trimmed, undefined, signal),
            );
          } catch (err) {
            draftDisabled = true;
            console.warn(`[telegram:${channelId}] Failed to send streamed draft:`, err);
          }
        });
      };

      try {
        const result = await routeInboundMessage({
          channelId, externalId, displayName,
          text: messageText,
          attachments: messageAttachments,
          meta: { platform: 'telegram', chatId },
          onStream: ({ text, done }) => queueDraft(text, done),
        });
        if (result?.reply) {
          if (draftSent && result.reply.trim() !== lastStreamText) {
            queueDraft(result.reply, true);
          }
          await Promise.race([
            draftChain,
            new Promise((resolve) => setTimeout(resolve, TELEGRAM_DRAFT_TIMEOUT_MS)),
          ]).catch(() => {});
          await sendTelegramMessage(ctx, chatId, result.reply, channelId);
        }
        console.log(`[telegram:${channelId}] Replied to ${externalId} in ${Date.now() - startedAt}ms`);
      } catch (err) {
        console.error(`[telegram:${channelId}] Error routing message:`, err);
      }
    })();
  });

  bot.catch((err) => console.error(`[telegram:${channelId}] Bot error:`, err));

  await bot.api.deleteWebhook({ drop_pending_updates: true });
  const runner = run(bot, {
    runner: {
      fetch: { timeout: 30, allowed_updates: ['message'] },
      retryInterval: 'exponential',
      maxRetryTime: 300_000,
    },
  });
  runner.task()?.catch((err) => console.error(`[telegram:${channelId}] Runner stopped with error:`, err));
  bots.set(channelId, { bot, runner });
  console.log(`[telegram:${channelId}] Bot started (runner=${runner.isRunning()})`);
}

export async function stopTelegramBot(channelId: string): Promise<void> {
  const entry = bots.get(channelId);
  if (!entry) return;
  bots.delete(channelId);
  await entry.runner.stop();
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
