'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';

/* ─── Types ─── */

interface ChannelInfo {
  id: string;
  type: string;
  name: string;
  connectUrl: string | null;
  phoneNumber: string | null;
  botUsername: string | null;
}

interface UserProvisionedType {
  type: string;
  label: string;
}

interface OnboardBranding {
  headline?: string;
  subtitle?: string;
  logoUrl?: string;
  accentColor?: string;
}

interface OnboardData {
  tenantName: string;
  branding: OnboardBranding;
  channels: ChannelInfo[];
  userProvisionedTypes: UserProvisionedType[];
}

/* ─── Channel metadata ─── */

const CHANNEL_META: Record<string, { label: string; icon: string; color: string; connectLabel: string }> = {
  discord:          { label: 'Discord',            icon: '💬', color: '#5865F2', connectLabel: 'Add to Discord' },
  whatsapp:         { label: 'WhatsApp',           icon: '📱', color: '#25D366', connectLabel: 'Open WhatsApp' },
  whatsapp_business:{ label: 'WhatsApp Business',  icon: '📱', color: '#25D366', connectLabel: 'Chat on WhatsApp' },
  telegram:         { label: 'Telegram',           icon: '✈️', color: '#2AABEE', connectLabel: 'Open in Telegram' },
  slack:            { label: 'Slack',              icon: '💼', color: '#4A154B', connectLabel: 'Add to Slack' },
  line:             { label: 'LINE',               icon: '🟢', color: '#00B900', connectLabel: 'Add on LINE' },
  signal:           { label: 'Signal',             icon: '🔒', color: '#3A76F0', connectLabel: 'Open Signal' },
  teams:            { label: 'Microsoft Teams',    icon: '🟣', color: '#6264A7', connectLabel: 'Add to Teams' },
  matrix:           { label: 'Matrix',             icon: '🔗', color: '#0DBD8B', connectLabel: 'Join Room' },
  web:              { label: 'Web Chat',           icon: '🌐', color: '#00C9A7', connectLabel: 'Open Web Chat' },
  wechat_work:      { label: 'WeChat Work',        icon: '💬', color: '#07C160', connectLabel: 'Open WeCom' },
  wechat_personal:  { label: 'WeChat',             icon: '💬', color: '#07C160', connectLabel: 'Scan QR Code' },
  instagram:        { label: 'Instagram',          icon: '📷', color: '#E1306C', connectLabel: 'Message on Instagram' },
  facebook:         { label: 'Facebook Messenger',  icon: '💙', color: '#0084FF', connectLabel: 'Open Messenger' },
};

function getMeta(type: string) {
  return CHANNEL_META[type] ?? { label: type, icon: '💬', color: '#6B7280', connectLabel: 'Connect' };
}

/** Build self-service instructions based on what info is available */
function getInstructions(channel: ChannelInfo): string {
  const type = channel.type;
  const hasUrl = !!channel.connectUrl;
  const hasPhone = !!channel.phoneNumber;
  const hasBot = !!channel.botUsername;

  switch (type) {
    case 'whatsapp':
    case 'whatsapp_business':
      if (hasPhone) return `Save ${channel.phoneNumber} to your contacts and send a message on WhatsApp to start chatting.`;
      if (hasUrl) return 'Tap below to open a WhatsApp conversation.';
      return 'Send a message to our WhatsApp number to start chatting.';
    case 'telegram':
      if (hasBot) return `Search for @${channel.botUsername} on Telegram and tap Start.`;
      if (hasUrl) return 'Tap below to open a chat with the bot in Telegram.';
      return 'Search for our bot on Telegram and tap Start to begin.';
    case 'discord':
      if (hasUrl) return 'Click below to invite the bot to your Discord server.';
      return 'Invite the bot to your Discord server and send it a message in any channel.';
    case 'slack':
      if (hasUrl) return 'Click below to install the app in your Slack workspace.';
      return 'Install the app in your Slack workspace, then message the bot directly.';
    case 'signal':
      if (hasPhone) return `Message ${channel.phoneNumber} on Signal to start chatting.`;
      return 'Message our Signal number to start chatting.';
    case 'line':
      if (hasUrl) return 'Tap below to add the bot as a friend on LINE.';
      return 'Add the bot as a friend on LINE to start chatting.';
    case 'teams':
      if (hasUrl) return 'Click below to add the bot to Microsoft Teams.';
      return 'Add the bot to Microsoft Teams to start chatting.';
    case 'matrix':
      if (hasUrl) return 'Click below to join the Matrix room.';
      return 'Join our Matrix room to start chatting.';
    case 'web':
      if (hasUrl) return 'Click below to open the chat in your browser.';
      return 'Chat directly from your browser — no app install needed.';
    case 'wechat_personal':
      return 'Scan the QR code with your WeChat app to connect.';
    case 'wechat_work':
      if (hasUrl) return 'Click below to connect via WeChat Work (WeCom).';
      return 'Connect via WeChat Work (WeCom) to start chatting.';
    case 'instagram':
      if (hasBot) return `Send a DM to @${channel.botUsername} on Instagram.`;
      if (hasUrl) return 'Tap below to send a message on Instagram.';
      return 'Send us a direct message on Instagram to start chatting.';
    case 'facebook':
      if (hasUrl) return 'Tap below to start a conversation on Messenger.';
      return 'Send us a message on Facebook Messenger to start chatting.';
    default:
      if (hasUrl) return 'Click below to connect.';
      return 'Connect using this channel to start chatting.';
  }
}

/* ─── Admin-provisioned channel card ─── */

function ChannelCard({ channel, accent }: { channel: ChannelInfo; accent: string }) {
  const meta = getMeta(channel.type);
  const instructions = getInstructions(channel);
  const hasConnect = !!channel.connectUrl;
  const hasPhone = !!channel.phoneNumber;
  const hasBot = !!channel.botUsername;

  return (
    <div className="group rounded-2xl border border-gray-100 bg-white shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
      <div className="h-1" style={{ background: meta.color }} />
      <div className="p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ background: `${meta.color}15` }}>
            {meta.icon}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 text-base truncate">{channel.name || meta.label}</h3>
            <span className="text-xs text-gray-400">{meta.label}</span>
          </div>
        </div>
        <p className="text-sm text-gray-500 leading-relaxed mb-5">{instructions}</p>
        {hasPhone && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-100 px-4 py-3">
            <span className="text-gray-400 text-sm">Number:</span>
            <span className="font-mono text-sm font-medium text-gray-800 select-all">{channel.phoneNumber}</span>
          </div>
        )}
        {hasBot && !hasPhone && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-100 px-4 py-3">
            <span className="text-gray-400 text-sm">Username:</span>
            <span className="font-mono text-sm font-medium text-gray-800 select-all">@{channel.botUsername}</span>
          </div>
        )}
        {hasConnect && (
          <a
            href={channel.connectUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 hover:scale-[1.01] active:scale-[0.99]"
            style={{ background: accent }}
          >
            {meta.connectLabel}
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </a>
        )}
      </div>
    </div>
  );
}

/* ─── QR self-service card ─── */

function QrConnectCard({ type, label, accent, apiBase, onConnected }: {
  type: string;
  label: string;
  accent: string;
  apiBase: string;
  onConnected: () => void;
}) {
  const meta = getMeta(type);
  const [state, setState] = useState<'idle' | 'loading' | 'qr' | 'connected' | 'error'>('idle');
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  async function startConnect() {
    setState('loading');
    setErrorMsg('');
    try {
      const res = await fetch(`${apiBase}/api/onboard/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const result = await res.json();
      if (!res.ok || !result.ok) {
        setErrorMsg(result.error ?? 'Failed to start connection');
        setState('error');
        return;
      }
      if (result.data.status === 'connected') {
        setState('connected');
        onConnected();
        return;
      }
      // Start polling for QR
      const channelId = result.data.channelId;
      pollForQr(channelId);
    } catch {
      setErrorMsg('Failed to connect. Please try again.');
      setState('error');
    }
  }

  function pollForQr(channelId: string) {
    setState('qr');
    const poll = async () => {
      try {
        const res = await fetch(`${apiBase}/api/onboard/qr/${channelId}`);
        const result = await res.json();
        if (result.ok && result.data) {
          if (result.data.status === 'connected') {
            stopPolling();
            setState('connected');
            onConnected();
            return;
          }
          if (result.data.qr) {
            setQrImage(result.data.qr);
          }
        }
      } catch { /* keep polling */ }
    };
    poll();
    pollRef.current = setInterval(poll, 3000);
  }

  return (
    <div className="group rounded-2xl border border-gray-100 bg-white shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
      <div className="h-1" style={{ background: meta.color }} />
      <div className="p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ background: `${meta.color}15` }}>
            {meta.icon}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 text-base truncate">{label}</h3>
            <span className="text-xs text-gray-400">{meta.label}</span>
          </div>
        </div>

        {state === 'idle' && (
          <>
            <p className="text-sm text-gray-500 leading-relaxed mb-5">
              {type === 'whatsapp'
                ? 'Connect your WhatsApp by scanning a QR code with your phone.'
                : 'Connect your WeChat by scanning a QR code with the WeChat app.'}
            </p>
            <button
              onClick={startConnect}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-white transition-all duration-200 hover:opacity-90 hover:scale-[1.01] active:scale-[0.99]"
              style={{ background: accent }}
            >
              Scan QR Code
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 14.625v6m3-3h-6" />
              </svg>
            </button>
          </>
        )}

        {state === 'loading' && (
          <div className="flex flex-col items-center py-6">
            <div className="w-6 h-6 rounded-full border-2 border-teal-500 border-t-transparent animate-spin mb-3" />
            <p className="text-sm text-gray-500">Generating QR code...</p>
          </div>
        )}

        {state === 'qr' && (
          <div className="flex flex-col items-center">
            {qrImage ? (
              <img src={qrImage} alt="Scan this QR code" className="w-48 h-48 rounded-xl border border-gray-100 mb-3" />
            ) : (
              <div className="w-48 h-48 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center mb-3">
                <div className="w-6 h-6 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
              </div>
            )}
            <p className="text-sm text-gray-500 text-center">
              {type === 'whatsapp'
                ? 'Open WhatsApp on your phone → Linked Devices → Scan this code'
                : 'Open WeChat on your phone → Scan this code'}
            </p>
          </div>
        )}

        {state === 'connected' && (
          <div className="flex flex-col items-center py-6">
            <div className="w-12 h-12 rounded-full bg-teal-50 flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-teal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <p className="text-sm font-medium text-teal-700">Connected!</p>
            <p className="text-xs text-gray-400 mt-1">You can now send messages.</p>
          </div>
        )}

        {state === 'error' && (
          <div className="text-center py-4">
            <p className="text-sm text-red-600 mb-3">{errorMsg}</p>
            <button
              onClick={() => { setState('idle'); setErrorMsg(''); }}
              className="text-sm text-teal-600 hover:underline font-medium"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Main page ─── */

export default function OnboardPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
          <p className="text-gray-500">Loading channels...</p>
        </div>
      </div>
    }>
      <OnboardContent />
    </Suspense>
  );
}

function OnboardContent() {
  const params = useSearchParams();
  const palmosUserId = params.get('palmosUserId');
  const selectedChannel = params.get('channel');

  const [data, setData] = useState<OnboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apiBase = process.env['NEXT_PUBLIC_API_URL'] ?? '';

  const loadData = useCallback(() => {
    fetch(`${apiBase}/api/onboard/channels`)
      .then((res) => res.json())
      .then((result) => {
        if (result.error) setError(result.error);
        else setData(result);
      })
      .catch(() => setError('Failed to load channels'))
      .finally(() => setLoading(false));
  }, [apiBase]);

  useEffect(() => { loadData(); }, [loadData]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded-full border-2 border-teal-500 border-t-transparent animate-spin" />
          <p className="text-gray-500">Loading channels...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 max-w-md text-center">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Unable to load</h1>
          <p className="text-gray-500 text-sm">{error ?? 'Something went wrong. Please try again later.'}</p>
        </div>
      </div>
    );
  }

  const branding = data.branding ?? {};
  const accent = branding.accentColor || '#00C9A7';
  const logoUrl = branding.logoUrl || '/logo.png';
  const headline = branding.headline || `Connect to ${data.tenantName}`;
  const subtitle = branding.subtitle || (selectedChannel
    ? `Set up ${getMeta(selectedChannel).label} to start chatting.`
    : 'Choose a messaging platform to connect with your AI assistant.');

  // Only admin-provisioned connected channels (exclude self-service types — those use QR cards)
  const USER_PROVISIONED = new Set(['whatsapp', 'wechat_personal']);
  const connectedChannels = data.channels
    .filter((ch) => !USER_PROVISIONED.has(ch.type))
    .filter((ch) => !selectedChannel || ch.type === selectedChannel);

  // Self-service channels — always available, each user creates their own connection
  const selfServiceTypes = (data.userProvisionedTypes ?? [])
    .filter((up) => !selectedChannel || up.type === selectedChannel);

  const hasAny = connectedChannels.length > 0 || selfServiceTypes.length > 0;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ── Header ── */}
      <header className="pt-12 pb-8 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <div className="mb-5 flex justify-center">
            <img src={logoUrl} alt={data.tenantName} className="w-14 h-14 rounded-2xl shadow-sm object-cover" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight mb-2">{headline}</h1>
          <p className="text-gray-500 text-base max-w-md mx-auto leading-relaxed">{subtitle}</p>
          {palmosUserId && (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-teal-50 border border-teal-100 px-3 py-1">
              <div className="w-1.5 h-1.5 rounded-full bg-teal-500" />
              <span className="text-xs text-teal-700 font-medium">Account linked</span>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 px-4 pb-12">
        <div className="max-w-2xl mx-auto">
          {hasAny ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {connectedChannels.map((ch) => (
                <ChannelCard key={ch.id} channel={ch} accent={accent} />
              ))}
              {selfServiceTypes.map((up) => (
                <QrConnectCard
                  key={up.type}
                  type={up.type}
                  label={up.label}
                  accent={accent}
                  apiBase={apiBase}
                  onConnected={loadData}
                />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center">
              <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">📡</span>
              </div>
              <h2 className="font-semibold text-gray-900 mb-2">No channels available yet</h2>
              <p className="text-gray-500 text-sm max-w-xs mx-auto">Check back soon!</p>
            </div>
          )}
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="py-6 text-center">
        <a
          href="https://clawscale.org"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-500 transition-colors"
        >
          Powered by
          <span className="font-semibold" style={{ color: accent }}>ClawScale</span>
        </a>
      </footer>
    </div>
  );
}
