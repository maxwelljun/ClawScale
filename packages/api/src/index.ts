import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { channelsRouter } from './routes/channels.js';
import { tenantRouter } from './routes/tenant.js';
import { conversationsRouter } from './routes/conversations.js';
import { aiBackendsRouter } from './routes/ai-backends.js';
import { endUsersRouter } from './routes/end-users.js';
import { onboardRouter } from './routes/onboard.js';
import { gatewayRouter } from './gateway/message-router.js';
import { initDiscordAdapters } from './adapters/discord.js';
import { initWeChatAdapters } from './adapters/wecom.js';
import { initWhatsAppAdapters } from './adapters/whatsapp.js';
import { initWeixinAdapters } from './adapters/wechat.js';
import { initTelegramAdapters } from './adapters/telegram.js';
import { initSlackAdapters } from './adapters/slack.js';
import { initMatrixAdapters } from './adapters/matrix.js';
import { initLineAdapters } from './adapters/line.js';
import { initSignalAdapters } from './adapters/signal.js';
import { initTeamsAdapters } from './adapters/teams.js';
import { initWABusinessAdapters } from './adapters/whatsapp-business.js';
import { initBridgeWebSocket } from './gateway/bridge-ws.js';

const app = new Hono();

// ─── Global middleware ────────────────────────────────────────────────────────

app.use(
  '*',
  cors({
    origin: process.env['CORS_ORIGIN'] ?? 'http://localhost:4040',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);
app.use('*', logger());

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (c) => c.json({ ok: true, version: '0.1.0' }));

// ─── Dashboard API routes (internal members) ─────────────────────────────────

app.route('/auth', authRouter);
app.route('/api/users', usersRouter);
app.route('/api/channels', channelsRouter);
app.route('/api/tenant', tenantRouter);
app.route('/api/conversations', conversationsRouter);
app.route('/api/ai-backends', aiBackendsRouter);
app.route('/api/end-users', endUsersRouter);

// ─── Public onboarding routes ────────────────────────────────────────────────

app.route('/api/onboard', onboardRouter);

// ─── Gateway (inbound messages from social channels) ─────────────────────────

app.route('/gateway', gatewayRouter);

// ─── Fallback ─────────────────────────────────────────────────────────────────

app.notFound((c) => c.json({ ok: false, error: 'Not found' }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ ok: false, error: 'Internal server error' }, 500);
});

// ─── Start server ─────────────────────────────────────────────────────────────

const port = parseInt(process.env['PORT'] ?? '4041', 10);
const host = process.env['HOST'] ?? '0.0.0.0';

const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`ClawScale API running on http://${info.address}:${info.port}`);
  initBridgeWebSocket(server);
  initDiscordAdapters().catch((err) => console.error('[discord] Init failed:', err));
  initWeChatAdapters().catch((err) => console.error('[wechat] Init failed:', err));
  initWhatsAppAdapters().catch((err) => console.error('[whatsapp] Init failed:', err));
  initWeixinAdapters().catch((err) => console.error('[weixin] Init failed:', err));
  initTelegramAdapters().catch((err) => console.error('[telegram] Init failed:', err));
  initSlackAdapters().catch((err) => console.error('[slack] Init failed:', err));
  initMatrixAdapters().catch((err) => console.error('[matrix] Init failed:', err));
  initLineAdapters().catch((err) => console.error('[line] Init failed:', err));
  initSignalAdapters().catch((err) => console.error('[signal] Init failed:', err));
  initTeamsAdapters().catch((err) => console.error('[teams] Init failed:', err));
  initWABusinessAdapters().catch((err) => console.error('[wa-business] Init failed:', err));
});
