/**
 * WeChat Work (WeCom) Adapter
 *
 * Manages one @wecom/aibot-node-sdk WSClient per connected WeCom channel.
 * On startup, loads all connected WeCom channels from the DB and starts bots.
 *
 * Flow per message:
 *   WeCom text message → normalize → POST /gateway/:channelId (internal) → reply
 */

import AiBot from '@wecom/aibot-node-sdk';
import { db } from '../db/index.js';
import { routeInboundMessage } from '../lib/route-message.js';

// Map of clawscale channelId → WSClient
const clients = new Map<string, InstanceType<typeof AiBot.WSClient>>();

// ── Start a bot for a single channel ─────────────────────────────────────────

export async function startWeChatBot(channelId: string, botId: string, secret: string): Promise<void> {
  if (clients.has(channelId)) return;

  const client = new AiBot.WSClient({ botId, secret });

  client.on('message.text', async (frame: {
    headers?: { req_id?: string };
    body?: { text?: { content?: string }; from?: { userid?: string; name?: string } };
  }) => {
    const text = frame.body?.text?.content?.trim();
    if (!text) return;

    const userId = frame.body?.from?.userid ?? 'unknown';
    console.log(`[wechat:${channelId}] Message from ${userId}: ${text}`);

    try {
      const result = await routeInboundMessage({
        channelId,
        externalId: userId,
        displayName: frame.body?.from?.name,
        text,
        meta: { platform: 'wechat_work' },
      });
      if (result?.reply) {
        const streamId = `stream_${Date.now()}`;
        await client.replyStream(frame as any, streamId, result.reply, true);
      }
    } catch (err) {
      console.error(`[wechat:${channelId}] Error routing message:`, err);
    }
  });

  client.connect();
  clients.set(channelId, client);
  console.log(`[wechat:${channelId}] Bot connected (botId: ${botId})`);
}

// ── Stop a bot for a single channel ──────────────────────────────────────────

export async function stopWeChatBot(channelId: string): Promise<void> {
  const client = clients.get(channelId);
  if (!client) return;
  // WSClient does not expose a close method in the public API; drop the reference
  // so it gets GC'd and reconnects won't restart under the old channelId.
  clients.delete(channelId);
  console.log(`[wechat:${channelId}] Bot stopped`);
}

// ── Boot all connected WeCom channels on API startup ─────────────────────────

export async function initWeChatAdapters(): Promise<void> {
  const channels = await db.channel.findMany({
    where: { type: 'wechat_work', status: 'connected' },
    select: { id: true, config: true },
  });

  for (const channel of channels) {
    const config = channel.config as Record<string, string> | null;
    const botId = config?.['botId'];
    const secret = config?.['secret'];
    if (!botId || !secret) continue;

    try {
      await startWeChatBot(channel.id, botId, secret);
    } catch (err) {
      console.error(`[wechat:${channel.id}] Failed to start bot:`, err);
    }
  }

  console.log(`[wechat] Initialized ${channels.length} WeCom bot(s)`);
}
