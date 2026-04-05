/**
 * LINE Adapter (via @line/bot-sdk, webhook-based)
 * Credentials: channelAccessToken + channelSecret
 *
 * LINE uses webhooks — incoming messages are POSTed to /gateway/line/:channelId.
 * This adapter registers a route handler and sends replies via the LINE Messaging API.
 */

import * as line from '@line/bot-sdk';
import { db } from '../db/index.js';
import { routeInboundMessage } from '../lib/route-message.js';
import type { Attachment } from '../lib/route-message.js';

interface LineBot {
  client: line.messagingApi.MessagingApiClient;
  middleware: ReturnType<typeof line.middleware>;
  channelSecret: string;
}

const bots = new Map<string, LineBot>();

export function getLineBot(channelId: string): LineBot | undefined {
  return bots.get(channelId);
}

export async function startLineBot(channelId: string, channelAccessToken: string, channelSecret: string): Promise<void> {
  if (bots.has(channelId)) return;

  const client = new line.messagingApi.MessagingApiClient({ channelAccessToken });
  const mw = line.middleware({ channelSecret, channelAccessToken });

  bots.set(channelId, { client, middleware: mw, channelSecret });
  console.log(`[line:${channelId}] Bot registered`);
}

export async function stopLineBot(channelId: string): Promise<void> {
  if (!bots.has(channelId)) return;
  bots.delete(channelId);
  console.log(`[line:${channelId}] Stopped`);
}

/**
 * Handle a verified LINE webhook payload (called from the gateway route).
 * events: parsed LINE webhook events array
 */
export async function handleLineEvents(channelId: string, events: line.WebhookEvent[]): Promise<void> {
  const bot = bots.get(channelId);
  if (!bot) return;

  const CONTENT_TYPE_MAP: Record<string, string> = {
    image: 'image/jpeg',
    video: 'video/mp4',
    audio: 'audio/m4a',
    file: 'application/octet-stream',
  };

  for (const event of events) {
    if (event.type !== 'message') continue;
    const msgType = event.message.type;

    let text = '';
    let attachments: Attachment[] | undefined;

    if (msgType === 'text') {
      text = (event.message as line.TextEventMessage).text.trim();
    } else if (['image', 'video', 'audio', 'file'].includes(msgType)) {
      const messageId = event.message.id;
      const contentType = CONTENT_TYPE_MAP[msgType] ?? 'application/octet-stream';
      const filename = (event.message as any).fileName ?? `${msgType}_${messageId}`;
      // LINE content download URL via Messaging API
      attachments = [{
        url: `https://api-data.line.me/v2/bot/message/${messageId}/content`,
        filename,
        contentType,
      }];
      text = '(attachment)';
    } else {
      continue;
    }

    const externalId = event.source.userId ?? 'unknown';
    const replyToken = event.replyToken;

    console.log(`[line:${channelId}] Incoming from ${externalId}: "${text}"${attachments?.length ? ` (+${attachments.length} attachment(s))` : ''}`);

    try {
      const result = await routeInboundMessage({ channelId, externalId, text, attachments, meta: { platform: 'line' } });
      if (result?.reply) {
        await bot.client.replyMessage({
          replyToken,
          messages: [{ type: 'text', text: result.reply }],
        });
      }
    } catch (err) {
      console.error(`[line:${channelId}] Error routing message:`, err);
    }
  }
}

export async function initLineAdapters(): Promise<void> {
  const rows = await db.channel.findMany({
    where: { type: 'line', status: 'connected' },
    select: { id: true, config: true },
  });
  for (const row of rows) {
    const config = row.config as Record<string, string> | null;
    const channelAccessToken = config?.['channelAccessToken'];
    const channelSecret = config?.['channelSecret'];
    if (!channelAccessToken || !channelSecret) continue;
    try { await startLineBot(row.id, channelAccessToken, channelSecret); } catch (err) { console.error(`[line:${row.id}] Init error:`, err); }
  }
  console.log(`[line] Initialized ${rows.length} bot(s)`);
}
