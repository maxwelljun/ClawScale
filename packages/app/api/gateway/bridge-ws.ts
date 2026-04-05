/**
 * WebSocket bridge endpoint for cli-bridge backends.
 *
 * Local bridge clients connect via WebSocket to /bridge, authenticate with
 * a bridge token, and then exchange messages with ClawScale.
 *
 * Protocol:
 *   Client → Server: { type: 'auth', token: string }
 *   Server → Client: { type: 'auth_ok', backendId: string } | { type: 'auth_error', message: string }
 *   Server → Client: { type: 'message', requestId: string, history: Array<{role,content}> }
 *   Client → Server: { type: 'reply', requestId: string, text: string }
 *   Client → Server: { type: 'reply', requestId: string, error: string }
 */

import type { IncomingMessage } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { db } from '../db/index.js';
import { registerBridgeConnection } from '../lib/ai-backend.js';
import type { AiBackendProviderConfig } from '../../shared/index.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function initBridgeWebSocket(server: any): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: any, head: Buffer) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`);
    if (url.pathname !== '/bridge') return;

    wss.handleUpgrade(req, socket, head, (ws) => {
      handleConnection(ws);
    });
  });

  console.log('[bridge-ws] WebSocket bridge endpoint ready at /bridge');
}

function handleConnection(ws: WebSocket): void {
  let authenticated = false;
  const authTimeout = setTimeout(() => {
    if (!authenticated) {
      ws.send(JSON.stringify({ type: 'auth_error', message: 'Authentication timeout' }));
      ws.close();
    }
  }, 10_000);

  ws.on('message', async (raw) => {
    if (authenticated) return; // After auth, messages are handled by registerBridgeConnection

    try {
      const msg = JSON.parse(raw.toString()) as { type: string; token?: string };
      if (msg.type !== 'auth' || !msg.token) {
        ws.send(JSON.stringify({ type: 'auth_error', message: 'Expected auth message with token' }));
        ws.close();
        return;
      }

      // Look up backend by bridge token
      const backends = await db.aiBackend.findMany({
        where: { type: 'cli-bridge' },
        select: { id: true, config: true, tenantId: true, name: true },
      });

      const backend = backends.find((b) => {
        const cfg = (b.config ?? {}) as AiBackendProviderConfig;
        return cfg.bridgeToken === msg.token;
      });

      if (!backend) {
        ws.send(JSON.stringify({ type: 'auth_error', message: 'Invalid bridge token' }));
        ws.close();
        return;
      }

      clearTimeout(authTimeout);
      authenticated = true;

      registerBridgeConnection(backend.id, ws);
      ws.send(JSON.stringify({ type: 'auth_ok', backendId: backend.id }));
      console.log(`[bridge-ws] Bridge connected for backend ${backend.name} (${backend.id})`);
    } catch {
      ws.send(JSON.stringify({ type: 'auth_error', message: 'Invalid message format' }));
      ws.close();
    }
  });
}
