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
}

