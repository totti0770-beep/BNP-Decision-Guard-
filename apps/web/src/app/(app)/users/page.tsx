'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAsyncData } from '@/lib/async';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Panel,
  Section,
  Select,
  SkeletonRows,
  Table,
  Td,
  Th,
} from '@/components/ui';

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

const humanise = (s: string) => s.replaceAll('_', ' ');

export default function UsersPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('users:manage');
  const canReadRoles = hasPermission('roles:read');

  const fetchAll = useCallback(async () => {
    const [users, roles] = await Promise.all([
      api<UserRow[]>('/users'),
      canReadRoles ? api<RoleRow[]>('/roles') : Promise.resolve([] as RoleRow[]),
    ]);
    return { users, roles };
  }, [canReadRoles]);

  const { data, error, loading, reload } = useAsyncData(fetchAll, [canReadRoles]);

  const [form, setForm] = useState({
    email: '',
    fullName: '',
    password: '',
    role: 'NURSE_USER',
  });
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const passwordTooShort = form.password !== '' && form.password.length < 8;

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    setCreating(true);
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
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create the user');
    } finally {
      setCreating(false);
    }
  }

  async function toggleActive(u: UserRow) {
    setTogglingId(u.id);
    try {
      await api(`/users/${u.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !u.isActive }),
      });
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not update the user');
    } finally {
      setTogglingId(null);
    }
  }

  const roles = data?.roles ?? [];

  return (
    <>
      <PageHeader
        title="Users & Roles"
        subtitle="Role changes are fully audited. Disabling a user revokes their outstanding sessions."
      />

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          {loading ? (
            <SkeletonRows rows={6} label="Loading users" />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : !data || data.users.length === 0 ? (
            <Panel>
              <EmptyState
                title="No users yet"
                description="Seed the demo data or create the first account with the form beside this list."
              />
            </Panel>
          ) : (
            <Panel>
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th className="hidden md:table-cell">Email</Th>
                    <Th>Roles</Th>
                    <Th>Status</Th>
                    <Th className="hidden lg:table-cell">Last login</Th>
                    {canManage && <Th />}
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.id}>
                      <Td className="font-medium text-text">
                        {u.fullName}
                        <span className="mt-0.5 block text-2xs text-subtle md:hidden">
                          {u.email}
                        </span>
                      </Td>
                      <Td className="hidden text-muted md:table-cell">{u.email}</Td>
                      <Td>
                        <div className="flex flex-wrap gap-1">
                          {u.roles.map((r) => (
                            <Badge key={r} tone="primary">
                              {humanise(r)}
                            </Badge>
                          ))}
                        </div>
                      </Td>
                      <Td>
                        <Badge tone={u.isActive ? 'success' : 'neutral'}>
                          {u.isActive ? 'Active' : 'Disabled'}
                        </Badge>
                      </Td>
                      <Td className="tnum hidden text-subtle lg:table-cell">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : '—'}
                      </Td>
                      {canManage && (
                        <Td className="text-right">
                          <Button
                            size="sm"
                            loading={togglingId === u.id}
                            onClick={() => toggleActive(u)}
                          >
                            {u.isActive ? 'Disable' : 'Enable'}
                          </Button>
                        </Td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Panel>
          )}
        </div>

        <div className="space-y-6">
          {canManage && (
            <Card>
              <form onSubmit={createUser} className="space-y-3">
                <h2 className="text-lg font-semibold tracking-tight">Add user</h2>

                <Field label="Full name" required>
                  <Input
                    required
                    autoComplete="off"
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  />
                </Field>

                <Field label="Email" required>
                  <Input
                    type="email"
                    required
                    autoComplete="off"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </Field>

                <Field
                  label="Password"
                  required
                  hint="At least 8 characters"
                  error={passwordTooShort ? 'Too short — use 8 characters or more' : undefined}
                >
                  <Input
                    type="password"
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                  />
                </Field>

                <Field label="Role" required hint="Determines which screens and actions they get">
                  <Select
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}
                  >
                    {roles.map((r) => (
                      <option key={r.id} value={r.name}>
                        {humanise(r.name)}
                      </option>
                    ))}
                  </Select>
                </Field>

                {formError && (
                  <p
                    role="alert"
                    className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger"
                  >
                    {formError}
                  </p>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  loading={creating}
                  disabled={
                    !form.fullName || !form.email || form.password.length < 8 || !roles.length
                  }
                >
                  Create user
                </Button>
              </form>
            </Card>
          )}

          {canReadRoles && (
            <Section title="Roles" description="Permission sets defined by the platform">
              {loading ? (
                <SkeletonRows rows={3} label="Loading roles" />
              ) : (
                <Panel className="divide-y divide-border">
                  {roles.map((r) => (
                    <div key={r.id} className="p-3">
                      <div className="text-sm font-medium text-text">{humanise(r.name)}</div>
                      {r.description && (
                        <p className="mt-0.5 text-xs text-subtle">{r.description}</p>
                      )}
                      <p className="tnum mt-1 text-2xs text-subtle">
                        {r.permissions.length} permissions
                      </p>
                    </div>
                  ))}
                </Panel>
              )}
            </Section>
          )}
        </div>
      </div>
    </>
  );
}
