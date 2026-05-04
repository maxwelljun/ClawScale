/**
 * AI Backend — pluggable inference provider.
 *
 * ClawScale is a pure forwarder: it sends the user's messages to the backend
 * and returns whatever text (or streamed text) the backend responds with.
 *
 * Dispatch is driven by BackendTypeDescriptors from shared.
 * Each backend type maps to a transport (http, sse, websocket, pty-websocket)
 * and a response format (json-auto, langgraph, raw-text).
 */

import OpenAI from 'openai';
import type {
  AiBackendType,
  AiBackendProviderConfig,
  BackendTypeDescriptor,
  Transport,
  ResponseFormat,
} from '../../shared/index.js';
import { BACKEND_TYPE_DESCRIPTORS } from '../../shared/index.js';
import { ensureOpenClawDockerRuntime, openClawSessionKey, type OpenClawRuntimeIdentity, type OpenClawRuntimeTemplate } from './openclaw-docker.js';

export interface PalmosContext {
  endUserId: string;
  tenantId: string;
  conversationId: string;
  displayName?: string;
}

export interface BackendSpec {
  type: AiBackendType;
  config: AiBackendProviderConfig;
  /** Palmos integration context — only used when type is 'palmos' */
  palmosCtx?: PalmosContext;
}

export interface HistoryAttachment {
  url: string;
  filename: string;
  contentType: string;
  size?: number;
}

export type HistoryMessage = {
  role: 'user' | 'assistant';
  content: string;
  attachments?: HistoryAttachment[];
};

export interface GenerateOptions {
  backend: BackendSpec;
  history: HistoryMessage[];
  /** OpenClaw Docker runtime isolation identity */
  openclaw?: OpenClawRuntimeIdentity;
  /** Agent template materialized into the isolated OpenClaw runtime. */
  openclawTemplate?: OpenClawRuntimeTemplate;
  /** Display name of the end-user sending the message */
  sender?: string;
  /** Chat platform the message came from (e.g. "telegram", "discord") */
  platform?: string;
  /** Callback to persist config changes (e.g. auto-created agentId/environmentId) */
  onConfigUpdate?: (patch: Partial<AiBackendProviderConfig>) => void;
  /** Receives accumulated text while a backend streams. */
  onStream?: (text: string) => void | Promise<void>;
}

// ── Lazy singletons per config hash ──────────────────────────────────────────

const OPENCLAW_CHAT_TIMEOUT_MS = Number(process.env.OPENCLAW_CHAT_TIMEOUT_MS ?? 600_000);
const OPENCLAW_MAX_COMPLETION_TOKENS = Number(process.env.OPENCLAW_MAX_COMPLETION_TOKENS ?? 512);
const OPENCLAW_STREAM = process.env.OPENCLAW_STREAM !== 'false';
const openaiClients = new Map<string, OpenAI>();
const openClawRuntimeQueues = new Map<string, Promise<void>>();

function getOpenAIClient(apiKey: string, baseURL?: string): OpenAI {
  const key = `${apiKey}::${baseURL ?? ''}`;
  if (!openaiClients.has(key)) {
    openaiClients.set(key, new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) }));
  }
  return openaiClients.get(key)!;
}

async function runOpenClawQueued<T>(sessionKey: string | undefined, task: () => Promise<T>): Promise<T> {
  if (!sessionKey) return task();

  const previous = openClawRuntimeQueues.get(sessionKey) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  openClawRuntimeQueues.set(sessionKey, previous.then(() => current, () => current));

  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (openClawRuntimeQueues.get(sessionKey) === current) {
      openClawRuntimeQueues.delete(sessionKey);
    }
  }
}

function openClawQueueKey(identity: OpenClawRuntimeIdentity | undefined, sessionKey: string | undefined): string | undefined {
  if (!identity || !sessionKey) return undefined;
  return `${identity.backendId}:${sessionKey}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function authHeaders(cfg: AiBackendProviderConfig): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.authHeader) h['Authorization'] = cfg.authHeader;
  else if (cfg.apiKey) h['Authorization'] = `Bearer ${cfg.apiKey}`;
  return h;
}

/** Resolve endpoint URL from descriptor pattern + config */
function resolveEndpoint(descriptor: BackendTypeDescriptor, cfg: AiBackendProviderConfig): string {
  const base = (cfg.baseUrl ?? '').replace(/\/$/, '');
  if (descriptor.endpointPattern) {
    return descriptor.endpointPattern.replace('{baseUrl}', base);
  }
  return base;
}

/** Resolve transport — 'custom' reads from config */
function resolveTransport(descriptor: BackendTypeDescriptor, cfg: AiBackendProviderConfig): Transport {
  if (descriptor.type === 'custom' && cfg.transport) return cfg.transport;
  return descriptor.transport;
}

/** Resolve response format — 'custom' reads from config */
function resolveResponseFormat(descriptor: BackendTypeDescriptor, cfg: AiBackendProviderConfig): ResponseFormat {
  if (descriptor.type === 'custom' && cfg.responseFormat) return cfg.responseFormat;
  return descriptor.responseFormat;
}

// ── SSE stream readers ──────────────────────────────────────────────────────

/** Read a simple SSE stream and accumulate text chunks */
async function readSseStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') break;
      try {
        const parsed = JSON.parse(data) as { content?: string; delta?: string; text?: string };
        const chunk = parsed.content ?? parsed.delta ?? parsed.text;
        if (chunk) accumulated += chunk;
      } catch {
        // Plain text chunk
        if (data) accumulated += data;
      }
    }
  }

  return accumulated.trim();
}

async function readOpenAiChatCompletionStream(
  body: ReadableStream<Uint8Array>,
  onStream?: GenerateOptions['onStream'],
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  let buffer = '';
  let doneSeen = false;

  const appendData = (data: string) => {
    if (data === '[DONE]') {
      doneSeen = true;
      return;
    }

    try {
      const parsed = JSON.parse(data) as {
        choices?: Array<{
          delta?: { content?: string | null };
          message?: { content?: string | null };
          text?: string | null;
        }>;
      };
      const choice = parsed.choices?.[0];
      const chunk = choice?.delta?.content ?? choice?.message?.content ?? choice?.text;
      if (chunk) {
        accumulated += chunk;
        void onStream?.(accumulated);
      }
    } catch {
      if (data) {
        accumulated += data;
        void onStream?.(accumulated);
      }
    }
  };

  while (!doneSeen) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const event of events) {
      const dataLines = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .filter(Boolean);
      if (dataLines.length > 0) appendData(dataLines.join('\n'));
      if (doneSeen) break;
    }
  }

  return accumulated.trim();
}

/** Read a LangGraph SSE stream (event: + data: pairs separated by blank lines) */
async function readLangGraphStream(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      if (!part.trim()) continue;

      let eventType = '';
      let dataStr = '';

      for (const line of part.split('\n')) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
        else if (line.startsWith('data: ')) dataStr += line.slice(6);
      }

      if (!eventType || !dataStr) continue;

      let parsed: any;
      try { parsed = JSON.parse(dataStr); } catch { continue; }

      if (eventType === 'messages') {
        if (!Array.isArray(parsed) || parsed.length < 2) continue;
        let chunk: any;
        if (parsed.length >= 3 && typeof parsed[0] === 'string' && Array.isArray(parsed[2])) {
          chunk = parsed[2][0];
        } else {
          chunk = parsed[0];
        }
        if (!chunk) continue;
        const kwargs = chunk.kwargs ?? chunk;
        const content = kwargs.content ?? '';
        if (typeof content === 'string' && content) accumulated += content;
      } else if (eventType === 'values' || eventType === 'result') {
        if (typeof parsed !== 'object' || parsed === null) continue;
        if (typeof parsed.text === 'string' && parsed.text) {
          accumulated = parsed.text;
        } else if (typeof parsed.agentMessage === 'string' && parsed.agentMessage) {
          accumulated = parsed.agentMessage;
        }
      }
    }
  }

  return accumulated.trim();
}

// ── Response parsers ────────────────────────────────────────────────────────

/** Parse response body according to response format */
async function parseResponse(
  res: Response,
  format: ResponseFormat,
): Promise<string> {
  switch (format) {
    case 'langgraph': {
      if (res.body) return readLangGraphStream(res.body);
      return (await res.text()).trim();
    }
    case 'raw-text': {
      return (await res.text()).trim();
    }
    case 'json-auto':
    default: {
      const contentType = res.headers.get('content-type') ?? '';

      // If it's SSE, read the stream
      if (contentType.includes('text/event-stream') && res.body) {
        return readSseStream(res.body);
      }

      if (!contentType.includes('application/json')) {
        const body = await res.text();
        throw new Error(`Backend returned non-JSON response (${contentType || 'no content-type'}): ${body.slice(0, 200)}`);
      }

      const data = (await res.json()) as Record<string, unknown>;

      // Handle { ok, reply, error } pattern (claude-code)
      if (typeof data.ok === 'boolean') {
        if (!data.ok) throw new Error(`Backend error: ${data.error ?? 'unknown'}`);
        return ((data.reply ?? '') as string).trim();
      }

      // Try common fields
      const text = data.reply ?? data.content ?? data.message ?? data.text;
      if (typeof text === 'string') return text.trim();

      // OpenAI Chat Completions shape
      if (Array.isArray(data.choices) && data.choices[0]?.message?.content) {
        return (data.choices[0].message.content as string).trim();
      }

      return '';
    }
  }
}

// ── Hooks ────────────────────────────────────────────────────────────────────

async function runPalmosRegister(
  cfg: AiBackendProviderConfig,
  ctx: PalmosContext | undefined,
): Promise<string | undefined> {
  if (!ctx) return undefined;
  const baseUrl = (process.env.PALMOS_BASE_URL ?? cfg.baseUrl ?? 'https://pulse-editor.com').replace(/\/$/, '');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cfg.apiKey}`,
  };
  const regRes = await fetch(`${baseUrl}/api/external-auth/register`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      externalId: ctx.endUserId,
      tenantId: ctx.tenantId,
      userName: ctx.displayName,
    }),
  });
  if (regRes.ok) {
    const ct = regRes.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      const data = (await regRes.json()) as { palmosUserId: string };
      return data.palmosUserId;
    } else {
      console.warn(`[palmos] Registration returned non-JSON (${ct}):`, (await regRes.text()).slice(0, 200));
    }
  }
  return undefined;
}

// ── Transport handlers ──────────────────────────────────────────────────────

/**
 * Handle OpenAI SDK-based backends (llm, openclaw).
 * These use the OpenAI client library rather than raw fetch.
 */
/** Convert a history message to an OpenAI-compatible message with multimodal content. */
function toOpenAiMessage(m: HistoryMessage): { role: 'user' | 'assistant'; content: any } {
  const imageAttachments = m.attachments?.filter((a) => a.contentType.startsWith('image/')) ?? [];
  if (m.role === 'user' && imageAttachments.length > 0) {
    const parts: any[] = [];
    if (m.content) parts.push({ type: 'text', text: m.content });
    for (const att of imageAttachments) {
      parts.push({ type: 'image_url', image_url: { url: att.url } });
    }
    // Include non-image attachments as text references
    const nonImage = m.attachments?.filter((a) => !a.contentType.startsWith('image/')) ?? [];
    if (nonImage.length > 0) {
      const refs = nonImage.map((a) => `[Attached file: ${a.filename} (${a.contentType})]`).join('\n');
      parts.push({ type: 'text', text: refs });
    }
    return { role: m.role, content: parts };
  }
  return { role: m.role, content: m.content };
}

async function handleOpenAiSdk(
  type: AiBackendType,
  cfg: AiBackendProviderConfig,
  history: HistoryMessage[],
  options: Pick<GenerateOptions, 'openclaw' | 'openclawTemplate' | 'platform' | 'onStream'> = {},
): Promise<string> {
  if (type === 'openclaw') {
    const url = cfg.baseUrl;
    if (!url) throw new Error('OpenClaw backend: baseUrl is required');
    const apiKey = cfg.apiKey ?? 'openclaw';
    const configuredModel = cfg.model?.trim();
    const model = configuredModel?.startsWith('openclaw') ? configuredModel : 'openclaw/default';
    const providerModel = configuredModel && !configuredModel.startsWith('openclaw') ? configuredModel : undefined;
    const sessionKey = options.openclaw ? openClawSessionKey(options.openclaw) : undefined;
    const queueKey = openClawQueueKey(options.openclaw, sessionKey);
    const startedAt = Date.now();
    let queueWaitMs = 0;
    const response = await runOpenClawQueued(queueKey, async () => {
      queueWaitMs = Date.now() - startedAt;
      const messages = history.map(toOpenAiMessage);
      const fetchStartedAt = Date.now();
      try {
        const res = await fetch(`${url.replace(/\/$/, '')}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Accept': OPENCLAW_STREAM ? 'text/event-stream' : 'application/json',
            'Content-Type': 'application/json',
            'x-openclaw-scopes': 'operator.read,operator.write',
            ...(sessionKey ? { 'x-openclaw-session-key': sessionKey } : {}),
            ...(options.platform ? { 'x-openclaw-message-channel': options.platform } : {}),
            ...(providerModel ? { 'x-openclaw-model': providerModel } : {}),
          },
          body: JSON.stringify({
            model,
            messages,
            max_completion_tokens: OPENCLAW_MAX_COMPLETION_TOKENS,
            ...(OPENCLAW_STREAM ? { stream: true } : {}),
            ...(sessionKey ? { user: sessionKey } : {}),
          }),
          signal: AbortSignal.timeout(OPENCLAW_CHAT_TIMEOUT_MS),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`OpenClaw backend: ${res.status} ${text.slice(0, 500)}`);
        }
        const contentType = res.headers.get('content-type') ?? '';
        if (OPENCLAW_STREAM && contentType.includes('text/event-stream') && res.body) {
          return { content: await readOpenAiChatCompletionStream(res.body, options.onStream), fetchMs: Date.now() - fetchStartedAt };
        }
        const text = await res.text();
        const parsed = JSON.parse(text) as {
          choices?: Array<{ message?: { content?: string | null } }>;
        };
        return { content: parsed.choices?.[0]?.message?.content?.trim() ?? '', fetchMs: Date.now() - fetchStartedAt };
      } catch (error) {
        if (isOpenClawConnectionInterrupted(error)) {
          throw new Error('OpenClaw runtime connection closed while processing. The runtime may have restarted after applying workspace or skills changes; retry after it becomes ready.');
        }
        throw error;
      }
    });
    if (sessionKey) {
      console.log(`[openclaw] Chat completed for ${sessionKey} in ${Date.now() - startedAt}ms (queue=${queueWaitMs}ms fetch=${response.fetchMs}ms)`);
    }
    return response.content;
  }

  // llm
  const apiKey = cfg.apiKey ?? '';
  if (!apiKey) throw new Error('LLM backend: apiKey is required');
  const client = getOpenAIClient(apiKey, cfg.baseUrl);
  const model = cfg.model || 'gpt-4o-mini';
  const messages: any[] = [];
  if (cfg.systemPrompt) messages.push({ role: 'system', content: cfg.systemPrompt });
  messages.push(...history.map(toOpenAiMessage));
  const response = await client.chat.completions.create({ model, messages, max_completion_tokens: 1024 });
  return response.choices[0]?.message?.content?.trim() ?? '';
}

function isOpenClawConnectionInterrupted(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const cause = (error as { cause?: unknown }).cause;
  const causeCode = cause && typeof cause === 'object' ? (cause as { code?: unknown }).code : undefined;
  return error.name === 'TypeError' && error.message === 'terminated' && causeCode === 'UND_ERR_SOCKET';
}

/**
 * Handle HTTP/SSE-based backends via raw fetch.
 */
async function handleFetch(
  descriptor: BackendTypeDescriptor,
  cfg: AiBackendProviderConfig,
  history: HistoryMessage[],
  extraBody?: Record<string, unknown>,
): Promise<string> {
  const url = resolveEndpoint(descriptor, cfg);
  if (!url) throw new Error(`${descriptor.label} backend: baseUrl is required`);

  const responseFormat = resolveResponseFormat(descriptor, cfg);

  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(cfg),
    body: JSON.stringify({
      messages: history,
      ...(cfg.systemPrompt && descriptor.type === 'claude-code' ? { system_prompt: cfg.systemPrompt } : {}),
      ...extraBody,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`${descriptor.label} error: ${res.status} ${errBody.slice(0, 200)}`);
  }

  return parseResponse(res, responseFormat);
}

// ── WebSocket bridge registry (for cli-bridge) ────────────────────────────

import type { WebSocket } from 'ws';

const bridgeConnections = new Map<string, WebSocket>();
const pendingReplies = new Map<string, { resolve: (text: string) => void; reject: (err: Error) => void }>();

export function registerBridgeConnection(backendId: string, ws: WebSocket): void {
  bridgeConnections.set(backendId, ws);
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString()) as { type: string; requestId: string; text?: string; error?: string };
      if (msg.type === 'reply' && msg.requestId) {
        const pending = pendingReplies.get(msg.requestId);
        if (pending) {
          pendingReplies.delete(msg.requestId);
          if (msg.error) pending.reject(new Error(msg.error));
          else pending.resolve(msg.text ?? '');
        }
      }
    } catch { /* ignore parse errors */ }
  });
  ws.on('close', () => { bridgeConnections.delete(backendId); });
}

export function isBridgeConnected(backendId: string): boolean {
  const ws = bridgeConnections.get(backendId);
  return ws !== undefined && ws.readyState === ws.OPEN;
}

async function handlePtyWebSocket(
  backendId: string,
  history: HistoryMessage[],
  meta?: { sender?: string; platform?: string },
): Promise<string> {
  const ws = bridgeConnections.get(backendId);
  if (!ws || ws.readyState !== ws.OPEN) {
    return '⚠️ Local bridge is not connected. Please start the bridge on your machine.';
  }

  const requestId = `br_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingReplies.delete(requestId);
      reject(new Error('Local bridge timed out (120s)'));
    }, 120_000);

    pendingReplies.set(requestId, {
      resolve: (text) => { clearTimeout(timeout); resolve(text); },
      reject: (err) => { clearTimeout(timeout); reject(err); },
    });

    ws.send(JSON.stringify({
      type: 'message', requestId, history,
      ...(meta?.sender ? { sender: meta.sender } : {}),
      ...(meta?.platform ? { platform: meta.platform } : {}),
    }));
  });
}

// ── Claude Managed Agents handler ───────────────────────────────────────────

const ANTHROPIC_API = 'https://api.anthropic.com';
const ANTHROPIC_BETA = 'managed-agents-2026-04-01';
const ANTHROPIC_VERSION = '2023-06-01';

function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'anthropic-beta': ANTHROPIC_BETA,
  };
}

/** Ensure the managed agent and environment exist, creating them if needed. Returns { agentId, environmentId }. */
async function ensureAgentAndEnvironment(
  cfg: AiBackendProviderConfig,
  onUpdate?: (patch: Partial<AiBackendProviderConfig>) => void,
): Promise<{ agentId: string; environmentId: string }> {
  const apiKey = cfg.apiKey!;
  const headers = anthropicHeaders(apiKey);

  let agentId = cfg.agentId;
  let environmentId = cfg.environmentId;
  let updated = false;

  if (!agentId) {
    const res = await fetch(`${ANTHROPIC_API}/v1/agents`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'ClawScale Agent',
        model: cfg.model || 'claude-sonnet-4-6',
        ...(cfg.systemPrompt ? { system: cfg.systemPrompt } : {}),
        tools: [{ type: 'agent_toolset_20260401' }],
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Failed to create Claude agent: ${res.status} ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { id: string };
    agentId = data.id;
    updated = true;
  }

  if (!environmentId) {
    const res = await fetch(`${ANTHROPIC_API}/v1/environments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'ClawScale Environment',
        config: {
          type: 'cloud',
          networking: { type: 'unrestricted' },
        },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Failed to create Claude environment: ${res.status} ${body.slice(0, 300)}`);
    }
    const data = (await res.json()) as { id: string };
    environmentId = data.id;
    updated = true;
  }

  if (updated) {
    cfg.agentId = agentId;
    cfg.environmentId = environmentId;
    onUpdate?.({ agentId, environmentId });
  }

  return { agentId, environmentId };
}

/**
 * Handle Claude Managed Agents backend.
 * Creates a session per request, sends the last user message, streams events until idle.
 */
async function handleClaudeAgent(
  cfg: AiBackendProviderConfig,
  history: HistoryMessage[],
  onConfigUpdate?: (patch: Partial<AiBackendProviderConfig>) => void,
): Promise<string> {
  if (!cfg.apiKey) throw new Error('Claude Agent backend: apiKey is required');

  const { agentId, environmentId } = await ensureAgentAndEnvironment(cfg, onConfigUpdate);
  const headers = anthropicHeaders(cfg.apiKey);

  // Create a session
  const sessionRes = await fetch(`${ANTHROPIC_API}/v1/sessions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      agent: agentId,
      environment_id: environmentId,
    }),
  });
  if (!sessionRes.ok) {
    const body = await sessionRes.text().catch(() => '');
    throw new Error(`Failed to create Claude session: ${sessionRes.status} ${body.slice(0, 300)}`);
  }
  const session = (await sessionRes.json()) as { id: string };

  // Build user message content from the last user message in history
  const lastUserMsg = [...history].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) throw new Error('No user message in history');

  const content: { type: string; text?: string }[] = [{ type: 'text', text: lastUserMsg.content }];

  // Send user event
  const sendRes = await fetch(`${ANTHROPIC_API}/v1/sessions/${session.id}/events`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      events: [{ type: 'user.message', content }],
    }),
  });
  if (!sendRes.ok) {
    const body = await sendRes.text().catch(() => '');
    throw new Error(`Failed to send event: ${sendRes.status} ${body.slice(0, 300)}`);
  }

  // Stream SSE response until idle
  const streamRes = await fetch(`${ANTHROPIC_API}/v1/sessions/${session.id}/stream`, {
    method: 'GET',
    headers: {
      ...anthropicHeaders(cfg.apiKey),
      'Accept': 'text/event-stream',
    },
    signal: AbortSignal.timeout(300_000), // 5 min timeout for agent tasks
  });
  if (!streamRes.ok || !streamRes.body) {
    const body = await streamRes.text().catch(() => '');
    throw new Error(`Failed to stream session: ${streamRes.status} ${body.slice(0, 300)}`);
  }

  // Read SSE events and accumulate agent message text
  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data) continue;

      let event: any;
      try { event = JSON.parse(data); } catch { continue; }

      if (event.type === 'agent.message' && Array.isArray(event.content)) {
        for (const block of event.content) {
          if (block.type === 'text' && block.text) accumulated += block.text;
        }
      } else if (event.type === 'session.status_idle' || event.type === 'session.status_terminated') {
        reader.cancel();
        break;
      }
    }
  }

  return accumulated.trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

const CONNECTION_ERROR_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET']);

function isConnectionError(err: unknown): string | null {
  const code = (err as { cause?: { code?: string } })?.cause?.code
    ?? (err as { code?: string })?.code;
  return code && CONNECTION_ERROR_CODES.has(code) ? code : null;
}

export async function generateReply(options: GenerateOptions): Promise<string> {
  const { backend, history } = options;
  const { type, config: cfg } = backend;

  const descriptor = BACKEND_TYPE_DESCRIPTORS[type];
  if (!descriptor) throw new Error(`Unknown AI backend type: ${type}`);

  try {
    // Run pre-request hooks
    let extraBody: Record<string, unknown> = {};
    if (descriptor.hooks?.includes('palmos-register')) {
      const baseUrl = (process.env.PALMOS_BASE_URL ?? cfg.baseUrl ?? 'https://pulse-editor.com').replace(/\/$/, '');
      const palmosUserId = await runPalmosRegister(cfg, backend.palmosCtx);
      if (palmosUserId) extraBody.userId = palmosUserId;
      if (backend.palmosCtx?.conversationId) extraBody.threadId = backend.palmosCtx.conversationId;
      // Override baseUrl for endpoint resolution
      cfg.baseUrl = baseUrl;
    }

    // Dispatch by transport
    const transport = resolveTransport(descriptor, cfg);

    switch (transport) {
      case 'http':
      case 'sse': {
        // Claude Managed Agents has its own multi-step handler
        if (type === 'claude-agent') {
          return await handleClaudeAgent(cfg, history, options.onConfigUpdate);
        }
        // llm and openclaw use the OpenAI SDK client
        if (type === 'llm' || type === 'openclaw') {
          if (type === 'openclaw' && options.openclaw && process.env.OPENCLAW_DOCKER_ISOLATION !== 'false') {
            const ensureStartedAt = Date.now();
            const runtime = await ensureOpenClawDockerRuntime(options.openclaw, options.openclawTemplate);
            console.log(`[openclaw] Ensure completed for ${runtime.containerName} in ${Date.now() - ensureStartedAt}ms`);
            cfg.baseUrl = runtime.baseUrl;
            cfg.apiKey = runtime.gatewayToken;
          }
          return await handleOpenAiSdk(type, cfg, history, options);
        }
        return await handleFetch(descriptor, cfg, history, extraBody);
      }
      case 'pty-websocket': {
        // Need a backend ID — passed via a convention on the config
        const backendId = (cfg as any).__backendId as string | undefined;
        if (!backendId) throw new Error('Local bridge backend: missing backend ID');
        return await handlePtyWebSocket(backendId, history, {
          sender: options.sender,
          platform: options.platform,
        });
      }
      case 'websocket': {
        // Future: persistent WebSocket connections for custom backends
        throw new Error('WebSocket transport is not yet implemented for remote backends');
      }
      default:
        throw new Error(`Unknown transport: ${transport}`);
    }
  } catch (err: unknown) {
    const code = isConnectionError(err);
    if (code) {
      console.warn(`[${type}] Backend unavailable (${code}), skipping`);
      return `⚠️ The ${type} backend is currently unavailable (${code}). Please try again later.`;
    }
    throw err;
  }
}
