'use client';
import { useEffect, useState } from 'react';
import { Loader2, Link2, ShieldCheck, ShieldBan } from 'lucide-react';
import { api } from '@/lib/api';
import { cn, formatDate } from '@/lib/utils';
import type { ApiResponse } from '@clawscale/shared';

interface EndUser {
  id: string;
  tenantId: string;
  channelId: string;
  externalId: string;
  name: string | null;
  email: string | null;
  status: 'allowed' | 'blocked';
  linkedTo: string | null;
  createdAt: string;
  updatedAt: string;
  channel: { name: string; type: string };
  _count: { conversations: number };
}

interface EndUsersResponse {
  rows: EndUser[];
  total: number;
}

const STATUS_BADGE: Record<string, string> = {
  allowed: 'badge-teal',
  blocked: 'badge-red',
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  allowed: <ShieldCheck className="h-3.5 w-3.5" />,
  blocked: <ShieldBan className="h-3.5 w-3.5" />,
};

export default function EndUsers() {
  const [data, setData] = useState<EndUsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = 50;

  async function load(off: number) {
    setLoading(true);
    const res = await api.get<ApiResponse<EndUsersResponse>>(`/api/end-users?limit=${limit}&offset=${off}`);
    if (res.ok) setData(res.data);
    setLoading(false);
  }

  useEffect(() => { void load(offset); }, [offset]);

  const total = data?.total ?? 0;
  const rows = data?.rows ?? [];
  const hasNext = offset + limit < total;
  const hasPrev = offset > 0;

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">End Users</h1>
          <p className="text-gray-500 mt-1">
            {total} registered user{total !== 1 ? 's' : ''} across all channels.
          </p>
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <p className="text-sm">No end users yet.</p>
            <p className="text-xs mt-1">Users will appear here once they message your bot.</p>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-5 py-3 text-left font-medium text-gray-500">User</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-500">Channel</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-500">Status</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-500">Conversations</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-500">Linked</th>
                  <th className="px-5 py-3 text-left font-medium text-gray-500">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-50/50">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-50 text-teal-600 font-semibold text-sm">
                          {(u.name ?? u.externalId)[0]?.toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{u.name ?? u.externalId}</p>
                          {u.email && <p className="text-xs text-gray-400">{u.email}</p>}
                          {u.name && <p className="text-xs text-gray-400 font-mono">{u.externalId}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <div>
                        <p className="text-gray-900">{u.channel.name}</p>
                        <p className="text-xs text-gray-400 capitalize">{u.channel.type}</p>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={cn(STATUS_BADGE[u.status], 'flex items-center gap-1 w-fit')}>
                        {STATUS_ICON[u.status]} {u.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{u._count.conversations}</td>
                    <td className="px-5 py-3.5">
                      {u.linkedTo ? (
                        <span className="flex items-center gap-1 text-teal-600 text-xs">
                          <Link2 className="h-3.5 w-3.5" /> Linked
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">No</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-gray-500">{formatDate(u.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {total > limit && (
              <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
                <p className="text-xs text-gray-400">
                  Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
                </p>
                <div className="flex gap-2">
                  <button
                    className="btn-secondary text-xs px-3 py-1"
                    disabled={!hasPrev}
                    onClick={() => setOffset((o) => Math.max(0, o - limit))}
                  >
                    Previous
                  </button>
                  <button
                    className="btn-secondary text-xs px-3 py-1"
                    disabled={!hasNext}
                    onClick={() => setOffset((o) => o + limit)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
