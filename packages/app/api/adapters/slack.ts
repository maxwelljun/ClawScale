/**
 * Slack Adapter (via @slack/bolt, Socket Mode)
 * Requires: Bot Token + App-Level Token (xapp-...)
 */

import { App } from '@slack/bolt';
import { db } from '../db/index.js';
import { routeInboundMessage } from '../lib/route-message.js';
import type { Attachment } from '../lib/route-message.js';

const apps = new Map<string, App>();

export async function startSlackBot(channelId: string, botToken: string, appToken: string): Promise<void> {
  if (apps.has(channelId)) return;

  const app = new App({
    token: botToken,
    appToken,
    socketMode: true,
    port: 0, // no HTTP server needed in socket mode
  });

  app.message(async ({ message, say }) => {
    if (message.subtype) return; // skip edits, deletes, etc.
    const msg = message as { text?: string; user?: string; files?: Array<{ url_private_download?: string; name?: string; mimetype?: string; size?: number }> };
    const text = msg.text?.trim() ?? '';

    const attachments: Attachment[] | undefined = msg.files?.length
      ? msg.files
          .filter((f) => f.url_private_download)
          .map((f) => ({
            url: f.url_private_download!,
            filename: f.name ?? 'file',
            contentType: f.mimetype ?? 'application/octet-stream',
            size: f.size,
          }))
      : undefined;

    if (!text && !attachments?.length) return;

    const externalId = msg.user ?? 'unknown';
    console.log(`[slack:${channelId}] Incoming from ${externalId}: "${text}"${attachments?.length ? ` (+${attachments.length} file(s))` : ''}`);

    try {
      const result = await routeInboundMessage({
        channelId, externalId,
        text: text || '(attachment)',
        attachments,
        meta: { platform: 'slack' },
      });
      if (result?.reply) await say(result.reply);
    } catch (err) {
      console.error(`[slack:${channelId}] Error routing message:`, err);
    }
  });

  apps.set(channelId, app);
  await app.start();
  console.log(`[slack:${channelId}] Bot started (Socket Mode)`);
}

export async function stopSlackBot(channelId: string): Promise<void> {
  const app = apps.get(channelId);
  if (!app) return;
  await app.stop();
  apps.delete(channelId);
  console.log(`[slack:${channelId}] Stopped`);
}

export async function initSlackAdapters(): Promise<void> {
  const rows = await db.channel.findMany({
    where: { type: 'slack', status: 'connected' },
    select: { id: true, config: true },
  });
  for (const row of rows) {
    const config = row.config as Record<string, string> | null;
    const botToken = config?.['botToken'];
    const appToken = config?.['appToken'];
    if (!botToken || !appToken) continue;
    try { await startSlackBot(row.id, botToken, appToken); } catch (err) { console.error(`[slack:${row.id}] Init error:`, err); }
  }
  console.log(`[slack] Initialized ${rows.length} bot(s)`);
}
