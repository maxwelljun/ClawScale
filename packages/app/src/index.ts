import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import morgan from 'morgan';
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

const app = express();

// ─── Global middleware ────────────────────────────────────────────────────────

app.use(morgan('dev'));
app.use(express.json());

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => res.json({ ok: true, version: '0.1.0' }));

// ─── Dashboard API routes (internal members) ─────────────────────────────────

app.use('/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/channels', channelsRouter);
app.use('/api/tenant', tenantRouter);
app.use('/api/conversations', conversationsRouter);
app.use('/api/ai-backends', aiBackendsRouter);
app.use('/api/end-users', endUsersRouter);

// ─── Public onboarding routes ────────────────────────────────────────────────

app.use('/api/onboard', onboardRouter);

// ─── Gateway (inbound messages from social channels) ─────────────────────────

app.use('/gateway', gatewayRouter);

// ─── Static file serving (production) ────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '../../web/out');
app.use(express.static(webRoot));

// ─── Fallback ─────────────────────────────────────────────────────────────────

// API/gateway 404
app.use('/api', (_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});
app.use('/auth', (_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});
app.use('/gateway', (_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

// SPA fallback — serve index.html for all other routes
app.use((_req, res) => {
  res.sendFile(path.join(webRoot, 'index.html'));
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ ok: false, error: 'Internal server error' });
});

// ─── Start server ─────────────────────────────────────────────────────────────

const port = parseInt(process.env['PORT'] ?? '4040', 10);
const host = process.env['HOST'] ?? '0.0.0.0';

const server = app.listen(port, host, () => {
  console.log(`ClawScale API running on http://${host}:${port}`);
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
