/**
 * ClawScale Default Agent
 *
 * LLM-backed agent using LangChain.js that can answer questions about
 * ClawScale and execute slash commands as tools.
 *
 * Architecture:
 *   - createAgent() from langchain with a `run_command` tool
 *   - The tool calls back into routeInboundMessage to execute slash commands
 *   - The agent loop (reason → act → observe → repeat) is handled by LangChain
 *   - Falls back to a simple rule-based agent when no LLM is configured
 */

import { createAgent, initChatModel, tool } from 'langchain';
import { z } from 'zod/v4';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { commandList, commandSummary } from './slash-commands.js';

// ── File content extraction ────────────────────────────────────────────────

/**
 * Extract text from a data: URL of a non-PDF file.
 * Supported: docx, xlsx/xls, csv, txt, json, markdown, code files.
 * Returns extracted text or null if unsupported.
 */
async function extractFileText(dataUrl: string, filename: string, contentType: string): Promise<string | null> {
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!match?.[1]) return null;
  const buf = Buffer.from(match[1], 'base64');

  // DOCX
  if (contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || filename.endsWith('.docx')) {
    const result = await mammoth.extractRawText({ buffer: buf });
    return result.value;
  }

  // DOC (older format) — mammoth doesn't support .doc, describe as unsupported
  if (contentType === 'application/msword' || filename.endsWith('.doc')) {
    return null;
  }

  // XLSX / XLS
  if (contentType.includes('spreadsheet') || filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
    const workbook = XLSX.read(buf);
    const texts: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]!);
      texts.push(`--- Sheet: ${sheetName} ---\n${csv}`);
    }
    return texts.join('\n\n');
  }

  // CSV
  if (contentType === 'text/csv' || filename.endsWith('.csv')) {
    return buf.toString('utf-8');
  }

  // Plain text, JSON, markdown, code
  if (contentType.startsWith('text/') || contentType === 'application/json' || filename.match(/\.(txt|md|json|xml|html|css|js|ts|py|yaml|yml|toml|ini|cfg|sh|bat|log|sql)$/i)) {
    return buf.toString('utf-8');
  }

  return null;
}

export interface BackendOption {
  id: string;
  name: string;
}

/** Config for the LLM that powers the ClawScale agent. */
export interface AgentLlmConfig {
  /** Model string in langchain format, e.g. "openai:gpt-5.4-mini", "anthropic:claude-haiku-4-5-20251001" */
  model: string;
  /** API key for the LLM provider */
  apiKey?: string;
  /** Enable multimodal input (images, files, audio) */
  multimodal?: boolean;
}

interface HistoryAttachment {
  url: string;
  filename: string;
  contentType: string;
  size?: number;
}

export interface AgentContext {
  text: string;
  backends: BackendOption[];
  activeIds: string[];
  personaName: string;
  mode: 'select' | 'direct';
  answerStyle?: string;
  llmConfig?: AgentLlmConfig;
  /** Prior conversation history for context continuity. */
  history?: { role: 'user' | 'assistant'; content: string; attachments?: HistoryAttachment[] }[];
  /** Attachments on the current inbound message. */
  attachments?: HistoryAttachment[];
  /** Callback to execute a slash command. Returns the command's output text. */
  executeCommand: (command: string) => Promise<string>;
}

// ── System prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(ctx: AgentContext): string {
  const backendList = ctx.backends.length > 0
    ? ctx.backends.map((b, i) => {
        const active = ctx.activeIds.includes(b.id) ? ' (active)' : '';
        return `  ${i + 1}. ${b.name}${active}`;
      }).join('\n')
    : '  (none configured)';

  return `You are ${ctx.personaName}, the ClawBot assistant.

ClawBot is a multi-tenant AI chat gateway built by Pulse. It connects messaging platforms (WhatsApp, Telegram, Discord, Slack, LINE, Teams, Signal, Matrix, WeChat, and more) to one or more AI backends — so teams can deploy smart assistants without end-users needing accounts or technical knowledge.

You help users with:
- Answering questions about ClawBot
- Managing their AI backends (adding, removing, listing, switching)
- General conversation

Current state:
- Available backends:
${backendList}
- Active backends: ${ctx.activeIds.length > 0 ? ctx.backends.filter(b => ctx.activeIds.includes(b.id)).map(b => b.name).join(', ') : 'none'}

You have a \`run_command\` tool to execute slash commands. Use it when the user wants to manage backends or needs system information. Available commands:
${commandList()}

When you use a tool, incorporate the result naturally into your response.
Keep responses concise and helpful. Use markdown formatting.${ctx.answerStyle ? `\n\nAnswer style: ${ctx.answerStyle}` : ''}`;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the ClawScale agent for a single user message.
 *
 * When an LLM is configured, creates a LangChain agent with the run_command
 * tool and lets it handle the full reason/act/observe loop.
 *
 * Falls back to rule-based responses when no LLM is available.
 */
export async function runClawscaleAgent(ctx: AgentContext): Promise<string> {
  // In select mode with active backends, stay silent — let backends handle it
  if (ctx.mode === 'select' && ctx.activeIds.length > 0) {
    return '';
  }

  if (!ctx.llmConfig || !ctx.llmConfig.apiKey) {
    return 'ClawBot assistant is not fully configured yet. Please go to the admin dashboard → Settings to set up your AI model and API key.';
  }

  // Build the run_command tool with the executeCommand callback
  const runCommand = tool(
    async ({ command }) => {
      try {
        return await ctx.executeCommand(command);
      } catch (err) {
        return `Error executing command: ${err}`;
      }
    },
    {
      name: 'run_command',
      description: `Execute a ClawBot slash command. The command MUST start with "/". Available: ${commandSummary()}. To kick an agent: "/team kick <name>". To invite: "/team invite <name>". To list team: "/team".`,
      schema: z.object({
        command: z
          .string()
          .describe('The exact slash command to execute. MUST start with "/". Examples: "/team kick elie", "/team invite gpt", "/backends", "/team"'),
      }),
    },
  );

  const model = await initChatModel(ctx.llmConfig.model, {
    ...(ctx.llmConfig.apiKey && { apiKey: ctx.llmConfig.apiKey }),
  });

  const agent = createAgent({
    model,
    tools: [runCommand],
    systemPrompt: buildSystemPrompt(ctx),
    name: 'clawscale_agent',
  });

  try {
    const multimodal = ctx.llmConfig.multimodal === true;

    /**
     * Build multimodal content blocks.
     * - Images → image_url blocks
     * - PDFs → native file blocks (OpenAI supports these)
     * - DOCX, XLSX, CSV, TXT, etc. → extracted to text
     * - Unsupported types → text description
     */
    async function buildContent(text: string, attachments?: HistoryAttachment[]): Promise<string | any[]> {
      if (!multimodal || !attachments?.length) return text;
      const parts: any[] = [];
      if (text) parts.push({ type: 'text', text });
      for (const att of attachments) {
        if (att.contentType.startsWith('image/')) {
          parts.push({ type: 'image_url', image_url: { url: att.url } });
        } else if (att.contentType === 'application/pdf' && att.url.startsWith('data:')) {
          // PDFs: send as native file block
          parts.push({
            type: 'file',
            file: { file_data: att.url, filename: att.filename },
          });
        } else if (att.url.startsWith('data:')) {
          // Try to extract text from the file
          const extracted = await extractFileText(att.url, att.filename, att.contentType);
          if (extracted) {
            const truncated = extracted.length > 50000 ? extracted.slice(0, 50000) + '\n\n[... truncated]' : extracted;
            parts.push({ type: 'text', text: `📄 Contents of "${att.filename}":\n\n${truncated}` });
          } else {
            parts.push({ type: 'text', text: `[Attached file: ${att.filename} (${att.contentType}) — unsupported format for content extraction]` });
          }
        } else {
          parts.push({ type: 'text', text: `[Attached file: ${att.filename} (${att.contentType})]` });
        }
      }
      return parts.length > 0 ? parts : text;
    }

    // For history messages, include extracted text from document attachments
    // so the LLM retains context from previously analyzed files.
    // Images use summaries to avoid huge base64 blobs; documents get text-extracted.
    const historyMessages = await Promise.all((ctx.history ?? []).map(async (m) => {
      if (!multimodal || !m.attachments?.length) return { role: m.role, content: m.content };
      const extras: string[] = [];
      for (const att of m.attachments) {
        if (att.contentType.startsWith('image/')) {
          extras.push(`[Attached image: ${att.filename}]`);
        } else if (att.url.startsWith('data:')) {
          const extracted = await extractFileText(att.url, att.filename, att.contentType);
          if (extracted) {
            const truncated = extracted.length > 50000 ? extracted.slice(0, 50000) + '\n\n[... truncated]' : extracted;
            extras.push(`📄 Contents of "${att.filename}":\n\n${truncated}`);
          } else {
            extras.push(`[Attached file: ${att.filename} (${att.contentType})]`);
          }
        } else {
          extras.push(`[Attached file: ${att.filename} (${att.contentType})]`);
        }
      }
      const combined = [m.content, ...extras].filter(Boolean).join('\n');
      return { role: m.role, content: combined };
    }));

    // For the current message, include full attachment content
    const currentContent = await buildContent(ctx.text, ctx.attachments);

    const result = await agent.invoke({
      messages: [...historyMessages, { role: 'user', content: currentContent }],
    });

    // Extract the last assistant message
    const messages = result.messages ?? [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg && typeof msg.content === 'string' && msg.content.trim()) {
        return msg.content.trim();
      }
    }

    return '';
  } catch (err) {
    console.error('[clawscale-agent] LLM error:', err);
    return 'Sorry, something went wrong. Please try again.';
  }
}

// ── Welcome menu ─────────────────────────────────────────────────────────────

export function buildSelectionMenu(personaName: string, backends: BackendOption[]): string {
  if (backends.length === 0) {
    return (
      `👋 Welcome! I'm ${personaName}.\n\n` +
      `No AI backends have been configured yet — please ask your admin to set one up.\n\n` +
      `In the meantime, you can ask me about ClawBot.`
    );
  }

  const list = backends.map((b, i) => `${i + 1}. ${b.name}`).join('\n');
  return (
    `👋 Welcome! I'm ${personaName}.\n\n` +
    `Available AI backends:\n\n${list}\n\n` +
    `Use \`/add <name|#>\` to add a backend, or type \`/help\` for all commands.`
  );
}
