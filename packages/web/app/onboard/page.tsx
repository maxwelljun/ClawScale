'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

/* ─── Types ─── */

interface ChannelInfo {
  id: string;
  type: string;
  name: string;
  connectUrl: string | null;
  phoneNumber: string | null;
  qrAvailable: boolean;
}

interface OnboardBranding {
  headline?: string;
  subtitle?: string;
  logoUrl?: string;
  accentColor?: string;
  hidePoweredBy?: boolean;
}

interface OnboardData {
  tenantName: string;
  branding: OnboardBranding;
  channels: ChannelInfo[];
}

/* ─── Channel metadata ─── */

const CHANNEL_META: Record<string, { label: string; icon: string; color: string; instructions: string; connectLabel: string }> = {
  discord:          { label: 'Discord',           icon: '💬', color: '#5865F2', instructions: 'Click below to add the bot to your Discord server. Once added, send it a message in any channel.',                  connectLabel: 'Add to Discord' },
  whatsapp:         { label: 'WhatsApp',          icon: '📱', color: '#25D366', instructions: 'Save the number below to your contacts and send a message on WhatsApp to start chatting.',                           connectLabel: 'Open WhatsApp' },
  whatsapp_business:{ label: 'WhatsApp Business', icon: '📱', color: '#25D366', instructions: 'Click below to start a conversation on WhatsApp Business.',                                                         connectLabel: 'Chat on WhatsApp' },
  telegram:         { label: 'Telegram',          icon: '✈️', color: '#2AABEE', instructions: 'Click below to open a chat with the bot in Telegram. Hit Start to begin.',                                          connectLabel: 'Open in Telegram' },
  slack:            { label: 'Slack',             icon: '💼', color: '#4A154B', instructions: 'Click below to install the app in your Slack workspace. You can then message the bot directly.',                     connectLabel: 'Add to Slack' },
  line:             { label: 'LINE',              icon: '🟢', color: '#00B900', instructions: 'Click below to add the bot as a friend on LINE.',                                                                   connectLabel: 'Add on LINE' },
  signal:           { label: 'Signal',            icon: '🔒', color: '#3A76F0', instructions: 'Send a message to the number below on Signal to start chatting.',                                                   connectLabel: 'Open Signal' },
  teams:            { label: 'Microsoft Teams',   icon: '🟣', color: '#6264A7', instructions: 'Click below to add the bot to Microsoft Teams.',                                                                    connectLabel: 'Add to Teams' },
  matrix:           { label: 'Matrix',            icon: '🔗', color: '#0DBD8B', instructions: 'Click below to join the Matrix room and start chatting.',                                                           connectLabel: 'Join Room' },
  web:              { label: 'Web Chat',          icon: '🌐', color: '#00C9A7', instructions: 'Click below to open the chat widget in your browser.',                                                              connectLabel: 'Open Web Chat' },
  wechat_work:      { label: 'WeChat Work',       icon: '💬', color: '#07C160', instructions: 'Click below to connect via WeChat Work (WeCom).',                                                                   connectLabel: 'Open WeCom' },
  wechat_personal:  { label: 'WeChat',            icon: '💬', color: '#07C160', instructions: 'Scan the QR code below with WeChat to connect.',                                                                    connectLabel: 'Show QR Code' },
  instagram:        { label: 'Instagram',         icon: '📷', color: '#E1306C', instructions: 'Click below to open a conversation on Instagram.',                                                                  connectLabel: 'Message on Instagram' },
  facebook:         { label: 'Facebook Messenger', icon: '💙', color: '#0084FF', instructions: 'Click below to start a conversation on Messenger.',                                                                connectLabel: 'Open Messenger' },
};

function getMeta(type: string) {
  return CHANNEL_META[type] ?? { label: type, icon: '💬', color: '#6B7280', instructions: 'Follow the link below to connect.', connectLabel: 'Connect' };
}

/* ─── Channel card ─── */

function ChannelCard({ channel, accent }: { channel: ChannelInfo; accent: string }) {
  const meta = getMeta(channel.type);
  const hasConnect = !!channel.connectUrl;
  const hasPhone = !!channel.phoneNumber;

  return (
    <div className="group rounded-2xl border border-gray-100 bg-white shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden">
      {/* Color accent bar */}
      <div className="h-1" style={{ background: meta.color }} />

      <div className="p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-3">
          <div
            className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shrink-0"
            style={{ background: `${meta.color}15` }}
          >
            {meta.icon}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 text-base truncate">{channel.name || meta.label}</h3>
            <span className="text-xs text-gray-400">{meta.label}</span>
          </div>
        </div>

        {/* Instructions */}
        <p className="text-sm text-gray-500 leading-relaxed mb-5">{meta.instructions}</p>

        {/* Phone number display */}
        {hasPhone && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-gray-50 border border-gray-100 px-4 py-3">
            <span className="text-gray-400 text-sm">Phone:</span>
            <span className="font-mono text-sm font-medium text-gray-800 select-all">{channel.phoneNumber}</span>
          </div>
        )}

        {/* Connect button */}
        {hasConnect ? (
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
        ) : (
          <div className="w-full text-center rounded-xl border-2 border-dashed border-gray-200 px-5 py-3 text-sm text-gray-400">
            Contact your administrator for connection details
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

  useEffect(() => {
    fetch(`${apiBase}/api/onboard/channels`)
      .then((res) => res.json())
      .then((result) => {
        if (result.error) {
          setError(result.error);
        } else {
          setData(result);
        }
      })
      .catch(() => setError('Failed to load channels'))
      .finally(() => setLoading(false));
  }, [apiBase]);

  /* ── Loading ── */
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

  /* ── Error ── */
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

  // Filter to selected channel if specified
  const channels = selectedChannel
    ? data.channels.filter((ch) => ch.type === selectedChannel)
    : data.channels;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* ── Header ── */}
      <header className="pt-12 pb-8 px-4">
        <div className="max-w-2xl mx-auto text-center">
          {/* Logo */}
          <div className="mb-5 flex justify-center">
            <img
              src={logoUrl}
              alt={data.tenantName}
              className="w-14 h-14 rounded-2xl shadow-sm object-cover"
            />
          </div>

          {/* Headline */}
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 tracking-tight mb-2">
            {headline}
          </h1>
          <p className="text-gray-500 text-base max-w-md mx-auto leading-relaxed">
            {subtitle}
          </p>

          {palmosUserId && (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-teal-50 border border-teal-100 px-3 py-1">
              <div className="w-1.5 h-1.5 rounded-full bg-teal-500" />
              <span className="text-xs text-teal-700 font-medium">Account linked</span>
            </div>
          )}
        </div>
      </header>

      {/* ── Channel grid ── */}
      <main className="flex-1 px-4 pb-12">
        <div className="max-w-2xl mx-auto">
          {channels.length === 0 ? (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 text-center">
              <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-4">
                <span className="text-2xl">📡</span>
              </div>
              <h2 className="font-semibold text-gray-900 mb-2">No channels available yet</h2>
              <p className="text-gray-500 text-sm max-w-xs mx-auto">
                {selectedChannel
                  ? `${getMeta(selectedChannel).label} hasn't been set up yet. Ask your administrator to enable it.`
                  : 'Your administrator hasn\'t connected any channels yet. Check back soon.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {channels.map((ch) => (
                <ChannelCard key={ch.id} channel={ch} accent={accent} />
              ))}
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
