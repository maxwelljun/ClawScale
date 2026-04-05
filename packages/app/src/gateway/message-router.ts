/**
 * Message Router (HTTP gateway)
 *
 * Thin HTTP layer over routeInboundMessage(). All channel adapters call
 * routeInboundMessage() directly — these routes exist for webhook-based
 * platforms (LINE, Teams) that need HTTP signature verification before
 * the message can be handed off.
 */

import { Router } from 'express';
import { z } from 'zod';
import * as lineSdk from '@line/bot-sdk';
import { routeInboundMessage } from '../lib/route-message.js';
import { getLineBot, handleLineEvents } from '../adapters/line.js';
import { getTeamsBot, handleTeamsActivity } from '../adapters/teams.js';
import { verifyWebhook, handleWABusinessWebhook, getWABusinessConfig } from '../adapters/whatsapp-business.js';
import { validate } from '../middleware/validate.js';
import express from 'express';

const inboundSchema = z.object({
  externalId:  z.string().min(1),
  displayName: z.string().optional(),
  text:        z.string().min(1),
  meta:        z.record(z.unknown()).default({}),
});

export const gatewayRouter = Router();

// ── GET /gateway/whatsapp/:channelId ─────────────────��──────────────────────
// Meta webhook verification — responds with hub.challenge.
gatewayRouter.get('/whatsapp/:channelId', async (req, res) => {
  const channelId = req.params.channelId as string;
  const mode = req.query['hub.mode'] as string ?? '';
  const token = req.query['hub.verify_token'] as string ?? '';
  const challenge = req.query['hub.challenge'] as string ?? '';

  const result = await verifyWebhook(channelId, mode, token, challenge);
  if (result) { res.status(200).send(result); return; }
  res.status(403).json({ ok: false, error: 'Verification failed' });
});

// ── POST /gateway/whatsapp/:channelId ──────��────────────────────────────────
// Meta sends inbound WhatsApp Business messages here.
gatewayRouter.post('/whatsapp/:channelId', async (req, res) => {
  const channelId = req.params.channelId as string;

  const body = req.body;
  handleWABusinessWebhook(channelId, body).catch((err) =>
    console.error(`[wa-business:${channelId}] Webhook handling error:`, err),
  );

  // Always return 200 quickly so Meta doesn't retry
  res.json({ ok: true });
});

// ── POST /gateway/line/:channelId ────────────────────────────────────────────
// LINE webhook — verifies signature, then delegates to the LINE adapter.
gatewayRouter.post('/line/:channelId', express.text({ type: '*/*' }), async (req, res) => {
  const channelId = req.params.channelId as string;
  const bot = getLineBot(channelId);
  if (!bot) { res.status(404).json({ ok: false, error: 'Channel not found or not connected' }); return; }

  const signature = req.headers['x-line-signature'] as string ?? '';
  const body = req.body as string;

  if (!lineSdk.validateSignature(body, bot.channelSecret, signature)) {
    res.status(400).json({ ok: false, error: 'Invalid signature' });
    return;
  }

  const payload = JSON.parse(body) as { events: lineSdk.WebhookEvent[] };
  handleLineEvents(channelId, payload.events).catch((err) =>
    console.error(`[line:${channelId}] Event handling error:`, err),
  );

  res.json({ ok: true });
});

// ── POST /gateway/teams/:channelId ───���───────────────────────────────────────
// Teams webhook — delegates to the Teams adapter for JWT verification + reply.
gatewayRouter.post('/teams/:channelId', async (req, res) => {
  const channelId = req.params.channelId as string;
  const bot = getTeamsBot(channelId);
  if (!bot) { res.status(404).json({ ok: false, error: 'Channel not found or not connected' }); return; }

  const activity = req.body;
  handleTeamsActivity(channelId, activity).catch((err) =>
    console.error(`[teams:${channelId}] Activity handling error:`, err),
  );

  res.json({ ok: true });
});

// ─�� POST /gateway/:channelId ��────────────────────────────────────────────────
// Generic inbound endpoint — used by adapters that do their own event handling
// but still want an HTTP interface (useful for testing / external integrations).
gatewayRouter.post('/:channelId', validate(inboundSchema), async (req, res) => {
  const channelId = req.params.channelId as string;
  const body = req.body;

  const result = await routeInboundMessage({
    channelId,
    externalId:  body.externalId,
    displayName: body.displayName,
    text:        body.text,
    meta:        body.meta,
  });

  if (!result) { res.status(400).json({ ok: false, error: 'Message could not be routed' }); return; }
  res.json({ ok: true, data: result });
});
