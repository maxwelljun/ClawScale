import { useEffect, useState } from 'react';
import { BotMessageSquare, Loader2, Play, RotateCw, Square, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import type { ApiResponse } from '@clawscale/shared';

type AgentInstance = {
  id: string;
  channel: { id: string; name: string; type: string };
  endUser: { id: string; externalId: string; name: string | null; email: string | null };
  backend: { id: string; name: string; runtimeType?: string | null; type: string } | null;
  modelProvider: { id: string; name: string; provider: string } | null;
  agentTemplateVersion: { id: string; version: number; name: string } | null;
  conversationId: string;
  containerName: string;
  runtime: { status: string; running: boolean; health?: string | null } | null;
  stateDir: string;
  workspaceDir: string;
  lastMessageAt: string;
  lastLatencyMs: number | null;
};

const statusClass: Record<string, string> = {
  running: 'badge-green',
  exited: 'badge-gray',
  restarting: 'badge-yellow',
  dead: 'badge-red',
  missing: 'badge-gray',
};

export default function Agents() {
  const [rows, setRows] = useState<AgentInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await api.get<ApiResponse<AgentInstance[]>>('/api/agent-instances');
    if (res.ok) setRows(res.data);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function runtimeAction(containerName: string, action: 'start' | 'stop' | 'restart') {
    setActionId(`${containerName}:${action}`);
    try {
      await api.post<ApiResponse<unknown>>(`/api/agent-instances/${containerName}/${action}`, {});
      await load();
    } finally {
      setActionId(null);
    }
  }

  return (
    <div className="p-8 max-w-7xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Agents</h1>
          <p className="text-gray-500 mt-1">Runtime instances dynamically created from channel-bound agent templates.</p>
        </div>
        <button className="btn-secondary" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <BotMessageSquare className="h-9 w-9 text-gray-300 mx-auto mb-3" />
          <p className="font-medium text-gray-500">No runtime agents yet</p>
          <p className="text-sm text-gray-400 mt-1">Bind a channel to an agent template, then send a user message to create an isolated runtime.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {rows.map((row) => {
            const status = row.runtime?.status ?? 'missing';
            const busy = actionId?.startsWith(row.containerName);
            return (
              <div key={row.id} className="card p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h2 className="font-semibold text-gray-900 truncate">{row.backend?.name ?? 'Unknown agent'}</h2>
                      <span className={statusClass[status] ?? 'badge-gray'}>{status}</span>
                      {row.runtime?.health && <span className="badge-gray">{row.runtime.health}</span>}
                      {row.agentTemplateVersion && <span className="badge-yellow">v{row.agentTemplateVersion.version}</span>}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">
                      {row.channel.name} · {row.channel.type} · {row.endUser.name ?? row.endUser.externalId}
                    </p>
                    <p className="text-xs text-gray-400 mt-1 font-mono truncate">{row.containerName}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button className="btn-secondary text-xs" onClick={() => runtimeAction(row.containerName, 'start')} disabled={busy || row.runtime?.running === true}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Start
                    </button>
                    <button className="btn-secondary text-xs" onClick={() => runtimeAction(row.containerName, 'restart')} disabled={busy || !row.runtime}>
                      <RotateCw className="h-3.5 w-3.5" /> Restart
                    </button>
                    <button className="btn-secondary text-xs" onClick={() => runtimeAction(row.containerName, 'stop')} disabled={busy || row.runtime?.running !== true}>
                      <Square className="h-3.5 w-3.5" /> Stop
                    </button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 lg:grid-cols-5 gap-3 text-xs">
                  <div className="rounded bg-gray-50 p-2"><p className="text-gray-400">Model</p><p className="truncate">{row.modelProvider?.name ?? 'default'}</p></div>
                  <div className="rounded bg-gray-50 p-2"><p className="text-gray-400">Last message</p><p>{new Date(row.lastMessageAt).toLocaleString()}</p></div>
                  <div className="rounded bg-gray-50 p-2"><p className="text-gray-400">Latency</p><p>{row.lastLatencyMs ? `${row.lastLatencyMs}ms` : '-'}</p></div>
                  <div className="rounded bg-gray-50 p-2"><p className="text-gray-400">State</p><p className="truncate font-mono">{row.stateDir}</p></div>
                  <div className="rounded bg-gray-50 p-2"><p className="text-gray-400">Workspace</p><p className="truncate font-mono">{row.workspaceDir}</p></div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
