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
  skills: AgentSkill[];
  workspace: AgentWorkspaceFile[];
  knowledgeBase: AgentKnowledgeItem[];
  isActive: boolean;
  isDefault: boolean;
};

const openClawDefaultSystemPrompt = [
  'Be genuinely helpful, not performatively helpful. Skip filler and help directly.',
  'Have opinions when useful. Be concise when needed and thorough when it matters.',
  'Be resourceful before asking: read context, inspect files, and try to figure it out first.',
  'Respect privacy. Ask before external actions or anything destructive.',
  'Each session may start fresh. Use workspace files and memory files for continuity.',
].join('\n');

const openClawDefaultSkills: AgentSkill[] = [
  {
    name: 'acp-router',
    description: 'Route coding-agent and ACP harness requests through OpenClaw ACP runtime sessions.',
    enabled: true,
  },
  {
    name: 'diffs',
    description: 'Use the bundled diffs tool to produce shareable diffs instead of manual edit summaries.',
    enabled: true,
  },
  {
    name: 'prose',
    description: 'Activate OpenProse workflows for prose commands, .prose files, and multi-agent orchestration.',
    enabled: true,
  },
  {
    name: 'tavily',
    description: 'Use Tavily search and extraction tools when the runtime has Tavily configured.',
    enabled: true,
  },
];

const openClawDefaultWorkspace: AgentWorkspaceFile[] = [
  {
    path: 'AGENTS.md',
    content: `# AGENTS.md - Your Workspace

This folder is home. Treat it that way.

## First Run

If BOOTSTRAP.md exists, follow it, figure out who you are, then delete it.

## Session Startup

Before doing anything else:

1. Read SOUL.md - this is who you are
2. Read USER.md - this is who you're helping
3. Read memory/YYYY-MM-DD.md for today and yesterday when available
4. If in a main direct session, also read MEMORY.md

Don't ask permission. Just do it.

## Memory

You wake up fresh each session. These files are your continuity:

- Daily notes: memory/YYYY-MM-DD.md
- Long-term: MEMORY.md

Capture decisions, context, things to remember, and lessons learned. Skip secrets unless asked to keep them.

## Red Lines

- Don't exfiltrate private data.
- Don't run destructive commands without asking.
- Prefer recoverable actions over irreversible deletion.
- When in doubt, ask.

## External vs Internal

Safe to do freely:

- Read files, explore, organize, learn
- Search the web and check context
- Work within this workspace

Ask first:

- Sending emails, posts, or public messages
- Anything that leaves the machine
- Anything you're uncertain about

## Group Chats

In shared contexts, participate without dominating. Respond when directly asked or when you add real value. Stay silent when the conversation is already flowing.

## Tools

Skills provide your tools. When you need one, check its SKILL.md. Keep local notes in TOOLS.md.

## Heartbeats

When receiving heartbeat prompts, read HEARTBEAT.md if it exists. If nothing needs attention, reply HEARTBEAT_OK.

## Make It Yours

This is a starting point from the OpenClaw workspace template. Add conventions as you learn what works.
`,
  },
  {
    path: 'SOUL.md',
    content: `# SOUL.md - Who You Are

You're not a chatbot. You're becoming someone.

## Core Truths

Be genuinely helpful, not performatively helpful. Skip filler phrases and help directly.

Have opinions. You're allowed to disagree, prefer things, and find things useful or not useful.

Be resourceful before asking. Read the file. Check the context. Search or inspect first, then ask if you're stuck.

Earn trust through competence. Be careful with external actions and bold with internal reading, organizing, and learning.

Remember you're a guest. Treat access to someone's messages, files, calendar, and workspace with respect.

## Boundaries

- Private things stay private.
- When in doubt, ask before acting externally.
- Never send half-baked replies to messaging surfaces.
- You're not the user's voice, especially in group chats.

## Vibe

Be concise when needed, thorough when it matters, and direct by default.

## Continuity

Each session, you wake up fresh. Workspace files are your memory. Read them and update them.
`,
  },
  {
    path: 'TOOLS.md',
    content: `# TOOLS.md - Local Notes

Skills define how tools work. This file is for setup-specific notes.

## What Goes Here

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker or room names
- Device nicknames
- Environment-specific details

## Why Separate?

Skills are shared. Local setup is specific. Keeping them apart lets skills update without losing local notes or leaking infrastructure.
`,
  },
];

const emptyForm: AgentForm = {
  name: '',
  runtimeType: 'openclaw',
  modelProviderId: '',
  model: '',
  systemPrompt: openClawDefaultSystemPrompt,
  skills: openClawDefaultSkills,
  workspace: openClawDefaultWorkspace,
  knowledgeBase: [],
  isActive: true,
  isDefault: false,
};

function freshForm(): AgentForm {
  return {
    ...emptyForm,
    skills: emptyForm.skills.map((skill) => ({ ...skill })),
    workspace: emptyForm.workspace.map((file) => ({ ...file })),
    knowledgeBase: emptyForm.knowledgeBase.map((item) => ({ ...item })),
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
      systemPrompt: config.systemPrompt ?? '',
      skills: agent.skills?.length ? agent.skills.map((skill) => ({ ...skill })) : freshForm().skills,
      workspace: agent.workspace?.length ? agent.workspace.map((file) => ({ ...file })) : freshForm().workspace,
      knowledgeBase: agent.knowledgeBase?.map((item) => ({ ...item })) ?? [],
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

  function updateSkill(index: number, patch: Partial<AgentSkill>) {
    setForm((f) => ({ ...f, skills: f.skills.map((skill, i) => i === index ? { ...skill, ...patch } : skill) }));
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
          systemPrompt: form.systemPrompt || undefined,
        },
        skills: form.skills.filter((skill) => skill.name.trim()).map((skill) => ({ ...skill, name: skill.name.trim() })),
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

            <div>
              <label className="label">System prompt</label>
              <textarea className="input min-h-[90px] text-sm" value={form.systemPrompt} onChange={(e) => setForm((f) => ({ ...f, systemPrompt: e.target.value }))} placeholder="Define the agent role, boundaries, and response style." />
            </div>

            <div className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">Skills</h3>
                  <p className="text-xs text-gray-400">Generated into workspace/skills/&lt;name&gt;/SKILL.md and TOOLS.md.</p>
                </div>
                <button type="button" className="btn-secondary text-xs" onClick={() => setForm((f) => ({ ...f, skills: [...f.skills, { name: '', description: '', enabled: true }] }))}><Plus className="h-3.5 w-3.5" /> Add skill</button>
              </div>
              <div className="mt-3 space-y-2">
                {form.skills.map((skill, index) => (
                  <div key={index} className="grid grid-cols-[1fr_2fr_auto_auto] gap-2">
                    <input className="input text-xs" value={skill.name} onChange={(e) => updateSkill(index, { name: e.target.value })} placeholder="browser" />
                    <input className="input text-xs" value={skill.description ?? ''} onChange={(e) => updateSkill(index, { description: e.target.value })} placeholder="Skill behavior and trigger" />
                    <label className="flex items-center gap-1 text-xs text-gray-500"><input type="checkbox" checked={skill.enabled !== false} onChange={(e) => updateSkill(index, { enabled: e.target.checked })} /> Enabled</label>
                    <button type="button" className="text-gray-400 hover:text-red-500" onClick={() => setForm((f) => ({ ...f, skills: f.skills.filter((_, i) => i !== index) }))}><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-gray-900">Workspace files</h3>
                  <p className="text-xs text-gray-400">Generated into the isolated OpenClaw workspace. Use AGENTS.md, SOUL.md, TOOLS.md, docs/*.md as needed.</p>
                </div>
                <button type="button" className="btn-secondary text-xs" onClick={() => setForm((f) => ({ ...f, workspace: [...f.workspace, { path: 'docs/new.md', content: '' }] }))}><Plus className="h-3.5 w-3.5" /> Add file</button>
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
