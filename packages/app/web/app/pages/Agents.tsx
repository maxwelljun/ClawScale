import { useEffect, useRef, useState } from 'react';
import { BotMessageSquare, Loader2, Play, RotateCw, Square, RefreshCw, Settings, FileText, Terminal, MoreHorizontal, X, Send, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { getToken } from '@/lib/auth';
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
type AgentTab = 'config' | 'logs' | 'terminal' | 'more';
type ConfigPayload = {
  identity: Record<string, string> | null;
  dirs: { stateDir: string; workspaceDir: string } | null;
  inspect: unknown;
  openclawConfig: unknown;
  currentModel: { providerId: string | null; model: string | null; primary: string | null };
  modelProviders: Array<{ id: string; name: string; provider: string; baseUrl: string | null; models: string[]; config: Record<string, unknown> }>;
  manifest: unknown;
  version: unknown;
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
  const [selected, setSelected] = useState<AgentInstance | null>(null);
  const [tab, setTab] = useState<AgentTab>('config');
  const [config, setConfig] = useState<ConfigPayload | null>(null);
  const [logs, setLogs] = useState('');
  const [terminalCommand, setTerminalCommand] = useState('pwd && ls -la /home/node/.openclaw/workspace');
  const [terminalOutput, setTerminalOutput] = useState('');
  const [quickCommandOutput, setQuickCommandOutput] = useState('');
  const [terminalSocket, setTerminalSocket] = useState<WebSocket | null>(null);
  const [runtimeModelProviderId, setRuntimeModelProviderId] = useState('');
  const [runtimeModel, setRuntimeModel] = useState('');
  const [panelLoading, setPanelLoading] = useState(false);
  const terminalViewportRef = useRef<HTMLPreElement | null>(null);

  async function load() {
    setLoading(true);
    const res = await api.get<ApiResponse<AgentInstance[]>>('/api/agent-instances');
    if (res.ok) setRows(res.data);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);
  useEffect(() => () => terminalSocket?.close(), [terminalSocket]);
  useEffect(() => {
    const viewport = terminalViewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
  }, [terminalOutput]);

  async function runtimeAction(containerName: string, action: 'start' | 'stop' | 'restart') {
    setActionId(`${containerName}:${action}`);
    try {
      await api.post<ApiResponse<unknown>>(`/api/agent-instances/${containerName}/${action}`, {});
      await load();
    } finally {
      setActionId(null);
    }
  }

  async function openPanel(row: AgentInstance, nextTab: AgentTab) {
    setSelected(row);
    setTab(nextTab);
    setConfig(null);
    setLogs('');
    setTerminalOutput('');
    setQuickCommandOutput('');
    terminalSocket?.close();
    await loadPanel(row.containerName, nextTab);
  }

  async function loadPanel(containerName: string, currentTab = tab) {
    setPanelLoading(true);
    try {
      if (currentTab === 'config') {
        const res = await api.get<ApiResponse<ConfigPayload>>(`/api/agent-instances/${containerName}/config`);
        if (res.ok) {
          setConfig(res.data);
          setRuntimeModelProviderId(res.data.currentModel.providerId ?? res.data.modelProviders[0]?.id ?? '');
          setRuntimeModel(res.data.currentModel.model ?? res.data.modelProviders[0]?.models?.[0] ?? '');
        }
      } else if (currentTab === 'logs') {
        const res = await api.get<ApiResponse<{ logs: string }>>(`/api/agent-instances/${containerName}/logs?tail=300`);
        if (res.ok) setLogs(res.data.logs);
      }
    } finally {
      setPanelLoading(false);
    }
  }

  async function switchTab(nextTab: AgentTab) {
    setTab(nextTab);
    if (selected) await loadPanel(selected.containerName, nextTab);
  }

  async function runTerminalCommand() {
    if (!selected) return;
    setPanelLoading(true);
    try {
      const res = await api.post<ApiResponse<{ output: string }>>(`/api/agent-instances/${selected.containerName}/exec`, { command: terminalCommand });
      setQuickCommandOutput(res.ok ? res.data.output : res.error);
    } finally {
      setPanelLoading(false);
    }
  }

  async function saveRuntimeModel() {
    if (!selected || !runtimeModelProviderId || !runtimeModel) return;
    setPanelLoading(true);
    try {
      const res = await api.patch<ApiResponse<Pick<ConfigPayload, 'openclawConfig' | 'currentModel'>>>(`/api/agent-instances/${selected.containerName}/config`, {
        modelProviderId: runtimeModelProviderId,
        model: runtimeModel,
      });
      if (res.ok) {
        setConfig((prev) => prev ? { ...prev, openclawConfig: res.data.openclawConfig, currentModel: res.data.currentModel } : prev);
      }
    } finally {
      setPanelLoading(false);
    }
  }

  function connectTerminal() {
    if (!selected) return;
    terminalSocket?.close();
    const token = getToken();
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/agent-instances/terminal?container=${encodeURIComponent(selected.containerName)}&token=${encodeURIComponent(token ?? '')}&shell=sh`);
    setTerminalOutput('');
    ws.onmessage = (event) => setTerminalOutput((prev) => prev + String(event.data));
    ws.onopen = () => setTimeout(() => terminalViewportRef.current?.focus(), 0);
    ws.onclose = () => setTerminalSocket(null);
    setTerminalSocket(ws);
  }

  function sendTerminalData(data: string) {
    if (!terminalSocket || terminalSocket.readyState !== WebSocket.OPEN) return;
    terminalSocket.send(data);
  }

  function handleTerminalKeyDown(event: React.KeyboardEvent<HTMLPreElement>) {
    if (!terminalSocket || terminalSocket.readyState !== WebSocket.OPEN) return;

    if (event.ctrlKey && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      sendTerminalData('\x03');
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      sendTerminalData('\x04');
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      setTerminalOutput('');
      sendTerminalData('\x0c');
      return;
    }

    const keys: Record<string, string> = {
      Enter: '\r',
      Backspace: '\x7f',
      Tab: '\t',
      Escape: '\x1b',
      ArrowUp: '\x1b[A',
      ArrowDown: '\x1b[B',
      ArrowRight: '\x1b[C',
      ArrowLeft: '\x1b[D',
      Home: '\x1b[H',
      End: '\x1b[F',
      Delete: '\x1b[3~',
    };
    const mapped = keys[event.key];
    if (mapped) {
      event.preventDefault();
      sendTerminalData(mapped);
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1) {
      event.preventDefault();
      sendTerminalData(event.key);
    }
  }

  function handleTerminalPaste(event: React.ClipboardEvent<HTMLPreElement>) {
    if (!terminalSocket || terminalSocket.readyState !== WebSocket.OPEN) return;
    const text = event.clipboardData.getData('text');
    if (!text) return;
    event.preventDefault();
    sendTerminalData(text);
  }

  async function deleteRuntime(removeData: boolean) {
    if (!selected) return;
    const message = removeData
      ? 'Delete this runtime container and its state/workspace data? This cannot be undone.'
      : 'Delete this runtime container? State/workspace data will be kept.';
    if (!confirm(message)) return;
    await api.delete<ApiResponse<null>>(`/api/agent-instances/${selected.containerName}${removeData ? '?data=true' : ''}`);
    terminalSocket?.close();
    setSelected(null);
    await load();
  }

  function closePanel() {
    terminalSocket?.close();
    setSelected(null);
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
                    <button className="btn-secondary text-xs" onClick={() => openPanel(row, 'config')}>
                      <Settings className="h-3.5 w-3.5" /> Config
                    </button>
                    <button className="btn-secondary text-xs" onClick={() => openPanel(row, 'logs')}>
                      <FileText className="h-3.5 w-3.5" /> Logs
                    </button>
                    <button className="btn-secondary text-xs" onClick={() => openPanel(row, 'terminal')} disabled={!row.runtime?.running}>
                      <Terminal className="h-3.5 w-3.5" /> Terminal
                    </button>
                    <button className="btn-secondary text-xs" onClick={() => openPanel(row, 'more')}>
                      <MoreHorizontal className="h-3.5 w-3.5" /> More
                    </button>
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
      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
          <div className="h-full w-full max-w-5xl overflow-y-auto bg-white shadow-2xl">
            <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">{selected.backend?.name ?? 'Runtime agent'}</h2>
                  <p className="mt-1 font-mono text-xs text-gray-400">{selected.containerName}</p>
                </div>
                <button className="text-gray-400 hover:text-gray-600" onClick={closePanel}><X className="h-5 w-5" /></button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <TabButton active={tab === 'config'} onClick={() => void switchTab('config')} icon={Settings} label="Config" />
                <TabButton active={tab === 'logs'} onClick={() => void switchTab('logs')} icon={FileText} label="Logs" />
                <TabButton active={tab === 'terminal'} onClick={() => void switchTab('terminal')} icon={Terminal} label="Terminal" />
                <TabButton active={tab === 'more'} onClick={() => void switchTab('more')} icon={MoreHorizontal} label="More" />
              </div>
            </div>
            <div className="p-6">
              {panelLoading && <div className="mb-4 flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>}
              {tab === 'config' && (
                <div className="space-y-4">
                  <InfoGrid selected={selected} />
                  <div className="rounded-lg border border-gray-200 p-4">
                    <h3 className="font-medium text-gray-900">Model configuration</h3>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Model provider</label>
                        <select className="input" value={runtimeModelProviderId} onChange={(e) => {
                          const provider = config?.modelProviders.find((item) => item.id === e.target.value);
                          setRuntimeModelProviderId(e.target.value);
                          setRuntimeModel(provider?.models?.[0] ?? runtimeModel);
                        }}>
                          {(config?.modelProviders ?? []).map((provider) => (
                            <option key={provider.id} value={provider.id}>{provider.name} · {provider.provider}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="label">Model</label>
                        <select className="input font-mono text-xs" value={runtimeModel} onChange={(e) => setRuntimeModel(e.target.value)}>
                          {(config?.modelProviders.find((provider) => provider.id === runtimeModelProviderId)?.models ?? []).map((model) => (
                            <option key={model} value={model}>{model}</option>
                          ))}
                          {runtimeModel && !(config?.modelProviders.find((provider) => provider.id === runtimeModelProviderId)?.models ?? []).includes(runtimeModel) && (
                            <option value={runtimeModel}>{runtimeModel}</option>
                          )}
                        </select>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <button className="btn-primary text-xs" onClick={() => void saveRuntimeModel()} disabled={!runtimeModelProviderId || !runtimeModel || panelLoading}>
                        <Settings className="h-3.5 w-3.5" /> Apply to runtime
                      </button>
                      <p className="text-xs text-gray-400">Applies to this isolated runtime. Restart if OpenClaw keeps the old model in memory.</p>
                    </div>
                  </div>
                  <JsonBlock title="ClawBot manifest" value={config?.manifest} />
                  <JsonBlock title="OpenClaw config" value={config?.openclawConfig} />
                  <JsonBlock title="Docker inspect" value={config?.inspect} />
                </div>
              )}
              {tab === 'logs' && (
                <div className="space-y-3">
                  <div className="flex justify-end">
                    <button className="btn-secondary text-xs" onClick={() => selected && loadPanel(selected.containerName, 'logs')}><RefreshCw className="h-3.5 w-3.5" /> Refresh logs</button>
                  </div>
                  <pre className="min-h-[520px] overflow-auto rounded-lg bg-gray-950 p-4 text-xs leading-relaxed text-gray-100">{logs || 'No logs returned.'}</pre>
                </div>
              )}
              {tab === 'terminal' && (
                <div className="space-y-5">
                  <div className="rounded-lg border border-gray-200 p-4">
                    <h3 className="font-medium text-gray-900">Interactive terminal</h3>
                    <div className="mt-3 flex gap-2">
                      <button className="btn-primary text-xs" onClick={connectTerminal} disabled={!selected.runtime?.running}>
                        <Terminal className="h-3.5 w-3.5" /> {terminalSocket ? 'Reconnect shell' : 'Connect shell'}
                      </button>
                    </div>
                    <pre
                      ref={terminalViewportRef}
                      tabIndex={0}
                      role="textbox"
                      aria-label="Interactive terminal"
                      spellCheck={false}
                      onClick={() => terminalViewportRef.current?.focus()}
                      onKeyDown={handleTerminalKeyDown}
                      onPaste={handleTerminalPaste}
                      className="mt-3 min-h-[360px] cursor-text overflow-auto rounded-lg bg-gray-950 p-4 font-mono text-xs leading-relaxed text-gray-100 outline-none ring-0 focus:ring-2 focus:ring-teal-500"
                    >{terminalOutput || 'Connect to open a live shell, then click here and type directly.'}</pre>
                    <p className="mt-2 text-xs text-gray-400">Click the terminal area to type. Paste, Enter, Tab, arrows, Ctrl+C, Ctrl+D and Ctrl+L are passed through to the shell.</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 p-4">
                    <h3 className="font-medium text-gray-900">Quick command</h3>
                    <div className="mt-3 flex gap-2">
                    <input className="input font-mono text-xs" value={terminalCommand} onChange={(e) => setTerminalCommand(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void runTerminalCommand(); }} />
                    <button className="btn-primary" onClick={() => void runTerminalCommand()} disabled={!selected.runtime?.running || panelLoading}>
                      <Send className="h-4 w-4" /> Run
                    </button>
                  </div>
                  <p className="text-xs text-gray-400">Runs inside the selected OpenClaw container as a short-lived command.</p>
                  <pre className="min-h-[420px] overflow-auto rounded-lg bg-gray-950 p-4 text-xs leading-relaxed text-gray-100">{quickCommandOutput || 'Command output will appear here.'}</pre>
                  </div>
                </div>
              )}
              {tab === 'more' && (
                <div className="space-y-5">
                  <InfoGrid selected={selected} />
                  <div className="rounded-lg border border-gray-200 p-4">
                    <h3 className="font-medium text-gray-900">Runtime actions</h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button className="btn-secondary text-xs" onClick={() => runtimeAction(selected.containerName, 'start')} disabled={selected.runtime?.running === true}><Play className="h-3.5 w-3.5" /> Start</button>
                      <button className="btn-secondary text-xs" onClick={() => runtimeAction(selected.containerName, 'restart')} disabled={!selected.runtime}><RotateCw className="h-3.5 w-3.5" /> Restart</button>
                      <button className="btn-secondary text-xs" onClick={() => runtimeAction(selected.containerName, 'stop')} disabled={selected.runtime?.running !== true}><Square className="h-3.5 w-3.5" /> Stop</button>
                    </div>
                  </div>
                  <JsonBlock title="Version" value={config?.version ?? selected.agentTemplateVersion} />
                  <div className="rounded-lg border border-red-200 bg-red-50 p-4">
                    <h3 className="font-medium text-red-900">Delete runtime</h3>
                    <p className="mt-1 text-sm text-red-700">Delete only removes the container. Delete with data also removes this user's isolated state and workspace.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button className="btn-secondary text-xs text-red-600 hover:text-red-700" onClick={() => void deleteRuntime(false)}><Trash2 className="h-3.5 w-3.5" /> Delete container</button>
                      <button className="btn-secondary text-xs text-red-600 hover:text-red-700" onClick={() => void deleteRuntime(true)}><Trash2 className="h-3.5 w-3.5" /> Delete container and data</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Settings; label: string }) {
  return (
    <button
      className={active ? 'btn-primary text-xs' : 'btn-secondary text-xs'}
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" /> {label}
    </button>
  );
}

function InfoGrid({ selected }: { selected: AgentInstance }) {
  return (
    <div className="grid grid-cols-2 gap-3 text-xs lg:grid-cols-4">
      <Info label="Channel" value={`${selected.channel.name} · ${selected.channel.type}`} />
      <Info label="End user" value={selected.endUser.name ?? selected.endUser.externalId} />
      <Info label="Model" value={selected.modelProvider?.name ?? 'default'} />
      <Info label="Template version" value={selected.agentTemplateVersion ? `v${selected.agentTemplateVersion.version}` : 'draft'} />
      <Info label="State dir" value={selected.stateDir} mono />
      <Info label="Workspace dir" value={selected.workspaceDir} mono />
      <Info label="Conversation" value={selected.conversationId} mono />
      <Info label="Status" value={`${selected.runtime?.status ?? 'missing'}${selected.runtime?.health ? ` · ${selected.runtime.health}` : ''}`} />
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded bg-gray-50 p-3">
      <p className="text-gray-400">{label}</p>
      <p className={`mt-1 truncate text-gray-700 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div>
      <h3 className="mb-2 font-medium text-gray-900">{title}</h3>
      <pre className="max-h-[520px] overflow-auto rounded-lg bg-gray-950 p-4 text-xs leading-relaxed text-gray-100">{JSON.stringify(value ?? null, null, 2)}</pre>
    </div>
  );
}
