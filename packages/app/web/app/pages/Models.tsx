import { useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, Save, Trash2, X, KeyRound, RefreshCw, FlaskConical, Play } from 'lucide-react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import type { ApiResponse, ModelProvider, ModelProviderType } from '@clawscale/shared';
import { MODEL_PROVIDER_DESCRIPTORS, MODEL_PROVIDER_TYPES } from '@clawscale/shared';

type ModelRow = Omit<ModelProvider, 'apiKey'> & { apiKeySet?: boolean };

type ModelForm = {
  name: string;
  provider: ModelProviderType;
  baseUrl: string;
  apiKey: string;
  modelsText: string;
  isActive: boolean;
};

const emptyForm: ModelForm = {
  name: '',
  provider: 'openai',
  baseUrl: MODEL_PROVIDER_DESCRIPTORS.openai.defaultBaseUrl ?? '',
  apiKey: '',
  modelsText: '',
  isActive: true,
};

export default function Models() {
  const isAdmin = getUser()?.role === 'admin';
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ModelForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);
  const [result, setResult] = useState('');

  async function load() {
    const res = await api.get<ApiResponse<ModelRow[]>>('/api/models');
    if (res.ok) setRows(res.data);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setError('');
    setShowForm(true);
  }

  function openEdit(row: ModelRow) {
    setEditingId(row.id);
    setForm({
      name: row.name,
      provider: row.provider as ModelProviderType,
      baseUrl: row.baseUrl ?? '',
      apiKey: '',
      modelsText: (row.models ?? []).join('\n'),
      isActive: row.isActive,
    });
    setError('');
    setShowForm(true);
  }

  function updateProvider(provider: ModelProviderType) {
    const descriptor = MODEL_PROVIDER_DESCRIPTORS[provider];
    setForm((f) => ({
      ...f,
      provider,
      baseUrl: descriptor.defaultBaseUrl ?? f.baseUrl,
      modelsText: f.modelsText || descriptor.modelPlaceholder,
    }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        name: form.name,
        provider: form.provider,
        baseUrl: form.baseUrl,
        ...(form.apiKey ? { apiKey: form.apiKey } : {}),
        models: form.modelsText.split('\n').map((m) => m.trim()).filter(Boolean),
        isActive: form.isActive,
        config: {},
      };
      const res = editingId
        ? await api.patch<ApiResponse<ModelRow>>(`/api/models/${editingId}`, payload)
        : await api.post<ApiResponse<ModelRow>>('/api/models', payload);
      if (!res.ok) { setError(typeof res.error === 'string' ? res.error : JSON.stringify(res.error)); return; }
      setShowForm(false);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this model provider? Agents using it will be detached.')) return;
    const res = await api.delete<ApiResponse<null>>(`/api/models/${id}`);
    if (res.ok) setRows((prev) => prev.filter((row) => row.id !== id));
  }

  async function testProvider(id: string) {
    setActionId(id); setResult('');
    try {
      const res = await api.post<ApiResponse<{ latencyMs: number; models: string[] }>>(`/api/models/${id}/test`, {});
      setResult(res.ok ? `Connected in ${res.data.latencyMs}ms. Models: ${res.data.models.slice(0, 8).join(', ') || 'none returned'}` : `Test failed: ${res.error}`);
    } finally { setActionId(null); }
  }

  async function syncProvider(id: string) {
    setActionId(id); setResult('');
    try {
      const res = await api.post<ApiResponse<ModelRow>>(`/api/models/${id}/sync`, {});
      if (res.ok) {
        setResult(`Synced ${(res.data.models ?? []).length} models.`);
        await load();
      } else {
        setResult(`Sync failed: ${res.error}`);
      }
    } finally { setActionId(null); }
  }

  async function runProvider(row: ModelRow) {
    const prompt = window.prompt('Test prompt', 'Reply with OK.');
    if (!prompt) return;
    const model = row.models?.[0];
    setActionId(row.id); setResult('');
    try {
      const res = await api.post<ApiResponse<{ latencyMs: number; model: string; reply: string }>>(`/api/models/${row.id}/run`, { prompt, model });
      setResult(res.ok ? `Run ${res.data.model} in ${res.data.latencyMs}ms:\n${res.data.reply}` : `Run failed: ${res.error}`);
    } finally { setActionId(null); }
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Models</h1>
          <p className="text-gray-500 mt-1">Manage reusable LLM provider accounts and model pools.</p>
        </div>
        {isAdmin && <button className="btn-primary" onClick={openCreate}><Plus className="h-4 w-4" /> Add model provider</button>}
      </div>

      {showForm && (
        <div className="card p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900">{editingId ? 'Edit model provider' : 'New model provider'}</h2>
            <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
          </div>
          <form onSubmit={save} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Name</label>
                <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Production OpenAI" required />
              </div>
              <div>
                <label className="label">Provider</label>
                <select className="input" value={form.provider} onChange={(e) => updateProvider(e.target.value as ModelProviderType)}>
                  {MODEL_PROVIDER_TYPES.map((type) => <option key={type} value={type}>{MODEL_PROVIDER_DESCRIPTORS[type].label}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="label">Base URL</label>
              <input className="input font-mono text-xs" value={form.baseUrl} onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))} placeholder={MODEL_PROVIDER_DESCRIPTORS[form.provider].defaultBaseUrl ?? 'https://api.example.com/v1'} />
            </div>
            <div>
              <label className="label">{MODEL_PROVIDER_DESCRIPTORS[form.provider].authLabel}</label>
              <input className="input font-mono text-xs" type="password" value={form.apiKey} onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))} placeholder={editingId ? 'Leave blank to keep existing key' : 'sk-...'} />
            </div>
            <div>
              <label className="label">Models</label>
              <textarea className="input min-h-[110px] font-mono text-xs" value={form.modelsText} onChange={(e) => setForm((f) => ({ ...f, modelsText: e.target.value }))} placeholder={MODEL_PROVIDER_DESCRIPTORS[form.provider].modelPlaceholder} />
              <p className="text-xs text-gray-400 mt-1">One model id per line. Agents can choose from this pool.</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
              Active
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-3">
              <button type="submit" className="btn-primary" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save</button>
              <button type="button" className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
            </div>
          </form>
        </div>
      )}

      {result && (
        <div className="mb-6 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-900 whitespace-pre-wrap">
          {result}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>
      ) : rows.length === 0 ? (
        <div className="card p-10 text-center">
          <KeyRound className="h-9 w-9 text-gray-300 mx-auto mb-3" />
          <p className="font-medium text-gray-500">No model providers yet</p>
          <p className="text-sm text-gray-400 mt-1">Add OpenAI, Anthropic, MiniMax, Ollama, OpenRouter, or another compatible provider.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {rows.map((row) => (
            <div key={row.id} className="card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-gray-900">{row.name}</h2>
                    {!row.isActive && <span className="badge-gray">inactive</span>}
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{MODEL_PROVIDER_DESCRIPTORS[row.provider as ModelProviderType]?.label ?? row.provider}</p>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-1">
                    <button className="p-1.5 text-gray-400 hover:text-teal-600" onClick={() => testProvider(row.id)} title="Test connection" disabled={actionId === row.id}>
                      {actionId === row.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
                    </button>
                    <button className="p-1.5 text-gray-400 hover:text-teal-600" onClick={() => syncProvider(row.id)} title="Sync models" disabled={actionId === row.id}>
                      <RefreshCw className="h-4 w-4" />
                    </button>
                    <button className="p-1.5 text-gray-400 hover:text-teal-600" onClick={() => runProvider(row)} title="Run test prompt" disabled={actionId === row.id}>
                      <Play className="h-4 w-4" />
                    </button>
                    <button className="p-1.5 text-gray-400 hover:text-gray-700" onClick={() => openEdit(row)} title="Edit"><Pencil className="h-4 w-4" /></button>
                    <button className="p-1.5 text-gray-400 hover:text-red-500" onClick={() => remove(row.id)} title="Delete"><Trash2 className="h-4 w-4" /></button>
                  </div>
                )}
              </div>
              <p className="font-mono text-xs text-gray-400 mt-3 truncate">{row.baseUrl || 'Default provider endpoint'}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(row.models ?? []).slice(0, 5).map((model) => <span key={model} className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{model}</span>)}
              </div>
              <p className="text-xs text-gray-400 mt-3">API key: {row.apiKeySet ? <span className="text-emerald-600">configured</span> : <span className="text-amber-600">not set</span>}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
