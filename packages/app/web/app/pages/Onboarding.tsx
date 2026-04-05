import { useEffect, useState } from 'react';
import { Loader2, Save, ExternalLink, Copy, Check } from 'lucide-react';
import { api } from '@/lib/api';
import { getUser, getTenant } from '@/lib/auth';
import type { ApiResponse, Tenant, TenantSettings } from '@clawscale/shared';

export default function OnboardingPage() {
  const me = getUser();
  const isAdmin = me?.role === 'admin';
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const [headline, setHeadline] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [accentColor, setAccentColor] = useState('#00C9A7');

  useEffect(() => {
    api.get<ApiResponse<Tenant>>('/api/tenant').then((res) => {
      if (res.ok) {
        const t = res.data;
        setTenant(t);
        const s = t.settings as TenantSettings;
        setHeadline(s.onboarding?.headline ?? '');
        setSubtitle(s.onboarding?.subtitle ?? '');
        setLogoUrl(s.onboarding?.logoUrl ?? '');
        setAccentColor(s.onboarding?.accentColor ?? '#00C9A7');
      }
      setLoading(false);
    });
  }, []);

  const portalUrl = typeof window !== 'undefined' ? `${window.location.origin}/onboard` : '/onboard';

  function copyUrl() {
    navigator.clipboard.writeText(portalUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess(false);
    setSaving(true);
    try {
      const res = await api.patch<ApiResponse<Tenant>>('/api/tenant', {
        settings: {
          onboarding: {
            ...(headline ? { headline } : {}),
            ...(subtitle ? { subtitle } : {}),
            ...(logoUrl ? { logoUrl } : {}),
            accentColor,
          },
        },
      });
      if (!res.ok) { setError(res.error); return; }
      setTenant(res.data);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>;

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Onboarding Portal</h1>
        <p className="text-gray-500 mt-1">Configure and share the consumer-facing page where end-users connect to your channels.</p>
      </div>

      {!isAdmin && (
        <div className="mb-6 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          Only admins can edit onboarding settings.
        </div>
      )}

      {/* Portal URL */}
      <div className="card p-6 mb-6">
        <h2 className="font-semibold text-gray-900 mb-1">Portal Link</h2>
        <p className="text-sm text-gray-500 mb-4">Share this URL with your end-users so they can connect to your channels.</p>
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <span className="text-sm font-mono text-gray-700 truncate select-all">{portalUrl}</span>
          </div>
          <button
            type="button"
            onClick={copyUrl}
            className="btn-secondary shrink-0"
            title="Copy URL"
          >
            {copied ? <Check className="h-4 w-4 text-teal-500" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <a
            href={portalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary shrink-0"
            title="Preview portal"
          >
            <ExternalLink className="h-4 w-4" />
            Preview
          </a>
        </div>
      </div>

      {/* Branding settings */}
      <form onSubmit={handleSave} className="space-y-6">
        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-1">Branding</h2>
          <p className="text-sm text-gray-500 mb-4">Customize how the onboarding portal looks for your end-users.</p>
          <div className="space-y-4">
            <div>
              <label className="label">Headline</label>
              <input className="input" placeholder={`Connect to ${tenant?.name || 'your app'}`} value={headline} onChange={(e) => setHeadline(e.target.value)} disabled={!isAdmin} />
              <p className="text-xs text-gray-400 mt-1">Leave empty to use &quot;Connect to {'{'} project name {'}'}&quot;</p>
            </div>
            <div>
              <label className="label">Subtitle</label>
              <input className="input" placeholder="Choose a messaging platform to connect with your AI assistant." value={subtitle} onChange={(e) => setSubtitle(e.target.value)} disabled={!isAdmin} />
            </div>
            <div>
              <label className="label">Logo URL</label>
              <input className="input" placeholder="https://example.com/logo.png" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} disabled={!isAdmin} />
              <p className="text-xs text-gray-400 mt-1">Leave empty to use the ClawScale logo.</p>
            </div>
            <div>
              <label className="label">Accent color</label>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  disabled={!isAdmin}
                  className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5"
                />
                <input className="input w-32 font-mono text-xs" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} disabled={!isAdmin} placeholder="#00C9A7" />
              </div>
            </div>
          </div>
        </div>

        {isAdmin && (
          <div className="flex items-center gap-4">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save changes
            </button>
            {success && <p className="text-sm text-emerald-600 font-medium">Saved!</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        )}
      </form>
    </div>
  );
}
