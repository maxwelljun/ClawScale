/**
 * Microsoft Teams Adapter (via Azure Bot Service / Bot Framework)
 *
 * Credentials: appId + appPassword (from Azure Bot registration)
 * Webhook: POST /gateway/teams/:channelId  (set as messaging endpoint in Azure)
 *
 * This adapter verifies the JWT bearer token from Azure and sends replies
 * via the Bot Framework REST API.
 */

import { db } from '../db/index.js';
import { routeInboundMessage } from '../lib/route-message.js';
import type { Attachment } from '../lib/route-message.js';

const BOT_FRAMEWORK_TOKEN_URL = 'https://login.microsoftonline.com/botframework.com/oauth2/v2.0/token';

interface TeamsBot {
  appId: string;
  appPassword: string;
  accessToken: string | null;
  tokenExpiry: number;
}

const bots = new Map<string, TeamsBot>();

export function getTeamsBot(channelId: string): TeamsBot | undefined {
  return bots.get(channelId);
}

async function getAccessToken(bot: TeamsBot): Promise<string> {
  if (bot.accessToken && Date.now() < bot.tokenExpiry - 60_000) {
    return bot.accessToken;
  }

  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: bot.appId,
    client_secret: bot.appPassword,
    scope: 'https://api.botframework.com/.default',
  });

  const res = await fetch(BOT_FRAMEWORK_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('Failed to get Bot Framework access token');

  bot.accessToken = data.access_token;
  bot.tokenExpiry = Date.now() + (data.expires_in ?? 3600) * 1000;
  return bot.accessToken;
}

export async function startTeamsBot(channelId: string, appId: string, appPassword: string): Promise<void> {
  if (bots.has(channelId)) return;
  bots.set(channelId, { appId, appPassword, accessToken: null, tokenExpiry: 0 });
  console.log(`[teams:${channelId}] Bot registered (appId: ${appId})`);
}

export async function stopTeamsBot(channelId: string): Promise<void> {
  if (!bots.has(channelId)) return;
  bots.delete(channelId);
  console.log(`[teams:${channelId}] Stopped`);
}

/**
 * Handle a verified Teams Activity payload (called from the gateway route).
 */
export async function handleTeamsActivity(channelId: string, activity: {
  type: string;
  text?: string;
  from?: { id?: string; name?: string };
  serviceUrl?: string;
  conversation?: { id?: string };
  id?: string;
  replyToId?: string;
  recipient?: { id?: string };
  attachments?: Array<{ contentType?: string; contentUrl?: string; name?: string }>;
}): Promise<void> {
  const bot = bots.get(channelId);
  if (!bot) return;

  if (activity.type !== 'message') return;
  const text = activity.text?.trim() ?? '';

  const attachments: Attachment[] | undefined = activity.attachments?.length
    ? activity.attachments
        .filter((a) => a.contentUrl)
        .map((a) => ({
          url: a.contentUrl!,
          filename: a.name ?? 'file',
          contentType: a.contentType ?? 'application/octet-stream',
        }))
    : undefined;

  if (!text && !attachments?.length) return;

  const externalId = activity.from?.id ?? 'unknown';
  const displayName = activity.from?.name;
  console.log(`[teams:${channelId}] Incoming from ${externalId}: "${text}"${attachments?.length ? ` (+${attachments.length} attachment(s))` : ''}`);

  try {
    const result = await routeInboundMessage({
      channelId, externalId, displayName,
      text: text || '(attachment)',
      attachments,
      meta: { platform: 'teams' },
    });

    if (result?.reply && activity.serviceUrl && activity.conversation?.id) {
      const token = await getAccessToken(bot);
      const replyUrl = `${activity.serviceUrl}v3/conversations/${encodeURIComponent(activity.conversation.id)}/activities`;

      await fetch(replyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          type: 'message',
          text: result.reply,
          replyToId: activity.id,
          from: activity.recipient,
          conversation: activity.conversation,
        }),
      });
    }
  } catch (err) {
    console.error(`[teams:${channelId}] Error routing message:`, err);
  }
}

export async function initTeamsAdapters(): Promise<void> {
  const rows = await db.channel.findMany({
    where: { type: 'teams', status: 'connected' },
    select: { id: true, config: true },
  });
  for (const row of rows) {
    const config = row.config as Record<string, string> | null;
    const appId = config?.['appId'];
    const appPassword = config?.['appPassword'];
    if (!appId || !appPassword) continue;
    try { await startTeamsBot(row.id, appId, appPassword); } catch (err) { console.error(`[teams:${row.id}] Init error:`, err); }
  }
  console.log(`[teams] Initialized ${rows.length} bot(s)`);
}
