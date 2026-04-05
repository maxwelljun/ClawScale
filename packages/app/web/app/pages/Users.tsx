import { useEffect, useState } from 'react';
import { UserPlus, Loader2, Trash2, Shield, Eye, User } from 'lucide-react';
import { api } from '@/lib/api';
import { getUser } from '@/lib/auth';
import { cn, formatDate } from '@/lib/utils';
import type { ApiResponse, PublicUser, UserRole } from '@clawscale/shared';

const ROLE_ICONS: Record<UserRole, React.ReactNode> = {
  admin: <Shield className="h-3.5 w-3.5" />,
  member: <User className="h-3.5 w-3.5" />,
  viewer: <Eye className="h-3.5 w-3.5" />,
};

const ROLE_BADGE: Record<UserRole, string> = {
  admin: 'badge-teal', member: 'badge-gray', viewer: 'badge-yellow',
};

interface InviteForm { email: string; name: string; role: UserRole; temporaryPassword: string }

export default function Users() {
  const me = getUser();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState<InviteForm>({ email: '', name: '', role: 'member', temporaryPassword: '' });
  const [inviteError, setInviteError] = useState('');
  const [inviting, setInviting] = useState(false);

  async function loadUsers() {
    const res = await api.get<ApiResponse<PublicUser[]>>('/api/users');
    if (res.ok) setUsers(res.data);
    setLoading(false);
  }

  useEffect(() => { void loadUsers(); }, []);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteError('');
    setInviting(true);
    try {
      const res = await api.post<ApiResponse<PublicUser>>('/api/users', inviteForm);
      if (!res.ok) { setInviteError(res.error); return; }
      setUsers((prev) => [...prev, res.data]);
      setShowInvite(false);
      setInviteForm({ email: '', name: '', role: 'member', temporaryPassword: '' });
    } finally { setInviting(false); }
  }

  async function handleDeactivate(userId: string) {
    if (!confirm('Deactivate this user? They will lose access immediately.')) return;
    const res = await api.delete<ApiResponse<null>>(`/api/users/${userId}`);
    if (res.ok) setUsers((prev) => prev.filter((u) => u.id !== userId));
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Members</h1>
          <p className="text-gray-500 mt-1">Manage project admins, developers, and viewers who can access the dashboard.</p>
        </div>
        {me?.role === 'admin' && (
          <button className="btn-primary" onClick={() => setShowInvite(true)}>
            <UserPlus className="h-4 w-4" /> Invite member
          </button>
        )}
      </div>

      {showInvite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="card w-full max-w-md p-6">
            <h2 className="text-lg font-semibold mb-4">Invite a team member</h2>
            {inviteError && <div className="mb-3 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-600">{inviteError}</div>}
            <form onSubmit={handleInvite} className="space-y-4">
              <div>
                <label className="label">Name</label>
                <input className="input" placeholder="Jane Smith" value={inviteForm.name}
                  onChange={(e) => setInviteForm((p) => ({ ...p, name: e.target.value }))} required />
              </div>
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" placeholder="jane@acme.com" value={inviteForm.email}
                  onChange={(e) => setInviteForm((p) => ({ ...p, email: e.target.value }))} required />
              </div>
              <div>
                <label className="label">Role</label>
                <select className="input" value={inviteForm.role}
                  onChange={(e) => setInviteForm((p) => ({ ...p, role: e.target.value as UserRole }))}>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              </div>
              <div>
                <label className="label">Temporary password</label>
                <input className="input" type="password" placeholder="Min. 8 characters" value={inviteForm.temporaryPassword}
                  minLength={8} onChange={(e) => setInviteForm((p) => ({ ...p, temporaryPassword: e.target.value }))} required />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="submit" className="btn-primary flex-1" disabled={inviting}>
                  {inviting && <Loader2 className="h-4 w-4 animate-spin" />} Send invite
                </button>
                <button type="button" className="btn-secondary flex-1" onClick={() => setShowInvite(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-teal-500" /></div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-5 py-3 text-left font-medium text-gray-500">Member</th>
                <th className="px-5 py-3 text-left font-medium text-gray-500">Role</th>
                <th className="px-5 py-3 text-left font-medium text-gray-500">Joined</th>
                <th className="px-5 py-3 text-left font-medium text-gray-500">Last active</th>
                {me?.role === 'admin' && <th className="px-5 py-3 text-right font-medium text-gray-500">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map((u) => (
                <tr key={u.id} className={cn('hover:bg-gray-50/50', !u.isActive && 'opacity-50')}>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-50 text-teal-600 font-semibold text-sm">
                        {u.name[0]?.toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{u.name}</p>
                        <p className="text-xs text-gray-400">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={cn(ROLE_BADGE[u.role], 'flex items-center gap-1 w-fit')}>
                      {ROLE_ICONS[u.role]} {u.role}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-gray-500">{formatDate(u.createdAt)}</td>
                  <td className="px-5 py-3.5 text-gray-500">{u.lastActiveAt ? formatDate(u.lastActiveAt) : '—'}</td>
                  {me?.role === 'admin' && (
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-2">
                        {u.id !== me.id && u.isActive && (
                          <button onClick={() => handleDeactivate(u.id)} className="text-gray-400 hover:text-red-500 transition-colors" title="Deactivate">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
