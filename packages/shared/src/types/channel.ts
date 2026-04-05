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
