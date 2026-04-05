import { useEffect, useState } from 'react';
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { LayoutDashboard, Users, UserCheck, Radio, Settings, LogOut, MessageSquare, BotMessageSquare, Globe } from 'lucide-react';
import { isAuthenticated, clearAuth, getUser, getTenant } from '@/lib/auth';
import { cn } from '@/lib/utils';

const navItems: { href: string; icon: typeof LayoutDashboard; label: string; exact?: boolean }[] = [
  { href: '/', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { href: '/conversations', icon: MessageSquare, label: 'Conversations' },
  { href: '/channels', icon: Radio, label: 'Channels' },
  { href: '/ai-backends', icon: BotMessageSquare, label: 'AI Backends' },
  { href: '/end-users', icon: UserCheck, label: 'End Users' },
  { href: '/users', icon: Users, label: 'Members' },
  { href: '/onboarding', icon: Globe, label: 'Onboarding' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

export default function DashboardLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      navigate('/login', { replace: true });
    } else {
      setReady(true);
      const t = getTenant();
      if (t) document.title = t.settings?.siteTitle || `${t.name} — ClawScale`;
    }
  }, [navigate]);

  if (!ready) return null;

  const user = getUser();
  const tenant = getTenant();

  function handleLogout() {
    clearAuth();
    navigate('/login');
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="flex w-60 flex-col bg-navy-900 text-white">
        <div className="flex items-center gap-2.5 px-5 py-5 border-b border-white/10">
          <img src="/logo.png" alt="ClawScale" width={28} height={28} className="h-7 w-7" />
          <div>
            <span className="font-semibold text-white text-base">ClawScale</span>
            <p className="text-[10px] text-white/40 leading-none mt-0.5">by Pulse</p>
          </div>
        </div>

        {tenant && (
          <div className="mx-4 mt-4 rounded-lg bg-white/5 px-3 py-2">
            <p className="text-xs font-medium text-white/80 truncate">{tenant.name}</p>
          </div>
        )}

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ href, icon: Icon, label, exact }) => {
            const isActive = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link
                key={href}
                to={href}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-teal-500/20 text-teal-400'
                    : 'text-white/60 hover:bg-white/5 hover:text-white',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-500/20 text-teal-400 text-sm font-semibold">
              {user?.name[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate">{user?.name}</p>
              <p className="text-xs text-white/40 capitalize">{user?.role}</p>
            </div>
            <button onClick={handleLogout} className="text-white/40 hover:text-white transition-colors" title="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
