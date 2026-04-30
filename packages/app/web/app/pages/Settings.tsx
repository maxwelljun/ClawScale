import { useEffect, useState } from 'react';
import { Loader2, Save, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/lib/api';
import { getUser, clearAuth, storeTenant } from '@/lib/auth';
import type { ApiResponse, Tenant, TenantSettings } from '@clawscale/shared';

export default function Settings() {
  const navigate = useNavigate();
  const me = getUser();
  const isAdmin = me?.role === 'admin';
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deletingProject, setDeletingProject] = useState(false);
  const [deleteProjectConfirm, setDeleteProjectConfirm] = useState('');
  const [name, setName] = useState('');
  const [siteTitle, setSiteTitle] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [endUserAccess, setEndUserAccess] = useState<TenantSettings['endUserAccess']>('anonymous');
  const [clawscaleEnabled, setClawscaleEnabled] = useState(true);
  const [clawscaleModel, setClawscaleModel] = useState('openai:gpt-5.4-mini');
  const [clawscaleApiKey, setClawscaleApiKey] = useState('');
  const [apiKeySet, setApiKeySet] = useState(false);
  const [clawscaleMultimodal, setClawscaleMultimodal] = useState(false);
  const [rateLimitEnabled, setRateLimitEnabled] = useState(false);
  const [rateLimitMax, setRateLimitMax] = useState(20);
  const [rateLimitWindow, setRateLimitWindow] = useState(60);
  const [defaultHomePage, setDefaultHomePage] = useState('/dashboard');
  const [allowRegistration, setAllowRegistration] = useState(true);
  const [backendLabels, setBackendLabels] = useState<'show' | 'hide' | 'force-hide'>('show');

  useEffect(() => {
    api.get<ApiResponse<Tenant>>('/api/tenant').then((res) => {
      if (res.ok) {
        const t = res.data;
        setTenant(t); setName(t.name);
        const s = t.settings as TenantSettings;
        setSiteTitle(s.siteTitle ?? '');
        setLogoUrl(s.logoUrl ?? '');
        setEndUserAccess(s.endUserAccess ?? 'anonymous');
        setClawscaleEnabled(s.clawscale?.isActive !== false);
        setClawscaleModel(s.clawscale?.llm?.model ?? 'openai:gpt-5.4-mini');
        setApiKeySet(!!s.clawscale?.llm?.apiKey && s.clawscale.llm.apiKey !== '');
        setClawscaleMultimodal(s.clawscale?.llm?.multimodal ?? false);
        const rl = s.clawscale?.rateLimit;
        if (rl) { setRateLimitEnabled(true); setRateLimitMax(rl.maxMessages); setRateLimitWindow(rl.windowSeconds); }
        setDefaultHomePage(s.defaultHomePage ?? '/dashboard');
        setAllowRegistration(s.allowRegistration !== false);
        setBackendLabels(s.backendLabels ?? 'show');
      }
      setLoading(false);
    });
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault(); setError(''); setSuccess(false); setSaving(true);
    try {
      const res = await api.patch<ApiResponse<Tenant>>('/api/tenant', {
        name,
        settings: {
          siteTitle: siteTitle || undefined,
          logoUrl: logoUrl || null,
          defaultHomePage: defaultHomePage || null,
          allowRegistration,
          backendLabels,
          endUserAccess,
          clawscale: {
            isActive: clawscaleEnabled,
            llm: {
              model: clawscaleModel,
              ...(clawscaleApiKey ? { apiKey: clawscaleApiKey } : {}),
              multimodal: clawscaleMultimodal,
            },
            rateLimit: rateLimitEnabled ? { maxMessages: rateLimitMax, windowSeconds: rateLimitWindow } : null,
          },
        },
      });
      if (!res.ok) { setError(res.error); return; }
      setTenant(res.data); setSuccess(true);
      storeTenant(res.data);
      const s = res.data.settings as TenantSettings;
      document.title = s.siteTitle || `${res.data.name} — ClawBot`;
      const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (favicon) favicon.href = s.logoUrl || '/logo.png';
      setTimeout(() => setSuccess(false), 3000);
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>;

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Settings</h1>
        <p className="text-gray-500 mt-1">Configure your project settings.</p>
      </div>

      {!isAdmin && (
        <div className="mb-6 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-700">
          Only admins can edit project settings.
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-6">
        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-4">Project</h2>
          <div className="space-y-4">
            <div>
              <label className="label">Project name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} required />
            </div>
            <div>
              <label className="label">Browser tab title</label>
              <input className="input" value={siteTitle} onChange={(e) => setSiteTitle(e.target.value)} disabled={!isAdmin} placeholder={`${name || 'Project'} — ClawBot`} />
              <p className="text-xs text-gray-400 mt-1">Custom title for the browser tab. Leave blank to use the default.</p>
            </div>
            <div>
              <label className="label">Logo URL</label>
              <div className="flex items-center gap-3">
                {logoUrl && <img src={logoUrl} alt="Logo preview" className="h-10 w-10 rounded-lg object-cover border border-gray-200" />}
                <input className="input flex-1" placeholder="https://example.com/logo.png" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} disabled={!isAdmin} />
              </div>
              <p className="text-xs text-gray-400 mt-1">Used as the sidebar logo, browser favicon, and on login/register pages. Leave blank for the default.</p>
            </div>
            <div>
              <label className="label">Default home page</label>
              <select className="input" value={defaultHomePage} onChange={(e) => setDefaultHomePage(e.target.value)} disabled={!isAdmin}>
                <option value="/dashboard">Dashboard (default)</option>
                <option value="/onboard">Onboard</option>
              </select>
              <p className="text-xs text-gray-400 mt-1">The page visitors see when they navigate to the root URL.</p>
            </div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={allowRegistration} onChange={(e) => setAllowRegistration(e.target.checked)} disabled={!isAdmin} className="mt-0.5" />
              <span>
                <span className="text-sm font-medium text-gray-900">Allow new user registration</span>
                <span className="text-xs text-gray-500 block">When disabled, only existing members can sign in. New users cannot create accounts.</span>
              </span>
            </label>
          </div>
        </div>

        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-1">ClawBot Setup Assistant</h2>
          <p className="text-sm text-gray-500 mb-4">Configure the built-in AI assistant that helps end-users navigate your bot.</p>
          <div className="space-y-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={clawscaleEnabled} onChange={(e) => setClawscaleEnabled(e.target.checked)} disabled={!isAdmin} className="mt-0.5" />
              <span>
                <span className="text-sm font-medium text-gray-900">Enable ClawBot assistant</span>
                <span className="text-xs text-gray-500 block">When disabled, the AI assistant will not respond to any messages or commands. System commands like /team and /backends still work.</span>
              </span>
            </label>
            {clawscaleEnabled && (<>
            <div>
              <label className="label">Model</label>
              <input className="input" placeholder="openai:gpt-5.4-mini" value={clawscaleModel} onChange={(e) => setClawscaleModel(e.target.value)} disabled={!isAdmin} />
              <p className="text-xs text-gray-400 mt-1">LangChain format, e.g. &quot;openai:gpt-5.4-mini&quot;, &quot;anthropic:claude-haiku-4-5-20251001&quot;</p>
            </div>
            <div>
              <label className="label">API key</label>
              <input className="input font-mono text-xs" type="password" placeholder={apiKeySet ? '••••••••••••••••' : 'sk-...'} value={clawscaleApiKey} onChange={(e) => setClawscaleApiKey(e.target.value)} disabled={!isAdmin} />
              {apiKeySet && !clawscaleApiKey && <p className="text-xs text-emerald-600 mt-1">API key is saved. Enter a new value to replace it.</p>}
            </div>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={clawscaleMultimodal} onChange={(e) => setClawscaleMultimodal(e.target.checked)} disabled={!isAdmin} className="mt-0.5" />
              <span>
                <span className="text-sm font-medium text-gray-900">Enable multimodal input</span>
                <span className="text-xs text-gray-500 block">Allow the assistant to process images, files, and audio sent by users. Requires a vision-capable model (e.g. GPT-4o, Claude Sonnet).</span>
              </span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input type="checkbox" checked={rateLimitEnabled} onChange={(e) => setRateLimitEnabled(e.target.checked)} disabled={!isAdmin} className="mt-0.5" />
              <span>
                <span className="text-sm font-medium text-gray-900">Rate limit</span>
                <span className="text-xs text-gray-500 block">Limit how many messages each end-user can send within a time window.</span>
              </span>
            </label>
            {rateLimitEnabled && (
              <div className="flex items-center gap-3 pl-7">
                <div className="flex-1">
                  <label className="label">Max messages</label>
                  <input type="number" className="input" min={1} max={10000} value={rateLimitMax} onChange={(e) => setRateLimitMax(Number(e.target.value))} disabled={!isAdmin} />
                </div>
                <div className="flex-1">
                  <label className="label">Window (seconds)</label>
                  <input type="number" className="input" min={1} max={86400} value={rateLimitWindow} onChange={(e) => setRateLimitWindow(Number(e.target.value))} disabled={!isAdmin} />
                </div>
              </div>
            )}
            </>)}
          </div>
        </div>

        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-1">End-User Access</h2>
          <p className="text-sm text-gray-500 mb-4">Control who can interact with your bot.</p>
          <div className="space-y-2">
            {(['anonymous', 'whitelist', 'blacklist'] as const).map((opt) => (
              <label key={opt} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="endUserAccess"
                  value={opt}
                  checked={endUserAccess === opt}
                  onChange={() => setEndUserAccess(opt)}
                  disabled={!isAdmin}
                  className="mt-0.5"
                />
                <span>
                  <span className="text-sm font-medium text-gray-900 capitalize">{opt}</span>
                  <span className="text-xs text-gray-500 block">
                    {opt === 'anonymous' && 'Anyone who messages the bot can use it.'}
                    {opt === 'whitelist' && 'Only users on the allow-list can interact.'}
                    {opt === 'blacklist' && 'Everyone except users on the block-list can interact.'}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="card p-6">
          <h2 className="font-semibold text-gray-900 mb-1">Backend Labels</h2>
          <p className="text-sm text-gray-500 mb-4">Control whether the AI backend name (e.g. [GPT-4]) is shown in responses to end-users.</p>
          <div className="space-y-2">
            {([
              ['show', 'Always show', 'Display [BackendName] prefix on every response.'],
              ['hide', 'Hide by default', 'Labels are hidden but users can toggle them on.'],
              ['force-hide', 'Always hide', 'Labels are always hidden. Users cannot override this.'],
            ] as const).map(([value, label, desc]) => (
              <label key={value} className="flex items-start gap-3 cursor-pointer">
                <input
                  type="radio"
                  name="backendLabels"
                  value={value}
                  checked={backendLabels === value}
                  onChange={() => setBackendLabels(value)}
                  disabled={!isAdmin}
                  className="mt-0.5"
                />
                <span>
                  <span className="text-sm font-medium text-gray-900">{label}</span>
                  <span className="text-xs text-gray-500 block">{desc}</span>
                </span>
              </label>
            ))}
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

      <div className="mt-10 border-t border-red-200 pt-8 space-y-6">
        <div className="card border-red-200 p-6">
          <h2 className="font-semibold text-red-700 mb-1">Danger Zone</h2>

          <div className="space-y-6">
            <div>
              <p className="text-sm text-gray-500 mb-3">
                Permanently delete your account. This removes your member profile and logs you out.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="label text-red-700">Type &quot;delete my account&quot; to confirm</label>
                  <input
                    className="input border-red-300 focus:border-red-500 focus:ring-red-500"
                    placeholder="delete my account"
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                  />
                </div>
                <button
                  type="button"
                  disabled={deleteConfirm !== 'delete my account' || deleting}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={async () => {
                    setDeleting(true);
                    setError('');
                    try {
                      const res = await api.delete<ApiResponse<null>>('/auth/account');
                      if (!res.ok) { setError(res.error); return; }
                      clearAuth();
                      navigate('/login');
                    } finally { setDeleting(false); }
                  }}
                >
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  Delete my account
                </button>
              </div>
            </div>

            {isAdmin && (
              <div className="border-t border-red-200 pt-6">
                <p className="text-sm text-gray-500 mb-3">
                  Permanently delete the entire project. This removes all members, conversations, channels, AI backends, and data. <strong>This cannot be undone.</strong>
                </p>
                <div className="space-y-3">
                  <div>
                    <label className="label text-red-700">Type &quot;delete project&quot; to confirm</label>
                    <input
                      className="input border-red-300 focus:border-red-500 focus:ring-red-500"
                      placeholder="delete project"
                      value={deleteProjectConfirm}
                      onChange={(e) => setDeleteProjectConfirm(e.target.value)}
                    />
                  </div>
                  <button
                    type="button"
                    disabled={deleteProjectConfirm !== 'delete project' || deletingProject}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={async () => {
                      setDeletingProject(true);
                      setError('');
                      try {
                        const res = await api.delete<ApiResponse<null>>('/api/tenant');
                        if (!res.ok) { setError(res.error); return; }
                        clearAuth();
                        navigate('/register');
                      } finally { setDeletingProject(false); }
                    }}
                  >
                    {deletingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    Delete project
                  </button>
                </div>
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        </div>
      </div>
    </div>
  );
}
