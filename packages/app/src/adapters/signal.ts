/**
 * Signal Adapter (via signal-cli REST API)
 *
 * Requires signal-cli running as a REST daemon:
 *   https://github.com/bbernhard/signal-cli-rest-api
 *
 * signalCliUrl: base URL of signal-cli REST API (e.g. http://localhost:8080)
 * phoneNumber: the registered Signal phone number (e.g. +601234567890)
 *
 * This adapter polls the signal-cli REST API for new messages (long-poll or interval).
 */

import { db } from '../db/index.js';
import { routeInboundMessage } from '../lib/route-message.js';
import type { Attachment } from '../lib/route-message.js';

interface SignalState {
  running: boolean;
  phoneNumber: string;
  signalCliUrl: string;
}

const bots = new Map<string, SignalState>();

export async function startSignalBot(channelId: string, phoneNumber: string, signalCliUrl: string): Promise<void> {
  if (bots.has(channelId)) return;

  const state: SignalState = { running: true, phoneNumber, signalCliUrl };
  bots.set(channelId, state);

  pollLoop(channelId, state).catch((err) =>
    console.error(`[signal:${channelId}] Poll loop crashed:`, err),
  );

  console.log(`[signal:${channelId}] Bot started (${phoneNumber})`);
}

export async function stopSignalBot(channelId: string): Promise<void> {
  const state = bots.get(channelId);
  if (!state) return;
  state.running = false;
  bots.delete(channelId);
  console.log(`[signal:${channelId}] Stopped`);
}

async function pollLoop(channelId: string, state: SignalState): Promise<void> {
  while (state.running) {
    try {
      const res = await fetch(
        `${state.signalCliUrl}/v1/receive/${encodeURIComponent(state.phoneNumber)}`,
        { signal: AbortSignal.timeout(35_000) },
      );

      if (!res.ok) {
        console.error(`[signal:${channelId}] Receive error ${res.status}`);
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      const messages = (await res.json()) as Array<{
        envelope?: {
          source?: string;
          dataMessage?: {
            message?: string;
            attachments?: Array<{ id?: string; contentType?: string; filename?: string; size?: number }>;
          };
        };
      }>;

      for (const item of messages) {
        const env = item.envelope;
        const text = env?.dataMessage?.message?.trim() ?? '';
        const externalId = env?.source;
        if (!externalId) continue;

        const attachments: Attachment[] | undefined = env?.dataMessage?.attachments?.length
          ? env.dataMessage.attachments
              .filter((a) => a.id)
              .map((a) => ({
                url: `${state.signalCliUrl}/v1/attachments/${a.id}`,
                filename: a.filename ?? 'file',
                contentType: a.contentType ?? 'application/octet-stream',
                size: a.size,
              }))
          : undefined;

        if (!text && !attachments?.length) continue;

        console.log(`[signal:${channelId}] Incoming from ${externalId}: "${text}"${attachments?.length ? ` (+${attachments.length} attachment(s))` : ''}`);

        try {
          const result = await routeInboundMessage({
            channelId, externalId,
            text: text || '(attachment)',
            attachments,
            meta: { platform: 'signal' },
          });
          if (result?.reply) {
            await fetch(`${state.signalCliUrl}/v2/send`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ number: state.phoneNumber, recipients: [externalId], message: result.reply }),
            });
          }
        } catch (err) {
          console.error(`[signal:${channelId}] Error routing message:`, err);
        }
      }
    } catch (err) {
      if (!state.running) break;
      console.error(`[signal:${channelId}] Poll error, retrying in 5s:`, err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

export async function initSignalAdapters(): Promise<void> {
  const rows = await db.channel.findMany({
    where: { type: 'signal', status: 'connected' },
    select: { id: true, config: true },
  });
  for (const row of rows) {
    const config = row.config as Record<string, string> | null;
    const phoneNumber = config?.['phoneNumber'];
    const signalCliUrl = config?.['signalCliUrl'] ?? 'http://localhost:8080';
    if (!phoneNumber) continue;
    try { await startSignalBot(row.id, phoneNumber, signalCliUrl); } catch (err) { console.error(`[signal:${row.id}] Init error:`, err); }
  }
  console.log(`[signal] Initialized ${rows.length} bot(s)`);
}
