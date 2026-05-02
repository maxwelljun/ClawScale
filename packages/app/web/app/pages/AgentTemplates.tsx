import { useEffect, useState } from 'react';
import { BotMessageSquare, Loader2, Pencil, Plus, Rocket, Save, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import type { AgentKnowledgeItem, AgentRuntimeType, AgentSkill, AgentTemplateVersion, AgentWorkspaceFile, AiBackend, ApiResponse, ModelProvider } from '@clawscale/shared';
import { AGENT_RUNTIME_DESCRIPTORS } from '@clawscale/shared';

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
  systemPrompt: string;
  skillsText: string;
  workspaceText: string;
  knowledgeText: string;
  isActive: boolean;
  isDefault: boolean;
};

const emptyForm: AgentForm = {
  name: '',
  runtimeType: 'openclaw',
  modelProviderId: '',
  model: '',
  systemPrompt: '',
  skillsText: 'browser\nmemory\nfiles',
  workspaceText: '# README.md\nAgent workspace notes go here.',
  knowledgeText: '',
  isActive: true,
  isDefault: false,
};

function parseSkills(text: string): AgentSkill[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean).map((name) => ({ name, enabled: true }));
}

function parseWorkspace(text: string): AgentWorkspaceFile[] {
  if (!text.trim()) return [];
  return [{ path: 'README.md', content: text.trim() }];
}

function parseKnowledge(text: string): AgentKnowledgeItem[] {
  return text.split('\n\n').map((block, index) => block.trim()).filter(Boolean).map((content, index) => ({
    title: `Knowledge ${index + 1}`,
    content,
  }));
}

function stringifySkills(skills: AgentSkill[] | undefined): string {
  return (skills ?? []).map((skill) => skill.name).join('\n');
}

function stringifyWorkspace(workspace: AgentWorkspaceFile[] | undefined): string {
  return workspace?.[0]?.content ?? '';
}

function stringifyKnowledge(items: AgentKnowledgeItem[] | undefined): string {
  return (items ?? []).map((item) => item.content).join('\n\n');
}

export default function AgentTemplates() {
  const isAdmin = getUser()?.role === 'admin';
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AgentForm>(emptyForm);
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
    setForm({ ...emptyForm, modelProviderId: models[0]?.id ?? '', model: models[0]?.models?.[0] ?? '' });
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
      systemPrompt: config.systemPrompt ?? '',
      skillsText: stringifySkills(agent.skills),
      workspaceText: stringifyWorkspace(agent.workspace),
      knowledgeText: stringifyKnowledge(agent.knowledgeBase),
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
          systemPrompt: form.systemPrompt || undefined,
        },
        skills: parseSkills(form.skillsText),
        workspace: parseWorkspace(form.workspaceText),
        knowledgeBase: parseKnowledge(form.knowledgeText),
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
                <input className="input font-mono text-xs" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} placeholder="MiniMax-M2.7-highspeed" />
              </div>
            </div>

            <div>
              <label className="label">System prompt</label>
              <textarea className="input min-h-[90px] text-sm" value={form.systemPrompt} onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))} placeholder="Define the agent role, boundaries, and response style." />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Skills</label>
                <textarea className="input min-h-[140px] font-mono text-xs" value={form.skillsText} onChange={(e) => setForm((f) => ({ ...f, skillsText: e.target.value }))} placeholder="browser&#10;memory&#10;files" />
              </div>
              <div>
                <label className="label">Workspace Markdown</label>
                <textarea className="input min-h-[140px] font-mono text-xs" value={form.workspaceText} onChange={(e) => setForm((f) => ({ ...f, workspaceText: e.target.value }))} placeholder="# README.md" />
              </div>
              <div>
                <label className="label">Knowledge base</label>
                <textarea className="input min-h-[140px] text-xs" value={form.knowledgeText} onChange={(e) => setForm((f) => ({ ...f, knowledgeText: e.target.value }))} placeholder="Separate knowledge blocks with blank lines." />
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
                <div className="rounded bg-gray-50 p-2"><p className="text-gray-400">Skills</p><p className="text-gray-700">{agent.skills?.length ?? 0}</p></div>
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
