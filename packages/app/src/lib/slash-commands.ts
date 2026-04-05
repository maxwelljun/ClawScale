/**
 * Command parser for ClawScale chat.
 *
 * Two command types:
 *
 * 1. Slash commands — system actions:
 *    /backends              — list available/active backends
 *    /team                  — show agents in the team
 *    /team invite <name|#>  — invite an agent to the team
 *    /team kick <name|#>    — kick an agent (no arg = kick all)
 *    /clear                 — clear conversation context
 *    /help                  — show commands
 *
 * 2. Direct messages — route to a specific agent:
 *    gpt> hello
 *    clawscale> list backends
 *    basic llm> explain this
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type CommandType = 'backends' | 'clear' | 'team' | 'help' | 'link' | 'unlink' | 'linked' | 'deleteaccount';

export interface SystemCommand {
  kind: 'system';
  command: CommandType;
  /** Argument after the command (e.g. "2" for /add 2, or backend name) */
  arg: string;
}

export interface DirectMessage {
  kind: 'direct';
  /** Agent/backend name (everything before ">") */
  target: string;
  /** The message body */
  message: string;
}

export type ParsedCommand = SystemCommand | DirectMessage;

// ── Parser ────────────────────────────────────────────────────────────────────

const SYSTEM_COMMANDS = new Set<CommandType>(['backends', 'clear', 'team', 'help', 'link', 'unlink', 'linked', 'deleteaccount']);

/**
 * Parse user text for commands.
 * Returns null if the text is a regular message.
 */
export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();

  // 1. Direct message: "agent name> message"
  //    Match everything before ">" as agent name (allows spaces),
  //    but only when ">" appears after a word at the start.
  //    Empty target ("> message" or "  > message") means "clawscale".
  const directMatch = trimmed.match(/^(.*?)>\s*([\s\S]*)$/);
  if (directMatch) {
    const target = directMatch[1]!.trim().toLowerCase();
    const message = (directMatch[2] ?? '').trim();
    // Empty target = clawscale (user typed "> /clear" or "> help me")
    if (target === '') {
      return { kind: 'direct', target: 'clawscale', message };
    }
    // Avoid false positives: target must not look like
    // a comparison (e.g. "this is > than that" — target would be very long)
    if (target.length <= 50) {
      return { kind: 'direct', target, message };
    }
  }

  // 2. Slash commands: /command [arg]
  if (!trimmed.startsWith('/')) return null;

  const slashMatch = trimmed.match(/^\/(\S+)(?:\s+([\s\S]+))?$/);
  if (!slashMatch) return null;

  const cmd = slashMatch[1]!.toLowerCase();
  const arg = (slashMatch[2] ?? '').trim();

  if (SYSTEM_COMMANDS.has(cmd as CommandType)) {
    return { kind: 'system', command: cmd as CommandType, arg };
  }

  // Unknown slash command
  return null;
}

// ── Command reference ─────────────────────────────────────────────────────────

/** Single source of truth for all command descriptions. */
export const COMMAND_REFERENCE = [
  { command: '/backends', description: 'list available AI backends' },
  { command: '/team', description: 'show agents in your team' },
  { command: '/team invite <name|#>', description: 'invite an agent to your team' },
  { command: '/team kick <name|#>', description: 'kick an agent from your team' },
  { command: '/team kick', description: 'kick all agents' },
  { command: '/clear', description: 'clear conversation context' },
  { command: '/link', description: 'generate a link code for this channel' },
  { command: '/link <code>', description: 'link this channel to another using a code' },
  { command: '/unlink', description: 'remove the link from this channel' },
  { command: '/linked', description: 'show all linked accounts and channels' },
  { command: '/deleteaccount', description: 'permanently delete your account and all data' },
  { command: '/help', description: 'show all commands' },
] as const;

/** Formatted help text for the /help command and agent prompts. */
export function formatCommandHelp(): string {
  const cmds = COMMAND_REFERENCE.map((c) => `${c.command} — ${c.description}`).join('\n');
  return (
    `*Commands:*\n\n${cmds}\n\n` +
    `*Routing:*\n` +
    `When you have an active backend, \`/command\` is sent to the backend.\n` +
    `To run a ClawScale command, prefix with \`>\`:\n` +
    `\`> /clear\` — run ClawScale's /clear\n` +
    `\`clawscale> /clear\` — same, explicit\n\n` +
    `*Direct message:*\n` +
    `\`agent name> message\` — send a message to a specific agent\n` +
    `\`> message\` — talk to ClawScale directly`
  );
}

/** Short summary for LLM tool descriptions. */
export function commandSummary(): string {
  return COMMAND_REFERENCE.map((c) => c.command).join(', ');
}

/** Bullet list for LLM system prompts. */
export function commandList(): string {
  return COMMAND_REFERENCE.map((c) => `- ${c.command} — ${c.description}`).join('\n');
}

// ── Target resolver ───────────────────────────────────────────────────────────

export interface ResolvedTarget {
  type: 'clawscale' | 'backend' | 'not_found';
  backendId?: string;
  backendName?: string;
}

/**
 * Resolve an agent name to a backend.
 *
 * Matching priority:
 *   1. Reserved name "clawscale"
 *   2. Exact backend name match (case-insensitive)
 *   3. Backend config.commandAlias match (case-insensitive)
 *   4. Prefix match on backend name (if unambiguous)
 */
export function resolveTarget(
  target: string,
  backends: { id: string; name: string; config: unknown }[],
): ResolvedTarget {
  if (target === 'clawscale') {
    return { type: 'clawscale' };
  }

  // Exact name match
  const exact = backends.find((b) => b.name.toLowerCase() === target);
  if (exact) {
    return { type: 'backend', backendId: exact.id, backendName: exact.name };
  }

  // Command alias match
  const aliasMatch = backends.find((b) => {
    const cfg = (b.config ?? {}) as { commandAlias?: string };
    return cfg.commandAlias?.toLowerCase() === target;
  });
  if (aliasMatch) {
    return { type: 'backend', backendId: aliasMatch.id, backendName: aliasMatch.name };
  }

  // Prefix match (unambiguous only)
  const prefixMatches = backends.filter((b) => b.name.toLowerCase().startsWith(target));
  if (prefixMatches.length === 1) {
    return { type: 'backend', backendId: prefixMatches[0]!.id, backendName: prefixMatches[0]!.name };
  }

  return { type: 'not_found' };
}

/**
 * Resolve an /add or /remove argument to a backend.
 * Accepts a number (1-indexed) or a name/alias.
 */
export function resolveAddRemoveArg(
  arg: string,
  backends: { id: string; name: string; config: unknown }[],
): ResolvedTarget {
  // Try as number first
  const num = parseInt(arg, 10);
  if (!isNaN(num) && num >= 1 && num <= backends.length) {
    const b = backends[num - 1];
    return { type: 'backend', backendId: b!.id, backendName: b!.name };
  }

  // Fall back to name resolution (without "clawscale" as valid target)
  const target = arg.toLowerCase();

  const exact = backends.find((b) => b.name.toLowerCase() === target);
  if (exact) {
    return { type: 'backend', backendId: exact.id, backendName: exact.name };
  }

  const aliasMatch = backends.find((b) => {
    const cfg = (b.config ?? {}) as { commandAlias?: string };
    return cfg.commandAlias?.toLowerCase() === target;
  });
  if (aliasMatch) {
    return { type: 'backend', backendId: aliasMatch.id, backendName: aliasMatch.name };
  }

  const prefixMatches = backends.filter((b) => b.name.toLowerCase().startsWith(target));
  if (prefixMatches.length === 1) {
    return { type: 'backend', backendId: prefixMatches[0]!.id, backendName: prefixMatches[0]!.name };
  }

  return { type: 'not_found' };
}
