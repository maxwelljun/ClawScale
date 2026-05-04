import { useEffect, useState } from 'react';
import { BotMessageSquare, Loader2, Pencil, Plus, Rocket, Save, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import type { AgentKnowledgeItem, AgentRuntimeType, AgentTemplateVersion, AgentWorkspaceFile, AiBackend, ApiResponse, ModelProvider } from '@clawscale/shared';
import { AGENT_RUNTIME_DESCRIPTORS, OPENCLAW_DEFAULT_WORKSPACE } from '@clawscale/shared';

type AgentRow = AiBackend & {
  modelProvider?: { id: string; name: string; provider: string } | null;
  versions?: AgentTemplateVersion[];
};
type ModelRow = Omit<ModelProvider, 'apiKey'> & { apiKeySet?: boolean };

type AgentForm = {
  name: string;
  runtimeType: AgentRuntimeType;
  modelProviderId: string;
  model: string;
  workspace: AgentWorkspaceFile[];
  knowledgeBase: AgentKnowledgeItem[];
  workspaceSourcesText: string;
  skillSourcesText: string;
  secretEnvText: string;
  isActive: boolean;
  isDefault: boolean;
};

const emptyForm: AgentForm = {
  name: '',
  runtimeType: 'openclaw',
  modelProviderId: '',
  model: '',
  workspace: OPENCLAW_DEFAULT_WORKSPACE,
  knowledgeBase: [],
  workspaceSourcesText: '',
  skillSourcesText: '',
  secretEnvText: '',
  isActive: true,
  isDefault: false,
};

function freshForm(): AgentForm {
  return {
    ...emptyForm,
    workspace: cloneDefaultWorkspace(),
    knowledgeBase: emptyForm.knowledgeBase.map((item) => ({ ...item })),
  };
}

function cloneDefaultWorkspace(): AgentWorkspaceFile[] {
  return OPENCLAW_DEFAULT_WORKSPACE.map((file) => ({ ...file }));
}

function mergeWithDefaultWorkspace(workspace?: AgentWorkspaceFile[] | null): AgentWorkspaceFile[] {
  const files = workspace?.length ? workspace.map((file) => ({ ...file })) : [];
  const existingPaths = new Set(files.map((file) => file.path.trim().toLowerCase()).filter(Boolean));
  for (const file of OPENCLAW_DEFAULT_WORKSPACE) {
    if (!existingPaths.has(file.path.toLowerCase())) {
      files.push({ ...file });
    }
  }
  return files.length ? files : cloneDefaultWorkspace();
}

function listToText(value: unknown): string {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).join('\n') : '';
}

function textToList(value: string): string[] {
  return value.split('\n').map((item) => item.trim()).filter(Boolean);
}

function secretEnvToText(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  return Object.entries(value)
    .filter(([key, item]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof item === 'string')
    .map(([key, item]) => `${key}=${item}`)
    .join('\n');
}

function textToSecretEnv(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of value.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let item = trimmed.slice(eqIndex + 1).trim();
    if ((item.startsWith('"') && item.endsWith('"')) || (item.startsWith("'") && item.endsWith("'"))) {
      item = item.slice(1, -1);
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) result[key] = item;
  }
  return result;
}

function applyDeepcoinPreset(form: AgentForm): AgentForm {
  return {
    ...form,
    workspaceSourcesText: 'https://github.com/deepcoinapi/agent-skills/tree/main/openclaw',
    skillSourcesText: 'https://github.com/deepcoinapi/agent-skills',
  };
}

export default function AgentTemplates() {
  const isAdmin = getUser()?.role === 'admin';
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AgentForm>(freshForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    const [agentRes, modelRes] = await Promise.all([
      api.get<ApiResponse<AgentRow[]>>('/api/agents'),
      api.get<ApiResponse<ModelRow[]>>('/api/models'),
    ]);
    if (modelRes.ok) setModels(modelRes.data);
    if (agentRes.ok) {
      const versionEntries = await Promise.all(agentRes.data.map(async (agent) => {
        const res = await api.get<ApiResponse<AgentTemplateVersion[]>>(`/api/agents/${agent.id}/versions`);
        return [agent.id, res.ok ? res.data : []] as const;
      }));
      const versionsById = Object.fromEntries(versionEntries);
      setAgents(agentRes.data.map((agent) => ({ ...agent, versions: versionsById[agent.id] ?? [] })));
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  function openCreate() {
    setEditingId(null);
    setForm({ ...freshForm(), modelProviderId: models[0]?.id ?? '', model: models[0]?.models?.[0] ?? '' });
    setError('');
    setShowForm(true);
  }

  function openEdit(agent: AgentRow) {
    const config = agent.config ?? {};
    setEditingId(agent.id);
    setForm({
      name: agent.name,
      runtimeType: (agent.runtimeType as AgentRuntimeType) ?? 'openclaw',
      modelProviderId: agent.modelProviderId ?? '',
      model: config.model ?? '',
      workspace: mergeWithDefaultWorkspace(agent.workspace),
      knowledgeBase: agent.knowledgeBase?.map((item) => ({ ...item })) ?? [],
      workspaceSourcesText: listToText(config.workspaceSources),
      skillSourcesText: listToText(config.skillSources),
      secretEnvText: secretEnvToText(config.secretEnv),
      isActive: agent.isActive,
      isDefault: agent.isDefault,
    });
    setError('');
    setShowForm(true);
  }

  function onModelProviderChange(modelProviderId: string) {
    const provider = models.find((m) => m.id === modelProviderId);
    setForm((f) => ({ ...f, modelProviderId, model: provider?.models?.[0] ?? f.model }));
  }

  function updateWorkspace(index: number, patch: Partial<AgentWorkspaceFile>) {
    setForm((f) => ({ ...f, workspace: f.workspace.map((file, i) => i === index ? { ...file, ...patch } : file) }));
  }

  function updateKnowledge(index: number, patch: Partial<AgentKnowledgeItem>) {
    setForm((f) => ({ ...f, knowledgeBase: f.knowledgeBase.map((item, i) => i === index ? { ...item, ...patch } : item) }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name,
        type: form.runtimeType === 'openclaw' ? 'openclaw' : 'custom',
        runtimeType: form.runtimeType,
        modelProviderId: form.modelProviderId || null,
        config: {
          model: form.model || undefined,
          workspaceSources: textToList(form.workspaceSourcesText),
          skillSources: textToList(form.skillSourcesText),
          secretEnv: textToSecretEnv(form.secretEnvText),
        },
        skills: [],
        workspace: form.workspace.filter((file) => file.path.trim()).map((file) => ({ ...file, path: file.path.trim() })),
        knowledgeBase: form.knowledgeBase.filter((item) => item.title.trim() && item.content.trim()).map((item) => ({ ...item, title: item.title.trim() })),
        isActive: form.isActive,
        isDefault: form.isDefault,
      };
      const res = editingId
        ? await api.patch<ApiResponse<AgentRow>>(`/api/agents/${editingId}`, payload)
        : await api.post<ApiResponse<AgentRow>>('/api/agents', payload);
      if (!res.ok) { setError(typeof res.error === 'string' ? res.error : JSON.stringify(res.error)); return; }
      setShowForm(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this agent template?')) return;
    const res = await api.delete<ApiResponse<null>>(`/api/agents/${id}`);
    if (res.ok) setAgents((prev) => prev.filter((agent) => agent.id !== id));
  }

  async function publish(agent: AgentRow) {
    const notes = window.prompt('Publish notes', `Publish ${agent.name}`);
    if (notes === null) return;
    const res = await api.post<ApiResponse<AgentTemplateVersion>>(`/api/agents/${agent.id}/publish`, { notes });
    if (res.ok) await load();
  }

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Agent Templates</h1>
          <p className="text-gray-500 mt-1">Design reusable agent templates, publish immutable versions, and bind them to channels.</p>
        </div>
        {isAdmin && <button className="btn-primary" onClick={openCreate}><Plus className="h-4 w-4" /> Create template</button>}
      </div>

      {showForm && (
        <div className="card p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">{editingId ? 'Edit agent template' : 'New agent template'}</h2>
            <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
          </div>
          <form onSubmit={save} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Agent name</label>
                <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Sales Assistant" required />
              </div>
              <div>
                <label className="label">Runtime</label>
                <select className="input" value={form.runtimeType} onChange={(e) => setForm((f) => ({ ...f, runtimeType: e.target.value as AgentRuntimeType }))}>
                  {Object.entries(AGENT_RUNTIME_DESCRIPTORS).map(([type, descriptor]) => <option key={type} value={type}>{descriptor.label}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Model provider</label>
                <select className="input" value={form.modelProviderId} onChange={(e) => onModelProviderChange(e.target.value)}>
                  <option value="">No provider</option>
                  {models.filter((m) => m.isActive).map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Model</label>
                <select className="input font-mono text-xs" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}>
                  <option value="">Provider default</option>
                  {(models.find((m) => m.id === form.modelProviderId)?.models ?? []).map((model) => <option key={model} value={model}>{model}</option>)}
                  {form.model && !(models.find((m) => m.id === form.modelProviderId)?.models ?? []).includes(form.model) && <option value={form.model}>{form.model}</option>}
                </select>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">Workspace files</h3>
                  <p className="text-xs text-gray-400">Generated into the isolated OpenClaw workspace. Defaults mirror the OpenClaw workspace template.</p>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn-secondary text-xs" onClick={() => setForm((f) => ({ ...f, workspace: cloneDefaultWorkspace() }))}>Load OpenClaw defaults</button>
                  <button type="button" className="btn-secondary text-xs" onClick={() => setForm((f) => ({ ...f, workspace: [...f.workspace, { path: 'docs/new.md', content: '' }] }))}><Plus className="h-3.5 w-3.5" /> Add file</button>
                </div>
              </div>
              <div className="mt-3 space-y-3">
                {form.workspace.map((file, index) => (
                  <div key={index} className="rounded bg-gray-50 p-3">
                    <div className="mb-2 flex gap-2">
                      <input className="input font-mono text-xs" value={file.path} onChange={(e) => updateWorkspace(index, { path: e.target.value })} placeholder="AGENTS.md" />
                      <button type="button" className="text-gray-400 hover:text-red-500" onClick={() => setForm((f) => ({ ...f, workspace: f.workspace.filter((_, i) => i !== index) }))}><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <textarea className="input min-h-[120px] font-mono text-xs" value={file.content} onChange={(e) => updateWorkspace(index, { content: e.target.value })} placeholder="# Instructions" />
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="font-medium text-gray-900">Runtime sources</h3>
                  <p className="text-xs text-gray-400">Optional GitHub sources are synced when each isolated OpenClaw runtime is created. Workspace sources may overwrite duplicate markdown files.</p>
                </div>
                <button type="button" className="btn-secondary text-xs" onClick={() => setForm((f) => applyDeepcoinPreset(f))}>Load Deepcoin preset</button>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-3">
                <div>
                  <label className="label">Workspace source URLs</label>
                  <textarea
                    className="input min-h-[72px] font-mono text-xs"
                    value={form.workspaceSourcesText}
                    onChange={(e) => setForm((f) => ({ ...f, workspaceSourcesText: e.target.value }))}
                    placeholder="https://github.com/deepcoinapi/agent-skills/tree/main/openclaw"
                  />
                </div>
                <div>
                  <label className="label">Skill source URLs</label>
                  <textarea
                    className="input min-h-[72px] font-mono text-xs"
                    value={form.skillSourcesText}
                    onChange={(e) => setForm((f) => ({ ...f, skillSourcesText: e.target.value }))}
                    placeholder="https://github.com/deepcoinapi/agent-skills"
                  />
                </div>
                <div>
                  <label className="label">Secret env</label>
                  <textarea
                    className="input min-h-[88px] font-mono text-xs"
                    value={form.secretEnvText}
                    onChange={(e) => setForm((f) => ({ ...f, secretEnvText: e.target.value }))}
                    placeholder={'DC_API_KEY=...\nDC_SECRET_KEY=...\nDC_PASSPHRASE=...'}
                  />
                  <p className="mt-1 text-xs text-gray-400">Injected as container env only. Updating values recreates the runtime container while preserving state and workspace data.</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">Knowledge base</h3>
                  <p className="text-xs text-gray-400">Small knowledge is materialized into docs/knowledge.md. Large RAG indexing is planned for the next phase.</p>
                </div>
                <button type="button" className="btn-secondary text-xs" onClick={() => setForm((f) => ({ ...f, knowledgeBase: [...f.knowledgeBase, { title: 'New knowledge', content: '' }] }))}><Plus className="h-3.5 w-3.5" /> Add knowledge</button>
              </div>
              <div className="mt-3 space-y-3">
                {form.knowledgeBase.map((item, index) => (
                  <div key={index} className="rounded bg-gray-50 p-3">
                    <div className="mb-2 flex gap-2">
                      <input className="input text-xs" value={item.title} onChange={(e) => updateKnowledge(index, { title: e.target.value })} placeholder="Policy" />
                      <button type="button" className="text-gray-400 hover:text-red-500" onClick={() => setForm((f) => ({ ...f, knowledgeBase: f.knowledgeBase.filter((_, i) => i !== index) }))}><Trash2 className="h-4 w-4" /></button>
                    </div>
                    <textarea className="input min-h-[100px] text-xs" value={item.content} onChange={(e) => updateKnowledge(index, { content: e.target.value })} placeholder="Knowledge content" />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> Active</label>
              <label className="flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={form.isDefault} onChange={(e) => setForm((f) => ({ ...f, isDefault: e.target.checked }))} /> Default fallback agent</label>
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3">
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save</button>
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>
      ) : agents.length === 0 ? (
        <div className="card p-10 text-center">
          <BotMessageSquare className="h-9 w-9 text-gray-300 mx-auto mb-3" />
          <p className="font-medium text-gray-500">No agent templates yet</p>
          <p className="text-sm text-gray-400 mt-1">Create an OpenClaw or Hermass runtime template and bind it to a channel.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {agents.map((agent) => (
            <div key={agent.id} className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-gray-900">{agent.name}</h2>
                    {agent.isDefault && <span className="badge-yellow">default</span>}
                    {!agent.isActive && <span className="badge-gray">inactive</span>}
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{AGENT_RUNTIME_DESCRIPTORS[(agent.runtimeType as AgentRuntimeType) ?? 'openclaw']?.label ?? agent.runtimeType}</p>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1">
                    <button className="p-1.5 text-gray-400 hover:text-teal-600" onClick={() => publish(agent)} title="Publish version"><Rocket className="h-4 w-4" /></button>
                    <button className="p-1.5 text-gray-400 hover:text-gray-700" onClick={() => openEdit(agent)} title="Edit"><Pencil className="h-4 w-4" /></button>
                    <button className="p-1.5 text-gray-400 hover:text-red-500" onClick={() => remove(agent.id)} title="Delete"><Trash2 className="h-4 w-4" /></button>
                  </div>
                )}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
                <div className="rounded bg-gray-50 p-2"><p className="text-gray-400">Model</p><p className="font-mono text-gray-700 truncate">{agent.config?.model ?? agent.modelProvider?.name ?? 'none'}</p></div>
                <div className="rounded bg-gray-50 p-2"><p className="text-gray-400">Workspace</p><p className="text-gray-700">{agent.workspace?.length ?? 0}</p></div>
                <div className="rounded bg-gray-50 p-2"><p className="text-gray-400">Latest</p><p className="text-gray-700">{agent.versions?.[0] ? `v${agent.versions[0].version}` : 'draft'}</p></div>
              </div>
              {agent.versions && agent.versions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {agent.versions.slice(0, 4).map((version) => (
                    <span key={version.id} className="badge-gray">v{version.version}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
