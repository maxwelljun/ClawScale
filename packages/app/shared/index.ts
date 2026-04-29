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
      { key: 'baseUrl', label: 'Base URL', hint: 'Optional fallback. By default ClawScale starts an isolated Docker runtime per end-user.' },
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
  name: string;
  type: AiBackendType;
  config: AiBackendProviderConfig;
  isActive: boolean;
  /** True for the built-in ClawScale default agent (one per tenant). */
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

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
  createdAt: string;
  updatedAt: string;
  endUser?: Pick<EndUser, 'id' | 'externalId' | 'name' | 'email' | 'status'>;
  channel?: { id: string; name: string; type: string };
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
