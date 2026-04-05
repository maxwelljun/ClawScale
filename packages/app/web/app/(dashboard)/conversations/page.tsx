'use client';
import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2, MessageSquare, ChevronRight, Trash2, ArrowLeft, User, Bot, FileText, Image as ImageIcon, Music, Film, Paperclip } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { formatDateTime, cn } from '@/lib/utils';
import type { ApiResponse, Conversation } from '@clawscale/shared';

function ConversationDetail({ id }: { id: string }) {
  const router = useRouter();
  const [conv, setConv] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    api.get<ApiResponse<Conversation>>(`/api/conversations/${id}`).then((r) => {
      if (r.ok) setConv(r.data);
      setLoading(false);
    });
  }, [id]);

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>;
  if (!conv) return <div className="p-8 text-gray-500">Conversation not found.</div>;

  async function handleDelete() {
    if (!confirm('Delete this conversation and all its messages? This cannot be undone.')) return;
    setDeleting(true);
    const res = await api.delete<{ ok: boolean }>(`/api/conversations/${id}`);
    if (res.ok) {
      router.push('/conversations');
    } else {
      setDeleting(false);
      alert('Failed to delete conversation.');
    }
  }

  const displayName = conv.endUser?.name ?? conv.endUser?.externalId ?? 'Anonymous';

  return (
    <div className="p-8 max-w-3xl">
      <Link href="/conversations" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-6 transition-colors">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>

      <div className="card p-5 mb-6 flex items-center gap-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 text-lg font-semibold">
          {displayName[0]?.toUpperCase()}
        </div>
        <div className="flex-1">
          <p className="font-semibold text-gray-900">{displayName}</p>
          <p className="text-sm text-gray-400">
            {conv.channel?.name} · {conv.channel?.type}
            {conv.endUser?.email && ` · ${conv.endUser.email}`}
          </p>
        </div>
        {conv.endUser?.status === 'blocked' && (
          <span className="badge-red text-xs">Blocked</span>
        )}
        <button onClick={handleDelete} disabled={deleting}
          className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700 transition-colors disabled:opacity-50">
          {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Delete
        </button>
      </div>

      <div className="space-y-4">
        {(conv.messages ?? []).map((msg) => (
          <div key={msg.id} className={cn('flex gap-3', msg.role === 'assistant' ? 'flex-row-reverse' : '')}>
            <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs',
              msg.role === 'user' ? 'bg-gray-100 text-gray-600' : 'bg-teal-500/20 text-teal-600')}>
              {msg.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
            </div>
            <div className={cn('max-w-[75%] rounded-2xl px-4 py-2.5 text-sm',
              msg.role === 'user' ? 'bg-white border border-gray-200 text-gray-900' : 'bg-teal-500 text-white')}>
              <p className="whitespace-pre-wrap">{msg.content}</p>
              {msg.metadata?.attachments?.map((att, i) => {
                const isImage = att.contentType.startsWith('image/');
                const isAudio = att.contentType.startsWith('audio/');
                const isVideo = att.contentType.startsWith('video/');
                const Icon = isImage ? ImageIcon : isAudio ? Music : isVideo ? Film : att.contentType === 'application/pdf' ? FileText : Paperclip;
                return (
                  <div key={i} className={cn('mt-2 flex items-center gap-2 rounded-lg px-3 py-2 text-xs',
                    msg.role === 'user' ? 'bg-gray-50 text-gray-600' : 'bg-teal-600/50 text-teal-50')}>
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{att.filename}</span>
                    {att.size != null && <span className="shrink-0 opacity-60">{(att.size / 1024).toFixed(0)} KB</span>}
                  </div>
                );
              })}
              <p className={cn('text-[10px] mt-1', msg.role === 'user' ? 'text-gray-400' : 'text-teal-100')}>
                {formatDateTime(msg.createdAt)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Conversations() {
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('id');

  if (selectedId) return <ConversationDetail id={selectedId} />;

  return <ConversationList />;
}

function ConversationList() {
  const [rows, setRows] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<ApiResponse<Conversation[]>>('/api/conversations').then((r) => {
      if (r.ok) setRows(r.data);
      setLoading(false);
    });
  }, []);

  async function handleDelete(e: React.MouseEvent, id: string) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Delete this conversation and all its messages?')) return;
    const res = await api.delete<{ ok: boolean }>(`/api/conversations/${id}`);
    if (res.ok) setRows((prev) => prev.filter((c) => c.id !== id));
  }

  if (loading) return <div className="flex items-center justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>;

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">Conversations</h1>
        <p className="text-gray-500 mt-1">All conversations end-users are having with your bot.</p>
      </div>

      {rows.length === 0 ? (
        <div className="card p-12 text-center">
          <MessageSquare className="h-10 w-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No conversations yet. Connect a channel to get started.</p>
          <Link href="/channels" className="btn-primary inline-flex mt-4">Go to Channels</Link>
        </div>
      ) : (
        <div className="card divide-y divide-gray-100">
          {rows.map((conv) => (
            <Link key={conv.id} href={`/conversations?id=${conv.id}`}
              className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors group">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-teal-600 text-sm font-semibold">
                {(conv.endUser?.name ?? conv.endUser?.externalId ?? '?')[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {conv.endUser?.name ?? conv.endUser?.externalId ?? 'Anonymous'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {conv.channel?.name} · {conv.channel?.type} · {(conv._count?.messages ?? 0)} messages
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-gray-400">{formatDateTime(conv.updatedAt)}</p>
                {conv.endUser?.status === 'blocked' && (
                  <span className="text-xs text-red-500 font-medium">Blocked</span>
                )}
              </div>
              <button onClick={(e) => handleDelete(e, conv.id)}
                className="p-1.5 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
                title="Delete conversation">
                <Trash2 className="h-4 w-4" />
              </button>
              <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-teal-500 transition-colors shrink-0" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
