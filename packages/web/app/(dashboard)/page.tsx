'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { MessageSquare, Radio, ArrowRight, Users, Bot, UserCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { getTenant } from '@/lib/auth';
import type { ApiResponse } from '@clawscale/shared';

interface Stats {
  totalMembers: number;
  activeMembers: number;
  totalConversations: number;
  activeChannels: number;
  totalBackends: number;
  totalEndUsers: number;
}

interface ChannelRow { id: string; name: string; type: string; status: string }

export default function Dashboard() {
  const tenant = getTenant();
  const [stats, setStats] = useState<Stats | null>(null);
  const [channels, setChannels] = useState<ChannelRow[]>([]);

  useEffect(() => {
    api.get<ApiResponse<Stats>>('/api/tenant/stats').then((r) => { if (r.ok) setStats(r.data); });
    api.get<ApiResponse<ChannelRow[]>>('/api/channels').then((r) => { if (r.ok) setChannels(r.data); });
  }, []);

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">
          Welcome back{tenant ? ` to ${tenant.name}` : ''}
        </h1>
        <p className="text-gray-500 mt-1">Here&apos;s an overview of your chatbot.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5 mb-8">
        <StatCard icon={<MessageSquare className="h-5 w-5 text-teal-500" />} label="Total conversations"
          value={stats?.totalConversations ?? '—'} sub="across all channels" />
        <StatCard icon={<Radio className="h-5 w-5 text-teal-500" />} label="Active channels"
          value={stats?.activeChannels ?? '—'} sub={`${channels.length} configured`} />
        <StatCard icon={<UserCheck className="h-5 w-5 text-teal-500" />} label="End users"
          value={stats?.totalEndUsers ?? '—'} sub="registered" />
        <StatCard icon={<Users className="h-5 w-5 text-teal-500" />} label="Team members"
          value={stats?.totalMembers ?? '—'} sub={`${stats?.activeMembers ?? 0} active`} />
        <StatCard icon={<Bot className="h-5 w-5 text-teal-500" />} label="AI backends"
          value={stats?.totalBackends ?? '—'} sub="configured" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <QuickCard to="/conversations" title="Conversations"
          desc="View all conversations end-users are having with your bot."
          icon={<MessageSquare className="h-5 w-5" />} />
        <QuickCard to="/channels" title="Channels"
          desc="Connect WhatsApp, Telegram, Slack, and more to your bot."
          icon={<Radio className="h-5 w-5" />} />
        <QuickCard to="/ai-backends" title="AI Backends"
          desc="Configure and manage your AI providers and models."
          icon={<Bot className="h-5 w-5" />} />
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub }: {
  icon: React.ReactNode; label: string;
  value: string | number | React.ReactNode; sub: string | React.ReactNode;
}) {
  return (
    <div className="card p-5 flex items-start gap-4">
      <div className="rounded-lg bg-teal-50 p-2.5">{icon}</div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl font-semibold text-gray-900 mt-0.5">{value}</p>
        <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
      </div>
    </div>
  );
}

function QuickCard({ to, title, desc, icon }: { to: string; title: string; desc: string; icon: React.ReactNode }) {
  return (
    <Link href={to} className="card p-5 hover:border-teal-300 hover:shadow-md transition-all group">
      <div className="flex items-center justify-between mb-3">
        <div className="rounded-lg bg-navy-900/5 p-2 text-navy-900">{icon}</div>
        <ArrowRight className="h-4 w-4 text-gray-300 group-hover:text-teal-500 transition-colors" />
      </div>
      <h3 className="font-semibold text-gray-900">{title}</h3>
      <p className="text-sm text-gray-500 mt-1">{desc}</p>
    </Link>
  );
}
