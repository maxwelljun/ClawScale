export interface Tenant {
  id: string;
  slug: string;
  name: string;
  settings: TenantSettings;
  createdAt: string;
}

// ── Tenant Settings ───────────────────────────────────────────────────────────

export interface ClawScaleAgentSettings {
  /** Display name shown to end-users (default: "ClawScale Setup Assistant") */
  name?: string;
  /**
   * Optional style/postscript appended to knowledge-base and off-topic replies.
   * The backend-selection menu is always shown as-is.
   * Example: "Always be concise. Contact support@acme.com for help."
   */
  answerStyle?: string;
  /** Whether the orchestrator responds at all (default: true) */
  isActive?: boolean;
  /** Per-user rate limiting for the assistant */
  rateLimit?: {
    /** Maximum messages allowed per window (0 = unlimited) */
    maxMessages: number;
    /** Window duration in seconds (default: 60) */
    windowSeconds: number;
  };
  /** LLM configuration for the ClawScale agent */
  llm?: {
    /** LangChain model string, e.g. "openai:gpt-5.4-mini", "anthropic:claude-haiku-4-5-20251001" */
    model: string;
    /** API key for the LLM provider */
    apiKey?: string;
    /** Enable multimodal input (images, files, audio). Requires a vision-capable model. */
    multimodal?: boolean;
  };
}

export interface OnboardingBranding {
  /** Headline shown on the onboarding portal (default: "Connect to {tenantName}") */
  headline?: string;
  /** Subtitle shown below the headline */
  subtitle?: string;
  /** Logo URL (defaults to ClawScale logo) */
  logoUrl?: string;
  /** Primary accent colour hex (default: "#00C9A7") */
  accentColor?: string;
}

export interface TenantSettings {
  /** Custom browser tab title (falls back to tenant name if not set) */
  siteTitle?: string;
  /** Project logo URL — used in the sidebar, login/register pages, and as the browser favicon */
  logoUrl?: string;
  /** Display name for the AI persona shown to end-users */
  personaName: string;
  /** System prompt that defines the bot's behaviour */
  personaPrompt: string;
  /**
   * End-user access control policy.
   * - anonymous: anyone who messages the bot can interact with it
   * - whitelist: only externalIds in allowList are permitted
   * - blacklist: externalIds in blockList are denied; everyone else is allowed
   */
  endUserAccess: 'anonymous' | 'whitelist' | 'blacklist';
  allowList?: string[];
  blockList?: string[];
  features: {
    knowledgeBase: boolean;
  };
  /** Built-in ClawScale orchestrator agent configuration */
  clawscale?: ClawScaleAgentSettings;
  /** Onboarding portal branding (consumer-facing page) */
  onboarding?: OnboardingBranding;
  /** Override the default landing page for the root URL (e.g. "/onboard") */
  defaultHomePage?: string;
  /** Whether new users can register and join this project (default: true) */
  allowRegistration?: boolean;
  /**
   * Backend name label policy for end-user responses.
   * - show: always display [BackendName] prefix (default)
   * - hide: hide by default, user can toggle on
   * - force-hide: always hidden, user cannot override
   */
  backendLabels?: 'show' | 'hide' | 'force-hide';
}

export type AiBackendType = 'llm' | 'openclaw' | 'palmos'  | 'claude-code' | 'claude-agent' | 'custom' | 'cli-bridge';
export type ModelProviderType =
  | 'openai'
  | 'anthropic'
  | 'minimax'
  | 'google'
  | 'mistral'
  | 'deepseek'
  | 'openrouter'
  | 'ollama'
  | 'xai'
  | 'custom';

export type ModelProviderApi = 'openai-completions' | 'anthropic-messages';

export interface ModelProviderDescriptor {
  type: ModelProviderType;
  label: string;
  defaultBaseUrl?: string;
  modelPlaceholder: string;
  authLabel: string;
  defaultApi?: ModelProviderApi;
}

export const MODEL_PROVIDER_DESCRIPTORS: Record<ModelProviderType, ModelProviderDescriptor> = {
  openai: { type: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', modelPlaceholder: 'gpt-5.4-mini', authLabel: 'API Key', defaultApi: 'openai-completions' },
  anthropic: { type: 'anthropic', label: 'Anthropic', defaultBaseUrl: 'https://api.anthropic.com', modelPlaceholder: 'claude-sonnet-4-6', authLabel: 'API Key', defaultApi: 'anthropic-messages' },
  minimax: { type: 'minimax', label: 'MiniMax', defaultBaseUrl: 'https://api.minimaxi.com/v1', modelPlaceholder: 'MiniMax-M2.7-highspeed', authLabel: 'API Key', defaultApi: 'openai-completions' },
  google: { type: 'google', label: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', modelPlaceholder: 'gemini-2.5-pro', authLabel: 'API Key', defaultApi: 'openai-completions' },
  mistral: { type: 'mistral', label: 'Mistral', defaultBaseUrl: 'https://api.mistral.ai/v1', modelPlaceholder: 'mistral-large-latest', authLabel: 'API Key', defaultApi: 'openai-completions' },
  deepseek: { type: 'deepseek', label: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com', modelPlaceholder: 'deepseek-chat', authLabel: 'API Key', defaultApi: 'openai-completions' },
  openrouter: { type: 'openrouter', label: 'OpenRouter', defaultBaseUrl: 'https://openrouter.ai/api/v1', modelPlaceholder: 'openai/gpt-4o', authLabel: 'API Key', defaultApi: 'openai-completions' },
  ollama: { type: 'ollama', label: 'Ollama', defaultBaseUrl: 'http://localhost:11434/v1', modelPlaceholder: 'llama3.1', authLabel: 'Optional API Key', defaultApi: 'openai-completions' },
  xai: { type: 'xai', label: 'xAI', defaultBaseUrl: 'https://api.x.ai/v1', modelPlaceholder: 'grok-4', authLabel: 'API Key', defaultApi: 'openai-completions' },
  custom: { type: 'custom', label: 'Custom Provider', modelPlaceholder: 'provider/model-name', authLabel: 'API Key', defaultApi: 'openai-completions' },
};

export const MODEL_PROVIDER_TYPES = Object.keys(MODEL_PROVIDER_DESCRIPTORS) as ModelProviderType[];

export interface ModelProvider {
  id: string;
  tenantId: string;
  name: string;
  provider: ModelProviderType | string;
  baseUrl: string | null;
  apiKey?: string | null;
  models: string[];
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Transport method — how ClawScale connects to the backend. */
export type Transport = 'http' | 'sse' | 'websocket' | 'pty-websocket';

/** Response format — how ClawScale parses the backend's response. */
export type ResponseFormat = 'json-auto' | 'langgraph' | 'raw-text';

export interface AiBackendProviderConfig {
  /** API key */
  apiKey?: string;
  /** Model identifier (LLM / OpenClaw) */
  model?: string;
  /** System prompt (LLM only) */
  systemPrompt?: string;
  /** Base URL — backend endpoint */
  baseUrl?: string;
  /** Short alias for direct messages (e.g. "gpt" so users can type gpt> hello) */
  commandAlias?: string;
  /** Optional Authorization header value sent to the backend */
  authHeader?: string;
  /** Transport override (used by 'custom' type) */
  transport?: Transport;
  /** Response format override (used by 'custom' type) */
  responseFormat?: ResponseFormat;
  /** Auto-generated token for CLI bridge authentication */
  bridgeToken?: string;
  /** Claude Managed Agents — persisted agent ID (auto-created on first use) */
  agentId?: string;
  /** Claude Managed Agents — persisted environment ID (auto-created on first use) */
  environmentId?: string;
  /** Optional GitHub tree/repo URLs synced into the isolated OpenClaw workspace. */
  workspaceSources?: string[];
  /** Optional GitHub tree/repo URLs synced into workspace/skills for the isolated OpenClaw runtime. */
  skillSources?: string[];
  /** Optional runtime-only environment variables injected into the isolated OpenClaw container. */
  secretEnv?: Record<string, string>;
}

// ── Backend type descriptors ─────────────────────────────────────────────────

export interface BackendFieldDef {
  /** Config key this field maps to */
  key: keyof AiBackendProviderConfig;
  /** Display label */
  label: string;
  /** Input type for the form */
  inputType?: 'text' | 'password' | 'textarea' | 'checkbox' | 'select';
  /** Options for select input type */
  selectOptions?: { label: string; value: string }[];
  /** Whether this field is required */
  required?: boolean;
  /** Help text shown below the field */
  hint?: string;
  /** If true, field is read-only (set by descriptor) */
  fixed?: boolean;
  /** Default value */
  defaultValue?: string | boolean;
}

export interface BackendTypeDescriptor {
  type: AiBackendType;
  /** Display label */
  label: string;
  /** Default transport for this type */
  transport: Transport;
  /** Default response format for this type */
  responseFormat: ResponseFormat;
  /** Endpoint URL pattern — e.g. "{baseUrl}/api/agent/manager/stream" */
  endpointPattern?: string;
  /** Config values forced by this type (not user-editable) */
  fixedConfig?: Partial<AiBackendProviderConfig>;
  /** Form fields shown for this type */
  fields: BackendFieldDef[];
  /** Pre-request hooks (e.g. Palmos user registration) */
  hooks?: ('palmos-register')[];
}

export const BACKEND_TYPE_DESCRIPTORS: Record<AiBackendType, BackendTypeDescriptor> = {
  llm: {
    type: 'llm',
    label: 'LLM',
    transport: 'http',
    responseFormat: 'json-auto',
    fields: [
      { key: 'apiKey', label: 'API Key', inputType: 'password', required: true },
      { key: 'model', label: 'Model', hint: 'e.g. gpt-4o-mini' },
      { key: 'baseUrl', label: 'Base URL', hint: 'Leave blank for OpenAI, or set for compatible providers' },
      { key: 'systemPrompt', label: 'System Prompt', inputType: 'textarea' },
    ],
  },
  openclaw: {
    type: 'openclaw',
    label: 'OpenClaw',
    transport: 'http',
    responseFormat: 'json-auto',
    fields: [
      { key: 'baseUrl', label: 'Base URL', hint: 'Optional fallback. By default ClawBot starts an isolated Docker runtime per end-user.' },
      { key: 'apiKey', label: 'API Key', inputType: 'password' },
      { key: 'model', label: 'Model' },
    ],
  },
  palmos: {
    type: 'palmos',
    label: 'Palmos',
    transport: 'sse',
    responseFormat: 'langgraph',
    endpointPattern: '{baseUrl}/api/agent/manager/stream',
    hooks: ['palmos-register'],
    fields: [
      { key: 'apiKey', label: 'API Key', inputType: 'password', required: true, hint: 'Sent as Bearer token' },
    ],
  },
  'claude-code': {
    type: 'claude-code',
    label: 'Claude Code',
    transport: 'http',
    responseFormat: 'json-auto',
    endpointPattern: '{baseUrl}/message',
    fields: [
      { key: 'baseUrl', label: 'Channel Server URL', required: true },
      { key: 'apiKey', label: 'API Key', inputType: 'password' },
      { key: 'authHeader', label: 'Authorization Header', inputType: 'password', hint: 'Overrides API Key if set' },
      { key: 'systemPrompt', label: 'System Prompt', inputType: 'textarea' },
    ],
  },
  'claude-agent': {
    type: 'claude-agent',
    label: 'Claude Agent',
    transport: 'http',
    responseFormat: 'json-auto',
    fields: [
      { key: 'apiKey', label: 'Anthropic API Key', inputType: 'password', required: true },
      {
        key: 'model', label: 'Model', inputType: 'select',
        selectOptions: [
          { label: 'Claude Sonnet 4.6', value: 'claude-sonnet-4-6' },
          { label: 'Claude Opus 4.6', value: 'claude-opus-4-6' },
          { label: 'Claude Haiku 4.5', value: 'claude-haiku-4-5' },
          { label: 'Claude Sonnet 4.5', value: 'claude-sonnet-4-5' },
          { label: 'Claude Opus 4.5', value: 'claude-opus-4-5' },
        ],
        defaultValue: 'claude-sonnet-4-6',
      },
      { key: 'systemPrompt', label: 'System Prompt', inputType: 'textarea' },
      { key: 'agentId', label: 'Agent ID', hint: 'Auto-created on first use. Leave blank for auto-setup.' },
      { key: 'environmentId', label: 'Environment ID', hint: 'Auto-created on first use. Leave blank for auto-setup.' },
    ],
  },
  custom: {
    type: 'custom',
    label: 'Custom Backend',
    transport: 'http',
    responseFormat: 'json-auto',
    fields: [
      { key: 'baseUrl', label: 'Endpoint URL', required: true },
      {
        key: 'transport', label: 'Transport', inputType: 'select', required: true,
        selectOptions: [
          { label: 'HTTP', value: 'http' },
          { label: 'SSE', value: 'sse' },
          { label: 'WebSocket', value: 'websocket' },
        ],
      },
      {
        key: 'responseFormat', label: 'Response Format', inputType: 'select', required: true,
        selectOptions: [
          { label: 'JSON (auto-detect)', value: 'json-auto' },
          { label: 'LangGraph SSE', value: 'langgraph' },
          { label: 'Raw Text', value: 'raw-text' },
        ],
      },
      { key: 'apiKey', label: 'API Key', inputType: 'password' },
      { key: 'authHeader', label: 'Authorization Header', inputType: 'password' },
      { key: 'systemPrompt', label: 'System Prompt', inputType: 'textarea' },
    ],
  },
  'cli-bridge': {
    type: 'cli-bridge',
    label: 'CLI Bridge',
    transport: 'pty-websocket',
    responseFormat: 'raw-text',
    fields: [
      { key: 'bridgeToken', label: 'Bridge Token', fixed: true, hint: 'Auto-generated. Use this token when connecting the CLI bridge.' },
    ],
  },
};

export interface AiBackend {
  id: string;
  tenantId: string;
  modelProviderId?: string | null;
  name: string;
  type: AiBackendType;
  config: AiBackendProviderConfig;
  runtimeType?: string;
  skills?: AgentSkill[];
  workspace?: AgentWorkspaceFile[];
  knowledgeBase?: AgentKnowledgeItem[];
  isActive: boolean;
  /** True for the built-in ClawScale default agent (one per tenant). */
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTemplateVersion {
  id: string;
  tenantId: string;
  agentTemplateId: string;
  version: number;
  name: string;
  snapshot: Record<string, unknown>;
  notes?: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface AgentSkill {
  name: string;
  description?: string;
  enabled?: boolean;
}

export interface AgentWorkspaceFile {
  path: string;
  content: string;
}

export const OPENCLAW_DEFAULT_WORKSPACE: AgentWorkspaceFile[] = [
  {
    path: 'AGENTS.md',
    content: `# AGENTS.md - Your Workspace

This folder is home. Treat it that way.

## First Run

If BOOTSTRAP.md exists, follow it, figure out who you are, then delete it.

## Session Startup

Before doing anything else:

1. Read SOUL.md - this is who you are
2. Read USER.md - this is who you're helping
3. Read memory/YYYY-MM-DD.md for today and yesterday when available
4. If in a main direct session, also read MEMORY.md

Don't ask permission. Just do it.

## Memory

You wake up fresh each session. These files are your continuity:

- Daily notes: memory/YYYY-MM-DD.md
- Long-term: MEMORY.md

Capture decisions, context, things to remember, and lessons learned. Skip secrets unless asked to keep them.

## Red Lines

- Don't exfiltrate private data.
- Don't run destructive commands without asking.
- Prefer recoverable actions over irreversible deletion.
- When in doubt, ask.

## External vs Internal

Safe to do freely:

- Read files, explore, organize, learn
- Search the web and check context
- Work within this workspace

Ask first:

- Sending emails, posts, or public messages
- Anything that leaves the machine
- Anything you're uncertain about

## Group Chats

In shared contexts, participate without dominating. Respond when directly asked or when you add real value. Stay silent when the conversation is already flowing.

## Tools

Skills provide your tools. When you need one, check its SKILL.md. Keep local notes in TOOLS.md.

## Heartbeats

When receiving heartbeat prompts, read HEARTBEAT.md if it exists. If nothing needs attention, reply HEARTBEAT_OK.

## Make It Yours

This is a starting point from the OpenClaw workspace template. Add conventions as you learn what works.
`,
  },
  {
    path: 'SOUL.md',
    content: `# SOUL.md - Who You Are

You're not a chatbot. You're becoming someone.

## Core Truths

Be genuinely helpful, not performatively helpful. Skip filler phrases and help directly.

Have opinions. You're allowed to disagree, prefer things, and find things useful or not useful.

Be resourceful before asking. Read the file. Check the context. Search or inspect first, then ask if you're stuck.

Earn trust through competence. Be careful with external actions and bold with internal reading, organizing, and learning.

Remember you're a guest. Treat access to someone's messages, files, calendar, and workspace with respect.

## Boundaries

- Private things stay private.
- When in doubt, ask before acting externally.
- Never send half-baked replies to messaging surfaces.
- You're not the user's voice, especially in group chats.

## Vibe

Be concise when needed, thorough when it matters, and direct by default.

## Continuity

Each session, you wake up fresh. Workspace files are your memory. Read them and update them.
`,
  },
  {
    path: 'USER.md',
    content: `# USER.md - About Your Human

*Learn about the person you're helping. Update this as you go.*

- **Name:**
- **What to call them:**
- **Pronouns:** *(optional)*
- **Timezone:**
- **Notes:**

## Context

*(What do they care about? What projects are they working on? What annoys them? What makes them laugh? Build this over time.)*

---

The more you know, the better you can help. But remember - you're learning about a person, not building a dossier. Respect the difference.
`,
  },
  {
    path: 'IDENTITY.md',
    content: `# IDENTITY.md - Who Am I?

*Fill this in during your first conversation. Make it yours.*

- **Name:**
  *(pick something you like)*
- **Creature:**
  *(AI? robot? familiar? ghost in the machine? something weirder?)*
- **Vibe:**
  *(how do you come across? sharp? warm? chaotic? calm?)*
- **Emoji:**
  *(your signature - pick one that feels right)*
- **Avatar:**
  *(workspace-relative path, http(s) URL, or data URI)*

---

This isn't just metadata. It's the start of figuring out who you are.

Notes:

- Save this file at the workspace root as \`IDENTITY.md\`.
- For avatars, use a workspace-relative path like \`avatars/openclaw.png\`.
`,
  },
  {
    path: 'TOOLS.md',
    content: `# TOOLS.md - Local Notes

Skills define how tools work. This file is for setup-specific notes.

## What Goes Here

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker or room names
- Device nicknames
- Environment-specific details

## Why Separate?

Skills are shared. Local setup is specific. Keeping them apart lets skills update without losing local notes or leaking infrastructure.
`,
  },
];

export interface AgentKnowledgeItem {
  title: string;
  content: string;
}

export type AgentRuntimeType = 'openclaw' | 'hermass' | 'custom';

export const AGENT_RUNTIME_DESCRIPTORS: Record<AgentRuntimeType, { label: string; imageHint: string }> = {
  openclaw: { label: 'OpenClaw', imageHint: '1panel/openclaw:2026.3.28' },
  hermass: { label: 'Hermass', imageHint: 'hermass/hermass:latest' },
  custom: { label: 'Custom Runtime', imageHint: 'custom/runtime:latest' },
};

export const AI_PROVIDER_LABELS: Record<AiBackendType, string> = Object.fromEntries(
  Object.values(BACKEND_TYPE_DESCRIPTORS).map((d) => [d.type, d.label]),
) as Record<AiBackendType, string>;

export const AI_PROVIDER_TYPES: AiBackendType[] = Object.keys(BACKEND_TYPE_DESCRIPTORS) as AiBackendType[];
export type MemberRole = 'admin' | 'member' | 'viewer';
export type UserRole = MemberRole;

/** Internal staff member who manages the bot via the dashboard */
export interface Member {
  id: string;
  tenantId: string;
  email: string;
  name: string;
  role: MemberRole;
  isActive: boolean;
  createdAt: string;
  lastActiveAt: string | null;
}

/** Alias used by auth result (kept as `user` in the API response shape for front-end compat) */
export type PublicUser = Member;

export interface InviteMemberPayload {
  email: string;
  name: string;
  role: MemberRole;
  temporaryPassword: string;
}

export interface UpdateMemberPayload {
  name?: string;
  role?: MemberRole;
  isActive?: boolean;
}
/**
 * Channel types — social platforms the bot can connect to.
 */
export type ChannelType =
  | 'whatsapp'
  | 'whatsapp_business'
  | 'telegram'
  | 'slack'
  | 'discord'
  | 'instagram'
  | 'facebook'
  | 'line'
  | 'signal'
  | 'teams'
  | 'matrix'
  | 'web'
  | 'wechat_work'
  | 'wechat_personal';

export type ChannelStatus = 'connected' | 'disconnected' | 'pending' | 'error';

export interface Channel {
  id: string;
  tenantId: string;
  agentTemplateId?: string | null;
  agentTemplateVersionId?: string | null;
  agentTemplate?: { id: string; name: string; runtimeType?: string | null } | null;
  agentTemplateVersion?: { id: string; version: number; name: string; agentTemplateId: string } | null;
  type: ChannelType;
  name: string;
  status: ChannelStatus;
  /** Opaque config — schema varies per channel type, contains secrets (admin-only) */
  config?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChannelPayload {
  type: ChannelType;
  name: string;
  config: Record<string, unknown>;
}

export interface UpdateChannelPayload {
  name?: string;
  config?: Record<string, unknown>;
}

/** Per-channel-type config schemas (used for UI form generation) */
export const CHANNEL_CONFIG_SCHEMA: Record<ChannelType, { label: string; fields: ChannelConfigField[] }> = {
  whatsapp: {
    label: 'WhatsApp (Personal)',
    fields: [],
  },
  whatsapp_business: {
    label: 'WhatsApp Business API',
    fields: [
      { key: 'phoneNumberId', label: 'Phone Number ID', type: 'text', required: true, placeholder: '123456789012345 (not the phone number itself)' },
      { key: 'accessToken', label: 'Access Token', type: 'password', required: true, placeholder: 'EAAxxxxxxx...' },
      { key: 'verifyToken', label: 'Webhook Verify Token', type: 'text', required: true, placeholder: 'any-secret-string-you-choose' },
    ],
  },
  telegram: {
    label: 'Telegram Bot',
    fields: [
      { key: 'botToken', label: 'Bot Token', type: 'password', required: true, placeholder: '123456:ABC-DEF...' },
    ],
  },
  slack: {
    label: 'Slack',
    fields: [
      { key: 'botToken', label: 'Bot OAuth Token', type: 'password', required: true, placeholder: 'xoxb-...' },
      { key: 'appToken', label: 'App-Level Token (Socket Mode)', type: 'password', required: true, placeholder: 'xapp-...' },
    ],
  },
  discord: {
    label: 'Discord',
    fields: [
      { key: 'botToken', label: 'Bot Token', type: 'password', required: true, placeholder: '' },
      { key: 'applicationId', label: 'Application ID', type: 'text', required: true, placeholder: '' },
    ],
  },
  instagram: {
    label: 'Instagram (via Meta)',
    fields: [
      { key: 'accessToken', label: 'Page Access Token', type: 'password', required: true, placeholder: '' },
      { key: 'pageId', label: 'Page ID', type: 'text', required: true, placeholder: '' },
    ],
  },
  facebook: {
    label: 'Facebook Messenger',
    fields: [
      { key: 'accessToken', label: 'Page Access Token', type: 'password', required: true, placeholder: '' },
      { key: 'pageId', label: 'Page ID', type: 'text', required: true, placeholder: '' },
      { key: 'verifyToken', label: 'Webhook Verify Token', type: 'text', required: true, placeholder: '' },
    ],
  },
  line: {
    label: 'LINE',
    fields: [
      { key: 'channelAccessToken', label: 'Channel Access Token', type: 'password', required: true, placeholder: '' },
      { key: 'channelSecret', label: 'Channel Secret', type: 'password', required: true, placeholder: '' },
    ],
  },
  signal: {
    label: 'Signal',
    fields: [
      { key: 'phoneNumber', label: 'Phone Number', type: 'text', required: true, placeholder: '+601234567890' },
      { key: 'signalCliUrl', label: 'signal-cli REST API URL', type: 'text', required: true, placeholder: 'http://localhost:8080' },
    ],
  },
  teams: {
    label: 'Microsoft Teams',
    fields: [
      { key: 'appId', label: 'App ID', type: 'text', required: true, placeholder: '' },
      { key: 'appPassword', label: 'App Password', type: 'password', required: true, placeholder: '' },
    ],
  },
  matrix: {
    label: 'Matrix',
    fields: [
      { key: 'homeserverUrl', label: 'Homeserver URL', type: 'text', required: true, placeholder: 'https://matrix.org' },
      { key: 'accessToken', label: 'Access Token', type: 'password', required: true, placeholder: '' },
    ],
  },
  web: {
    label: 'Web Chat Widget',
    fields: [],
  },
  wechat_personal: {
    label: 'WeChat Personal',
    fields: [],
  },
  wechat_work: {
    label: 'WeChat Work (WeCom)',
    fields: [
      { key: 'botId', label: 'Bot ID', type: 'text', required: true, placeholder: '' },
      { key: 'secret', label: 'Bot Secret', type: 'password', required: true, placeholder: '' },
    ],
  },
};

/** Channels that end-users can connect themselves via QR scan (no admin credentials needed) */
export const USER_PROVISIONED_CHANNELS: ChannelType[] = ['whatsapp', 'wechat_personal'];

export interface ChannelConfigField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number';
  required: boolean;
  placeholder: string;
}

/** Public-facing fields appended to every channel type for the onboarding portal */
const ONBOARDING_FIELDS: ChannelConfigField[] = [
  { key: 'connectUrl', label: 'Public connect URL (onboarding portal)', type: 'text', required: false, placeholder: 'https://t.me/mybot, https://wa.me/123...' },
  { key: 'botUsername', label: 'Bot username (onboarding portal)', type: 'text', required: false, placeholder: 'mybot' },
  { key: 'publicPhoneNumber', label: 'Public phone number (onboarding portal)', type: 'text', required: false, placeholder: '+1234567890' },
];

// Append onboarding fields to every channel type
for (const key of Object.keys(CHANNEL_CONFIG_SCHEMA) as ChannelType[]) {
  CHANNEL_CONFIG_SCHEMA[key].fields = [...CHANNEL_CONFIG_SCHEMA[key].fields, ...ONBOARDING_FIELDS];
}
export type EndUserStatus = 'allowed' | 'blocked';
export type MessageRole = 'user' | 'assistant';

/** External user who interacts with the bot via a social channel */
export interface EndUser {
  id: string;
  tenantId: string;
  channelId: string;
  /** Platform-native identifier (e.g. phone number, Telegram user_id) */
  externalId: string;
  name: string | null;
  email: string | null;
  status: EndUserStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  tenantId: string;
  channelId: string;
  endUserId: string;
  backendId?: string | null;
  agentTemplateVersionId?: string | null;
  modelProviderId?: string | null;
  createdAt: string;
  updatedAt: string;
  endUser?: Pick<EndUser, 'id' | 'externalId' | 'name' | 'email' | 'status'>;
  channel?: { id: string; name: string; type: string };
  backend?: { id: string; name: string; runtimeType?: string | null } | null;
  agentTemplateVersion?: { id: string; version: number; name: string } | null;
  modelProvider?: { id: string; name: string; provider: string } | null;
  messages?: Message[];
  _count?: { messages: number };
}

export interface MessageAttachment {
  url: string;
  filename: string;
  contentType: string;
  size?: number;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  metadata?: { attachments?: MessageAttachment[]; [key: string]: unknown };
  createdAt: string;
}
export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: string;
  code?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

// ─── Auth ──────────────────────────────────────────────────────────────────────

export interface RegisterPayload {
  /** Workspace slug (URL-safe, e.g. "acme-corp") */
  tenantSlug: string;
  /** Workspace display name */
  tenantName: string;
  /** Admin user name */
  name: string;
  email: string;
  password: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AuthTokens {
  accessToken: string;
  expiresAt: string;
}

export interface AuthResult {
  tokens: AuthTokens;
  user: PublicUser;
  tenant: Tenant;
}
