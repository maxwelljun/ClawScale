/**
 * routeInboundMessage — central message routing function.
 *
 * All channel adapters call this directly. It handles:
 *   - EndUser creation / lookup
 *   - Access policy enforcement
 *   - Conversation management
 *   - Message persistence
 *   - Commands: forwarded to active backend; use "> /cmd" for ClawScale
 *   - Direct messages: agent> message, > message (ClawScale)
 *   - AI backend routing (multi-backend)
 */

import { db } from '../db/index.js';
import { generateId } from './id.js';
import { generateReply } from './ai-backend.js';
import { prewarmOpenClawDockerRuntime } from './openclaw-docker.js';
import type { OpenClawRuntimeTemplate } from './openclaw-docker.js';
import { runClawscaleAgent, buildSelectionMenu } from './clawscale-agent.js';
import type { AgentLlmConfig } from './clawscale-agent.js';
import { parseCommand, resolveTarget, resolveAddRemoveArg, formatCommandHelp } from './slash-commands.js';
import type { AiBackendType, AiBackendProviderConfig } from '../../shared/index.js';

// ── Per-user rate limiter (in-memory) ────────────────────────────────────────

interface RateBucket {
  count: number;
  resetAt: number;
}

/** Key: `${tenantId}:${endUserId}` */
const rateBuckets = new Map<string, RateBucket>();

function isRateLimited(
  tenantId: string,
  endUserId: string,
  limit: { maxMessages: number; windowSeconds: number },
): boolean {
  if (limit.maxMessages <= 0) return false; // 0 = unlimited
  const key = `${tenantId}:${endUserId}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + limit.windowSeconds * 1000 });
    return false;
  }
  bucket.count++;
  return bucket.count > limit.maxMessages;
}

export interface Attachment {
  url: string;
  filename: string;
  contentType: string;
  size?: number;
}

export interface InboundMessage {
  channelId: string;
  externalId: string;
  displayName?: string;
  text: string;
  attachments?: Attachment[];
  meta?: Record<string, unknown>;
  onStream?: (update: { backendId: string; backendName: string; text: string; done?: boolean }) => void | Promise<void>;
}

export interface ReplyEntry {
  backendId: string | null;
  backendName: string | null;
  reply: string;
}

export interface RouteResult {
  conversationId: string;
  replies: ReplyEntry[];
  /** @deprecated Use replies[0].reply for backwards compat with single-reply adapters */
  reply: string;
}

export async function routeInboundMessage(input: InboundMessage): Promise<RouteResult | null> {
  const { channelId, externalId, displayName, text, attachments, meta, onStream } = input;

  const platform = (meta?.platform as string) ?? 'unknown';
  console.log(`[inbound] ${platform} | user=${displayName ?? externalId} (${externalId}) | channel=${channelId}`);

  // 1. Resolve channel + tenant
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: {
      id: true,
      tenantId: true,
      status: true,
      agentTemplateId: true,
      agentTemplateVersionId: true,
      agentTemplateVersion: true,
    },
  });
  if (!channel || channel.status !== 'connected') return null;
  const { tenantId } = channel;

  // 2. Load tenant settings
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  const settings = (tenant?.settings ?? {}) as {
    personaName?: string;
    endUserAccess?: 'anonymous' | 'whitelist' | 'blacklist';
    allowList?: string[];
    clawscale?: { name?: string; answerStyle?: string; isActive?: boolean; rateLimit?: { maxMessages: number; windowSeconds: number }; llm?: AgentLlmConfig };
    blockList?: string[];
    backendLabels?: 'show' | 'hide' | 'force-hide';
  };

  // 3. Find or create EndUser
  let endUser = await db.endUser.findUnique({
    where: { tenantId_channelId_externalId: { tenantId, channelId, externalId } },
    include: { activeBackends: { select: { backendId: true } } },
  });
  const isNewUser = !endUser;
  if (!endUser) {
    endUser = await db.endUser.create({
      data: { id: generateId('eu'), tenantId, channelId, externalId, name: displayName ?? null, status: 'allowed' },
      include: { activeBackends: { select: { backendId: true } } },
    });
  } else if (displayName && !endUser.name) {
    endUser = await db.endUser.update({
      where: { id: endUser.id },
      data: { name: displayName },
      include: { activeBackends: { select: { backendId: true } } },
    });
  }
  const activeBackendIds = endUser.activeBackends.map((ab) => ab.backendId);

  // 4. Enforce access policy
  const access = settings.endUserAccess ?? 'anonymous';
  if (endUser.status === 'blocked') return null;
  if (access === 'whitelist' && !(settings.allowList ?? []).includes(externalId)) return null;
  if (access === 'blacklist' && (settings.blockList ?? []).includes(externalId)) {
    await db.endUser.update({ where: { id: endUser.id }, data: { status: 'blocked' } });
    return null;
  }

  // 5. Find or create Conversation
  let conversation = await db.conversation.findFirst({
    where: { tenantId, channelId, endUserId: endUser.id },
  });
  if (!conversation) {
    conversation = await db.conversation.create({
      data: { id: generateId('conv'), tenantId, channelId, endUserId: endUser.id },
    });
  }

  // 6. Persist inbound message
  await db.message.create({
    data: {
      id: generateId('msg'), conversationId: conversation.id, role: 'user', content: text,
      metadata: { ...(meta ?? {}), ...(attachments?.length ? { attachments } : {}) } as any,
    },
  });

  // 6b. Resolve all conversation IDs for linked accounts (cross-channel history)
  const historyConvIds = endUser.linkedTo
    ? await getLinkedConversationIds(endUser.id, endUser.linkedTo, tenantId)
    : [conversation.id];

  // 7. Load backends and ClawScale config
  const clawscaleCfg = settings.clawscale ?? {};
  const clawscaleName = clawscaleCfg.name ?? 'ClawBot Setup Assistant';
  const clawscaleStyle = clawscaleCfg.answerStyle;
  const clawscaleActive = clawscaleCfg.isActive !== false;
  const clawscaleLlm = clawscaleCfg.llm ?? { model: 'openai:gpt-5.4-mini' };
  const clawscaleRateLimit = clawscaleCfg.rateLimit;

  // Resolve backend label visibility
  const labelPolicy = settings.backendLabels ?? 'show';
  const userMeta = (endUser.metadata ?? {}) as Record<string, unknown>;
  const userHideLabels = userMeta.hideLabels as boolean | undefined;
  const hideLabels = labelPolicy === 'force-hide'
    || (labelPolicy === 'hide' && userHideLabels !== false)
    || (labelPolicy === 'show' && userHideLabels === true);

  let allBackends = await db.aiBackend.findMany({
    where: {
      tenantId,
      isActive: true,
      ...(channel.agentTemplateId ? { id: channel.agentTemplateId } : {}),
    },
    include: {
      modelProvider: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  allBackends = await Promise.all(allBackends.map((backend) => applyAgentTemplateVersion(backend, channel.agentTemplateVersion)));
  if (channel.agentTemplateId && allBackends[0] && !activeBackendIds.includes(channel.agentTemplateId)) {
    await db.endUserBackend.upsert({
      where: { endUserId_backendId: { endUserId: endUser.id, backendId: channel.agentTemplateId } },
      create: { endUserId: endUser.id, backendId: channel.agentTemplateId },
      update: {},
    });
    activeBackendIds.push(channel.agentTemplateId);
  }
  if (channel.agentTemplateId && allBackends[0]) {
    await db.conversation.update({
      where: { id: conversation.id },
      data: {
        backendId: allBackends[0].id,
        agentTemplateVersionId: channel.agentTemplateVersionId ?? null,
        modelProviderId: allBackends[0].modelProviderId ?? null,
        metadata: {
          ...((conversation.metadata ?? {}) as Record<string, unknown>),
          routingMode: 'channel-agent-template',
          agentTemplateId: allBackends[0].id,
          agentTemplateVersionId: channel.agentTemplateVersionId ?? null,
          modelProviderId: allBackends[0].modelProviderId ?? null,
        },
      },
    });
  }
  const openClawBackends = allBackends.filter((backend) => backend.type === 'openclaw');
  if (isNewUser && openClawBackends.length > 0 && process.env.OPENCLAW_DOCKER_ISOLATION !== 'false') {
    for (const backend of openClawBackends) {
      prewarmOpenClawDockerRuntime({
        tenantId,
        channelId,
        endUserId: endUser.id,
        backendId: backend.id,
      }, buildOpenClawTemplate(backend));
    }
  }
  if (channel.agentTemplateId && allBackends[0]) {
    console.log(`[route] channel=${channelId} agent=${allBackends[0].name} (${allBackends[0].id}) version=${channel.agentTemplateVersion?.version ?? 'draft'} modelProvider=${allBackends[0].modelProvider?.name ?? 'none'} model=${((allBackends[0].config ?? {}) as AiBackendProviderConfig).model ?? readFirstModel(allBackends[0].modelProvider?.models) ?? 'default'}`);
  }

  const replies: ReplyEntry[] = [];

  /**
   * Run the ClawScale LangChain agent.
   *
   * The agent handles the full reason → act → observe loop internally.
   * Slash commands are executed via a callback that re-enters routeInboundMessage.
   */
  async function runAgent(userText: string, mode: 'select' | 'direct'): Promise<RouteResult> {
    // Rate limit check
    if (clawscaleRateLimit && isRateLimited(tenantId, endUser!.id, clawscaleRateLimit)) {
      const mins = Math.ceil(clawscaleRateLimit.windowSeconds / 60);
      return reply(
        `⏳ You've reached the message limit (${clawscaleRateLimit.maxMessages} per ${mins === 1 ? 'minute' : `${mins} minutes`}). Please wait a moment before sending another message.`,
      );
    }

    // If attachments are present but multimodal is not enabled, nudge the admin
    if (attachments?.length && !clawscaleLlm?.multimodal) {
      return reply(
        `I received your ${attachments.length > 1 ? 'files' : 'file'}, but I can't process non-text content yet.\n\n` +
        'Ask your admin to enable **multimodal input** in the ClawBot dashboard:\n' +
        '**Settings → ClawBot Setup Assistant → Enable multimodal input**',
      );
    }

    const agentHistory = await loadHistory(historyConvIds, null);
    const agentReply = await runClawscaleAgent({
      text: userText,
      backends: allBackends.map((b) => ({ id: b.id, name: b.name })),
      activeIds: [...activeBackendIds],
      personaName: clawscaleName,
      mode,
      history: agentHistory,
      attachments,
      ...(clawscaleStyle != null && { answerStyle: clawscaleStyle }),
      ...(clawscaleLlm != null && { llmConfig: clawscaleLlm }),
      executeCommand: async (command) => {
        // Ensure command starts with "/" — reject plain-text commands
        // that would be routed as regular messages instead of executed.
        const trimmed = command.trim();
        if (!trimmed.startsWith('/')) {
          return `Error: "${trimmed}" is not a valid command. Commands must start with "/". Example: /team kick elie`;
        }
        const result = await routeInboundMessage({ ...input, text: trimmed });
        return result?.reply ?? '(no result)';
      },
    });

    if (!agentReply) return { conversationId: conversation!.id, replies, reply: '' };
    return reply(agentReply);
  }

  // ── Helper closures ─────────────────────────────────────────────────

  function formatCombined(entries: ReplyEntry[]): string {
    return entries.map((r) =>
      r.backendName && !hideLabels ? `[${r.backendName}]\n${r.reply}` : r.reply,
    ).join('\n\n---\n\n');
  }

  async function reply(content: string, backendId: string | null = null, backendName: string | null = clawscaleName): Promise<RouteResult> {
    replies.push({ backendId, backendName, reply: content });
    await db.message.create({
      data: { id: generateId('msg'), conversationId: conversation!.id, role: 'assistant', content, backendId },
    });
    await db.conversation.update({ where: { id: conversation!.id }, data: { updatedAt: new Date() } });
    return { conversationId: conversation!.id, replies, reply: formatCombined(replies) };
  }

  async function addBackend(backendId: string) {
    await db.endUserBackend.upsert({
      where: { endUserId_backendId: { endUserId: endUser!.id, backendId } },
      create: { endUserId: endUser!.id, backendId },
      update: {},
    });
    if (!activeBackendIds.includes(backendId)) activeBackendIds.push(backendId);
  }

  async function removeBackend(backendId: string) {
    await db.endUserBackend.deleteMany({
      where: { endUserId: endUser!.id, backendId },
    });
    const idx = activeBackendIds.indexOf(backendId);
    if (idx !== -1) activeBackendIds.splice(idx, 1);
  }

  async function removeAllBackends() {
    await db.endUserBackend.deleteMany({ where: { endUserId: endUser!.id } });
    activeBackendIds.length = 0;
  }

  function formatList(highlightActive = true): string {
    return allBackends.map((b, i) => {
      const active = highlightActive && activeBackendIds.includes(b.id) ? ' ✅' : '';
      return `${i + 1}. ${b.name}${active}`;
    }).join('\n');
  }

  async function routeToBackends(backends: typeof allBackends, currentText = text): Promise<RouteResult> {
    const hasPalmos = backends.some((b) => b.type === 'palmos');
    const palmosCtx = hasPalmos
      ? {
          endUserId: endUser!.linkedTo ?? endUser!.id,
          tenantId,
          conversationId: conversation!.id,
          displayName: endUser!.name ?? displayName,
        }
      : undefined;
    const results = await Promise.allSettled(
      backends.map(async (backend) => {
        const replyText = await runBackend(backend, historyConvIds, palmosCtx, {
          sender: endUser!.name ?? displayName,
          platform,
          tenantId,
          channelId,
          endUserId: endUser!.id,
          currentMessage: { content: currentText, attachments },
          ...(backends.length === 1 && onStream ? {
            onStream: (streamText) => onStream({
              backendId: backend.id,
              backendName: backend.name,
              text: backend.name && !hideLabels ? `[${backend.name}]\n${streamText}` : streamText,
            }),
          } : {}),
        });
        return { backend, replyText };
      }),
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { backend, replyText } = result.value;
        replies.push({ backendId: backend.id, backendName: backend.name, reply: replyText });
        await db.message.create({
          data: {
            id: generateId('msg'), conversationId: conversation!.id,
            role: 'assistant', content: replyText, backendId: backend.id,
            metadata: { backendName: backend.name },
          },
        });
        if (backends.length === 1 && onStream) {
          await onStream({
            backendId: backend.id,
            backendName: backend.name,
            text: backend.name && !hideLabels ? `[${backend.name}]\n${replyText}` : replyText,
            done: true,
          });
        }
      } else {
        console.error('[backend error]', (result as PromiseRejectedResult).reason);
      }
    }
    await db.conversation.update({ where: { id: conversation!.id }, data: { updatedAt: new Date() } });
    return { conversationId: conversation!.id, replies, reply: formatCombined(replies) };
  }

  // 8. Parse commands
  const cmd = parseCommand(text);
  const activeBackends = allBackends.filter((b) => activeBackendIds.includes(b.id));

  if (cmd) {
    // ── System commands ────────────────────────────────────────────────
    // Bare slash commands (e.g. "/clear") are forwarded to the active
    // backend as regular text.  System commands only execute when
    // explicitly directed to ClawScale via "> /cmd" or "clawscale> /cmd".
    // Fallback: if no backends are active, execute as system command.
    if (cmd.kind === 'system' && activeBackends.length > 0 && !meta?.__forceSystem) {
      // Forward to active backends as plain text
      return routeToBackends(activeBackends);
    }

    if (cmd.kind === 'system') {
      switch (cmd.command) {
        case 'help': {
          return reply(formatCommandHelp());
        }

        case 'team': {
          // Parse subcommand: /team, /team invite <arg>, /team kick [arg]
          const subMatch = cmd.arg.match(/^(invite|kick)(?:\s+([\s\S]+))?$/i);

          if (!subMatch) {
            // /team with no subcommand — show team
            const agents: string[] = [];
            if (clawscaleActive) {
              agents.push(`• *${clawscaleName}* — ClawBot assistant`);
            }
            for (const b of allBackends) {
              if (activeBackendIds.includes(b.id)) {
                agents.push(`• *${b.name}*`);
              }
            }
            if (agents.length === 0) {
              return reply('No agents in your team yet. Use `/team invite <name|#>` to add one.');
            }
            return reply(`*Your team:*\n\n${agents.join('\n')}`);
          }

          const sub = subMatch[1]!.toLowerCase();
          const subArg = (subMatch[2] ?? '').trim();

          if (channel.agentTemplateId && (sub === 'invite' || sub === 'kick')) {
            return reply(`This channel is locked to *${clawscaleName === allBackends[0]?.name ? clawscaleName : allBackends[0]?.name ?? 'the configured agent'}*. Change the channel's agent template in Channels to alter routing.`);
          }

          if (sub === 'invite') {
            if (!subArg) {
              return reply(`Usage: \`/team invite <name|#>\`\n\n${formatList()}`);
            }
            const resolved = resolveAddRemoveArg(subArg, allBackends);
            if (resolved.type !== 'backend' || !resolved.backendId) {
              return reply(`Agent not found: "${subArg}"\n\nAvailable:\n\n${formatList()}`);
            }
            if (activeBackendIds.includes(resolved.backendId)) {
              return reply(`*${resolved.backendName}* is already in your team.`);
            }
            await addBackend(resolved.backendId);
            return reply(`✅ *${resolved.backendName}* joined the team.\n\nActive agents:\n\n${formatList()}`);
          }

          if (sub === 'kick') {
            if (!subArg) {
              // /team kick — kick all
              if (activeBackendIds.length === 0) {
                return reply('No active agents to kick.');
              }
              await removeAllBackends();
              return reply(`✅ Kicked all agents.\n\nAvailable:\n\n${formatList()}`);
            }
            const resolved = resolveAddRemoveArg(subArg, allBackends);
            if (resolved.type !== 'backend' || !resolved.backendId) {
              return reply(`Agent not found: "${subArg}"\n\nActive agents:\n\n${formatList()}`);
            }
            if (!activeBackendIds.includes(resolved.backendId)) {
              return reply(`*${resolved.backendName}* is not currently in your team.`);
            }
            await removeBackend(resolved.backendId);
            return reply(`✅ Kicked *${resolved.backendName}*.\n\nActive agents:\n\n${formatList()}`);
          }

          return reply(`Unknown subcommand. Usage:\n\`/team invite <name|#>\`\n\`/team kick <name|#>\``);
        }

        case 'backends': {
          if (allBackends.length === 0) {
            return reply('No AI backends have been configured. Ask your admin to set one up.');
          }
          const active = allBackends.filter((b) => activeBackendIds.includes(b.id));
          const activeStr = active.length > 0
            ? `\n\n*Active:* ${active.map((b) => b.name).join(', ')}`
            : '\n\nNo backends active. Use `/team invite <name|#>` to add one.';
          return reply(`*Available backends:*\n\n${formatList()}${activeStr}`);
        }

        case 'clear': {
          // Delete all messages in the conversation
          await db.message.deleteMany({ where: { conversationId: conversation.id } });
          return reply('✅ Conversation context cleared.');
        }

        case 'link': {
          if (!cmd.arg) {
            // Generate a link code
            const code = String(Math.floor(100000 + Math.random() * 900000));
            await db.linkCode.create({
              data: {
                code,
                tenantId,
                endUserId: endUser!.id,
                expiresAt: new Date(Date.now() + 10 * 60 * 1000),
              },
            });
            return reply(`Your link code: **${code}**\n\nEnter this code from your other channel within 10 minutes:\n\`/link ${code}\``);
          }

          // Consume a link code
          const linkCode = await db.linkCode.findFirst({
            where: {
              code: cmd.arg,
              used: false,
              tenantId,
              expiresAt: { gt: new Date() },
            },
            include: { endUser: true },
          });

          if (!linkCode) {
            return reply('Invalid or expired link code.');
          }
          if (linkCode.endUserId === endUser!.id) {
            return reply("You can't link to yourself.");
          }

          // Resolve primary: if source is already linked, follow to its primary
          const primaryId = linkCode.endUser.linkedTo ?? linkCode.endUserId;

          // Set current EndUser's linkedTo
          await db.endUser.update({
            where: { id: endUser!.id },
            data: { linkedTo: primaryId },
          });

          // Mark code as used
          await db.linkCode.update({
            where: { id: linkCode.id },
            data: { used: true },
          });

          // Copy active backends from primary
          const primaryBackends = await db.endUserBackend.findMany({
            where: { endUserId: primaryId },
          });
          for (const pb of primaryBackends) {
            await db.endUserBackend.upsert({
              where: { endUserId_backendId: { endUserId: endUser!.id, backendId: pb.backendId } },
              create: { endUserId: endUser!.id, backendId: pb.backendId },
              update: {},
            });
          }

          const sourceName = linkCode.endUser.name ?? linkCode.endUser.externalId;
          return reply(`✅ Linked to *${sourceName}*'s account. Your identities are now connected across channels.`);
        }

        case 'unlink': {
          if (!endUser!.linkedTo) {
            return reply('This channel is not linked to another account.');
          }
          await db.endUser.update({
            where: { id: endUser!.id },
            data: { linkedTo: null },
          });
          return reply('✅ Unlinked. This channel now has its own separate identity.');
        }

        case 'linked': {
          const primaryId = endUser!.linkedTo ?? endUser!.id;

          const linkedUsers = await db.endUser.findMany({
            where: {
              tenantId,
              OR: [
                { id: primaryId },
                { linkedTo: primaryId },
              ],
            },
            include: { channel: { select: { name: true, type: true } } },
            orderBy: { createdAt: 'asc' },
          });

          if (linkedUsers.length <= 1) {
            return reply('No linked accounts. Use `/link` to generate a link code and connect another channel.');
          }

          const lines = linkedUsers.map((u) => {
            const name = u.name ?? u.externalId;
            const isCurrent = u.id === endUser!.id ? ' ← you' : '';
            const isPrimary = u.id === primaryId ? ' (primary)' : '';
            return `• *${name}* — ${u.channel.name} (${u.channel.type})${isPrimary}${isCurrent}`;
          });

          return reply(`*Linked accounts:*\n\n${lines.join('\n')}`);
        }

        case 'labels': {
          const labelPolicy = settings.backendLabels ?? 'show';
          if (labelPolicy === 'force-hide') {
            return reply('Backend labels are disabled by the admin and cannot be changed.');
          }
          // Toggle the user's preference stored in endUser.metadata
          const userMeta = (endUser!.metadata ?? {}) as Record<string, unknown>;
          const currentPref = userMeta.hideLabels as boolean | undefined;
          // Default depends on policy: 'show' → labels visible, 'hide' → labels hidden
          const defaultHidden = labelPolicy === 'hide';
          const currentlyHidden = currentPref ?? defaultHidden;
          const newHidden = !currentlyHidden;
          await db.endUser.update({
            where: { id: endUser!.id },
            data: { metadata: { ...userMeta, hideLabels: newHidden } },
          });
          return reply(newHidden
            ? '✅ Backend labels are now *hidden* in responses. Use `/labels` to show them again.'
            : '✅ Backend labels are now *visible* in responses. Use `/labels` to hide them again.',
          );
        }

        case 'deleteaccount': {
          if (cmd.arg.toLowerCase() !== 'confirm') {
            return reply(
              '⚠️ *This will permanently delete your account and all associated data* (conversations, messages, linked accounts, and backend selections).\n\n' +
              'This action cannot be undone.\n\n' +
              'To confirm, type: `/deleteaccount confirm`',
            );
          }

          const userId = endUser!.id;
          const confirmMsg = '✅ Your account and all associated data have been permanently deleted. Your next message will create a new account.';

          // Reply BEFORE deleting — deletion cascades to conversations/messages
          const result = await reply(confirmMsg);

          // Unlink any accounts that point to this user as primary
          await db.endUser.updateMany({
            where: { linkedTo: userId },
            data: { linkedTo: null },
          });

          // Delete the EndUser (cascades to conversations, messages, backends, link codes)
          await db.endUser.delete({ where: { id: userId } });

          return result;
        }
      }
    }

    // ── Direct message: agent> message ─────────────────────────────────
    if (cmd.kind === 'direct') {
      if (!cmd.message) {
        return reply(`Usage: \`${cmd.target}> message\``);
      }

      const resolved = resolveTarget(cmd.target, allBackends);

      if (resolved.type === 'not_found') {
        const names = allBackends.map((b) => b.name.toLowerCase()).join(', ');
        return reply(`Unknown agent: "${cmd.target}". Available: clawscale, ${names}`);
      }

      if (resolved.type === 'clawscale') {
        if (!clawscaleActive) {
          return reply('ClawBot assistant is currently disabled.');
        }
        // Check if the message is a system command (e.g. "> /clear")
        const innerCmd = parseCommand(cmd.message);
        if (innerCmd?.kind === 'system') {
          // Execute as system command by re-routing with __forceSystem flag
          return routeInboundMessage({ ...input, text: cmd.message, meta: { ...meta, __forceSystem: true } });
        }
        // Direct mode — run agent loop (may execute commands)
        return runAgent(cmd.message, 'direct');
      }

      // Route to specific backend
      const backend = allBackends.find((b) => b.id === resolved.backendId);
      if (!backend) {
        return reply(`Backend "${cmd.target}" is not available.`);
      }
      return routeToBackends([backend], cmd.message);
    }
  }

  // 9. No command — route to active backends or show menu
  if (activeBackends.length > 0) {
    return routeToBackends(activeBackends);
  }

  // No active backends — auto-select only for brand-new users
  if (isNewUser) {
    const defaultBackend = allBackends.find((b) => b.isDefault);
    const autoSelect = defaultBackend ?? (allBackends.length === 1 ? allBackends[0] : null);

    if (autoSelect) {
      await addBackend(autoSelect.id);
      return routeToBackends([autoSelect]);
    }
  }

  // Run ClawScale agent loop (handles knowledge base + command execution)
  if (clawscaleActive) {
    const result = await runAgent(text, 'select');
    // If agent returned empty (silent), fall back to welcome menu
    if (!result.reply) {
      const menuReply = buildSelectionMenu(clawscaleName, allBackends);
      return reply(menuReply);
    }
    return result;
  }

  // Assistant disabled, no active backends — show available backends or a nudge
  if (allBackends.length > 0) {
    const list = allBackends.map((b, i) => `${i + 1}. ${b.name}`).join('\n');
    return reply(`Use \`/team invite <name|#>\` to add an agent:\n\n${list}`);
  }

  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadHistory(conversationIds: string | string[], backendId: string | null) {
  const ids = Array.isArray(conversationIds) ? conversationIds : [conversationIds];
  const msgs = await db.message.findMany({
    where: {
      conversationId: { in: ids },
      OR: [
        { role: 'user' },
        { role: 'assistant', backendId },
      ],
    },
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: { role: true, content: true, metadata: true },
  });
  return msgs.map((m) => {
    const meta = m.metadata as Record<string, unknown> | null;
    const attachments = (meta?.attachments as Attachment[] | undefined) ?? undefined;
    return { role: m.role as 'user' | 'assistant', content: m.content, ...(attachments?.length ? { attachments } : {}) };
  });
}

/** Get all conversation IDs for a linked user group (primary + all linked accounts). */
async function getLinkedConversationIds(endUserId: string, linkedTo: string | null, tenantId: string): Promise<string[]> {
  const primaryId = linkedTo ?? endUserId;

  // Find all EndUser IDs in this linked group
  const linkedUsers = await db.endUser.findMany({
    where: {
      tenantId,
      OR: [
        { id: primaryId },
        { linkedTo: primaryId },
      ],
    },
    select: { id: true },
  });
  const userIds = linkedUsers.map((u) => u.id);

  const conversations = await db.conversation.findMany({
    where: { endUserId: { in: userIds } },
    select: { id: true },
  });
  return conversations.map((c) => c.id);
}

async function runBackend(
  backend: {
    id: string;
    name?: string;
    type: string;
    runtimeType?: string | null;
    config: unknown;
    modelProviderId?: string | null;
    modelProvider?: {
      id: string;
      name: string;
      provider: string;
      baseUrl: string | null;
      apiKey: string | null;
      models: unknown;
    } | null;
    skills?: unknown;
    workspace?: unknown;
    knowledgeBase?: unknown;
  },
  conversationIds: string | string[],
  palmosCtx?: { endUserId: string; tenantId: string; conversationId: string; displayName?: string },
  meta?: {
    sender?: string;
    platform?: string;
    tenantId?: string;
    channelId?: string;
    endUserId?: string;
    currentMessage?: { content: string; attachments?: Attachment[] };
    onStream?: (text: string) => void | Promise<void>;
  },
): Promise<string> {
  if (backend.runtimeType === 'hermass') {
    return '⚠️ Hermass runtime is configured for this agent template, but the Hermass execution adapter is not implemented yet.';
  }
  const history = backend.type === 'openclaw' && meta?.currentMessage
    ? [{
        role: 'user' as const,
        content: meta.currentMessage.content,
        ...(meta.currentMessage.attachments?.length ? { attachments: meta.currentMessage.attachments } : {}),
      }]
    : await loadHistory(conversationIds, backend.id);
  const cfg = { ...((backend.config ?? {}) as AiBackendProviderConfig) };
  const provider = backend.modelProviderId
    ? backend.modelProvider ?? await db.modelProvider.findUnique({ where: { id: backend.modelProviderId } })
    : null;
  if (provider) {
    const models = Array.isArray(provider.models) ? provider.models.filter((m): m is string => typeof m === 'string') : [];
    cfg.baseUrl ??= provider.baseUrl ?? undefined;
    cfg.apiKey ??= provider.apiKey ?? undefined;
    cfg.model ??= models[0];
  }
  // Pass backend ID through for cli-bridge WebSocket lookup
  (cfg as any).__backendId = backend.id;
  return generateReply({
    backend: {
      type: backend.type as AiBackendType,
      config: cfg,
      ...(backend.type === 'palmos' && palmosCtx ? { palmosCtx } : {}),
    },
    history,
    ...(backend.type === 'openclaw' && meta?.tenantId && meta.channelId && meta.endUserId
      ? {
          openclaw: {
            tenantId: meta.tenantId,
            channelId: meta.channelId,
            endUserId: meta.endUserId,
            backendId: backend.id,
          },
        }
      : {}),
    ...(backend.type === 'openclaw'
      ? { openclawTemplate: buildOpenClawTemplate({ ...backend, config: cfg, modelProvider: provider }) }
      : {}),
    sender: meta?.sender,
    platform: meta?.platform,
    onStream: meta?.onStream,
    onConfigUpdate: (patch) => {
      // Persist auto-created config (e.g. Claude Agent agentId/environmentId)
      const existing = (backend.config ?? {}) as Record<string, unknown>;
      db.aiBackend.update({
        where: { id: backend.id },
        data: { config: { ...existing, ...patch } },
      }).catch((err: unknown) => console.error('[config-update] Failed to persist config:', err));
    },
  });
}

function readFirstModel(value: unknown): string | undefined {
  return Array.isArray(value) ? value.find((item): item is string => typeof item === 'string' && item.length > 0) : undefined;
}

function readJsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

async function applyAgentTemplateVersion<T extends {
  id: string;
  name: string;
  type: string;
  runtimeType?: string | null;
  modelProviderId?: string | null;
  modelProvider?: {
    id: string;
    name: string;
    provider: string;
    baseUrl: string | null;
    apiKey: string | null;
    models: unknown;
  } | null;
  config: unknown;
  skills?: unknown;
  workspace?: unknown;
  knowledgeBase?: unknown;
}>(
  backend: T,
  version: { agentTemplateId: string; snapshot: unknown } | null,
): Promise<T> {
  if (!version || version.agentTemplateId !== backend.id || !version.snapshot || typeof version.snapshot !== 'object') {
    return backend;
  }
  const snapshot = version.snapshot as Record<string, unknown>;
  const modelProviderId = typeof snapshot.modelProviderId === 'string' ? snapshot.modelProviderId : backend.modelProviderId;
  const modelProvider = modelProviderId && modelProviderId !== backend.modelProviderId
    ? await db.modelProvider.findUnique({ where: { id: modelProviderId } })
    : backend.modelProvider;

  return {
    ...backend,
    name: typeof snapshot.name === 'string' ? snapshot.name : backend.name,
    type: typeof snapshot.type === 'string' ? snapshot.type : backend.type,
    runtimeType: typeof snapshot.runtimeType === 'string' ? snapshot.runtimeType : backend.runtimeType,
    modelProviderId,
    modelProvider,
    config: snapshot.config ?? backend.config,
    skills: snapshot.skills ?? backend.skills,
    workspace: snapshot.workspace ?? backend.workspace,
    knowledgeBase: snapshot.knowledgeBase ?? backend.knowledgeBase,
  };
}

function buildOpenClawTemplate(backend: {
  id: string;
  name?: string;
  config: unknown;
  modelProvider?: {
    id: string;
    name: string;
    provider: string;
    baseUrl: string | null;
    apiKey: string | null;
    models: unknown;
  } | null;
  skills?: unknown;
  workspace?: unknown;
  knowledgeBase?: unknown;
}): OpenClawRuntimeTemplate {
  const cfg = (backend.config ?? {}) as AiBackendProviderConfig;
  const model = cfg.model ?? readFirstModel(backend.modelProvider?.models) ?? null;
  return {
    name: backend.name,
    systemPrompt: cfg.systemPrompt ?? null,
    modelProvider: backend.modelProvider ? {
      id: backend.modelProvider.id,
      provider: backend.modelProvider.provider,
      baseUrl: backend.modelProvider.baseUrl,
      apiKey: backend.modelProvider.apiKey,
      model,
      api: 'openai-completions',
    } : null,
    skills: readJsonArray(backend.skills),
    workspace: readJsonArray(backend.workspace),
    knowledgeBase: readJsonArray(backend.knowledgeBase),
  };
}
