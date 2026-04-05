import { useState, useEffect, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { storeAuth } from '@/lib/auth';
import type { ApiResponse, AuthResult } from '@clawscale/shared';

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ tenantName: '', tenantSlug: '', name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [hasProject, setHasProject] = useState<boolean | null>(null);
  const [projectName, setProjectName] = useState('');
  const [registrationDisabled, setRegistrationDisabled] = useState(false);

  useEffect(() => {
    api.get<ApiResponse<{ hasProject: boolean; projectName: string | null; allowRegistration: boolean }>>('/auth/status').then((res) => {
      if (res.ok) {
        setHasProject(res.data.hasProject);
        setProjectName(res.data.projectName ?? '');
        if (res.data.hasProject && !res.data.allowRegistration) {
          setRegistrationDisabled(true);
        }
      }
    });
  }, []);

  function set(key: keyof typeof form) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setForm((prev) => {
        const next = { ...prev, [key]: value };
        if (key === 'tenantName') {
          next.tenantSlug = value.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 48);
        }
        return next;
      });
    };
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const payload = hasProject
        ? { name: form.name, email: form.email, password: form.password }
        : form;
      const res = await api.post<ApiResponse<AuthResult>>('/auth/register', payload);
      if (!res.ok) { setError(res.error); return; }
      storeAuth(res.data);
      navigate('/');
    } finally { setLoading(false); }
  }

  if (hasProject === null) {
    return <div className="flex min-h-screen items-center justify-center bg-navy-950"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2.5 mb-8">
          <img src="/logo.png" alt="ClawScale" width={32} height={32} className="h-8 w-8" />
          <span className="text-2xl font-semibold text-white">ClawScale</span>
        </div>

        <div className="card p-8">
          {registrationDisabled ? (
            <>
              <h1 className="text-xl font-semibold text-gray-900 mb-1">Registration closed</h1>
              <p className="text-sm text-gray-500 mb-6">
                New account registration is currently disabled for {projectName || 'this project'}. Please contact an administrator if you need access.
              </p>
              <Link to="/login" className="btn-primary w-full inline-flex items-center justify-center">Sign in instead</Link>
            </>
          ) : (
          <>
          <h1 className="text-xl font-semibold text-gray-900 mb-1">
            {hasProject ? `Join ${projectName}` : 'Create your project'}
          </h1>
          <p className="text-sm text-gray-500 mb-6">
            {hasProject ? 'Create an account to get started.' : 'Set up your IM chatbots in minutes.'}
          </p>

          {error && <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!hasProject && (
              <>
                <div>
                  <label className="label" htmlFor="tenantName">Project name</label>
                  <input id="tenantName" className="input" placeholder="Acme Corp" value={form.tenantName} onChange={set('tenantName')} required />
                </div>
                <div>
                  <label className="label" htmlFor="tenantSlug">Project URL</label>
                  <div className="flex items-center rounded-lg border border-gray-200 focus-within:border-teal-500 focus-within:ring-1 focus-within:ring-teal-500 bg-white overflow-hidden">
                    <span className="pl-3 text-sm text-gray-400 select-none whitespace-nowrap">clawscale.org/</span>
                    <input id="tenantSlug" className="flex-1 px-1 py-2 text-sm outline-none bg-transparent"
                      placeholder="acme-corp" value={form.tenantSlug} onChange={set('tenantSlug')}
                      pattern="[a-z0-9-]+" title="Lowercase letters, numbers, and hyphens only" required />
                  </div>
                </div>
              </>
            )}
            <div>
              <label className="label" htmlFor="name">Your name</label>
              <input id="name" className="input" placeholder="Jane Smith" value={form.name} onChange={set('name')} required />
            </div>
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" className="input" placeholder="jane@acme.com" value={form.email} onChange={set('email')} required />
            </div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input id="password" type="password" className="input" placeholder="Min. 8 characters" value={form.password} onChange={set('password')} minLength={8} required />
            </div>
            <button type="submit" className="btn-primary w-full mt-2" disabled={loading}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />} {hasProject ? 'Create account' : 'Create project'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            Already have an account?{' '}
            <Link to="/login" className="text-teal-600 hover:underline font-medium">Sign in</Link>
          </p>
          </>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-white/30">Free forever for up to 5 users. No credit card required.</p>
      </div>
    </div>
  );
}
