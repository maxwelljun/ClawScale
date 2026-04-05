/**
 * Matrix Adapter (via matrix-js-sdk)
 * Credentials: homeserver URL + access token
 */

import sdk from 'matrix-js-sdk';
import { db } from '../db/index.js';
import { routeInboundMessage } from '../lib/route-message.js';
import type { Attachment } from '../lib/route-message.js';

const clients = new Map<string, ReturnType<typeof sdk.createClient>>();

export async function startMatrixBot(channelId: string, homeserverUrl: string, accessToken: string): Promise<void> {
  if (clients.has(channelId)) return;

  const client = sdk.createClient({ baseUrl: homeserverUrl, accessToken });

  client.on(sdk.RoomEvent.Timeline, async (event, room) => {
    if (event.getType() !== 'm.room.message') return;
    if (event.getSender() === client.getUserId()) return; // ignore own messages
    if (event.isEncrypted()) return; // skip encrypted for now

    const content = event.getContent();
    const msgtype = content.msgtype as string;

    const MEDIA_TYPES: Record<string, string> = {
      'm.image': 'image/jpeg',
      'm.file': 'application/octet-stream',
      'm.audio': 'audio/ogg',
      'm.video': 'video/mp4',
    };

    let text = '';
    let attachments: Attachment[] | undefined;

    if (msgtype === 'm.text') {
      text = (content.body as string)?.trim() ?? '';
    } else if (msgtype in MEDIA_TYPES) {
      text = (content.body as string)?.trim() || `(${msgtype.replace('m.', '')})`;
      const mxcUrl = content.url as string | undefined;
      if (mxcUrl) {
        // Convert mxc://server/mediaId to HTTP download URL
        const httpUrl = client.mxcUrlToHttp(mxcUrl) ?? mxcUrl;
        attachments = [{
          url: httpUrl,
          filename: (content.filename as string) ?? (content.body as string) ?? 'file',
          contentType: (content.info as any)?.mimetype ?? MEDIA_TYPES[msgtype],
          size: (content.info as any)?.size,
        }];
      }
    } else {
      return;
    }

    if (!text && !attachments?.length) return;

    const externalId = event.getSender() ?? 'unknown';
    console.log(`[matrix:${channelId}] Incoming from ${externalId}: "${text}"${attachments?.length ? ` (+${attachments.length} attachment(s))` : ''}`);

    try {
      const result = await routeInboundMessage({
        channelId, externalId,
        text: text || '(attachment)',
        attachments,
        meta: { platform: 'matrix', roomId: room?.roomId },
      });
      if (result?.reply && room) await client.sendTextMessage(room.roomId, result.reply);
    } catch (err) {
      console.error(`[matrix:${channelId}] Error routing message:`, err);
    }
  });

  await client.startClient({ initialSyncLimit: 0 });
  clients.set(channelId, client);
  console.log(`[matrix:${channelId}] Client started (${homeserverUrl})`);
}

export async function stopMatrixBot(channelId: string): Promise<void> {
  const client = clients.get(channelId);
  if (!client) return;
  client.stopClient();
  clients.delete(channelId);
  console.log(`[matrix:${channelId}] Stopped`);
}

export async function initMatrixAdapters(): Promise<void> {
  const rows = await db.channel.findMany({
    where: { type: 'matrix', status: 'connected' },
    select: { id: true, config: true },
  });
  for (const row of rows) {
    const config = row.config as Record<string, string> | null;
    const homeserverUrl = config?.['homeserverUrl'];
    const accessToken = config?.['accessToken'];
    if (!homeserverUrl || !accessToken) continue;
    try { await startMatrixBot(row.id, homeserverUrl, accessToken); } catch (err) { console.error(`[matrix:${row.id}] Init error:`, err); }
  }
  console.log(`[matrix] Initialized ${rows.length} bot(s)`);
}
