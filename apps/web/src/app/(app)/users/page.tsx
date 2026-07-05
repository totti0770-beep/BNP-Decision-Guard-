'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/shell';

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  isActive: boolean;
  roles: string[];
  lastLoginAt: string | null;
}

interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
}

export default function UsersPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('users:manage');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ email: '', fullName: '', password: '', role: 'NURSE_USER' });

  const load = useCallback(async () => {
    setUsers(await api<UserRow[]>('/users'));
    if (hasPermission('roles:read')) setRoles(await api<RoleRow[]>('/roles'));
  }, [hasPermission]);

  useEffect(() => {
    void load();
  }, [load]);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await api('/users', {
        method: 'POST',
        body: JSON.stringify({
          email: form.email,
          fullName: form.fullName,
          password: form.password,
          roles: [form.role],
        }),
      });
      setForm({ email: '', fullName: '', password: '', role: 'NURSE_USER' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
    }
  }

  async function toggleActive(u: UserRow) {
    await api(`/users/${u.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !u.isActive }),
    });
    await load();
  }

  return (
    <>
      <PageHeader title="Users & Roles" subtitle="Role changes are fully audited." />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="card overflow-x-auto p-0 xl:col-span-2">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Roles</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last login</th>
                {canManage && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-slate-50">
                  <td className="px-4 py-3 font-medium">{u.fullName}</td>
                  <td className="px-4 py-3 text-slate-500">{u.email}</td>
                  <td className="px-4 py-3">
                    {u.roles.map((r) => (
                      <span key={r} className="badge mr-1 bg-brand-50 text-brand-700">
                        {r.replaceAll('_', ' ')}
                      </span>
                    ))}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge ${u.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-500'}`}>
                      {u.isActive ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : '—'}
                  </td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <button className="btn-secondary text-xs" onClick={() => toggleActive(u)}>
                        {u.isActive ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-6">
          {canManage && (
            <form onSubmit={createUser} className="card space-y-3">
              <h3 className="font-semibold">Add user</h3>
              <input className="input" placeholder="Full name" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
              <input className="input" type="email" placeholder="Email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              <input className="input" type="password" placeholder="Password (min 8 chars)" minLength={8} required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {roles.map((r) => (
                  <option key={r.id} value={r.name}>
                    {r.name.replaceAll('_', ' ')}
                  </option>
                ))}
              </select>
              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
              <button className="btn-primary w-full">Create user</button>
            </form>
          )}
          <div className="card">
            <h3 className="mb-3 font-semibold">Roles</h3>
            <ul className="space-y-2 text-sm">
              {roles.map((r) => (
                <li key={r.id}>
                  <div className="font-medium">{r.name.replaceAll('_', ' ')}</div>
                  <div className="text-xs text-slate-400">
                    {r.description} · {r.permissions.length} permissions
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
