'use client';

import { useCallback, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAsyncData } from '@/lib/async';
import { useLanguage } from '@/lib/language';
import { localeTag } from '@/lib/i18n';
import {
  Alert,
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
  const { t, lang } = useLanguage();
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
        title={t('usersTitle')}
        subtitle={t('usersSubtitle')}
      />

      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="min-w-0 xl:col-span-2">
          {loading ? (
            <SkeletonRows rows={6} label={t('loadingUsers')} />
          ) : error ? (
            <ErrorState message={error} onRetry={reload} />
          ) : !data || data.users.length === 0 ? (
            <Panel>
              <EmptyState
                title={t('noUsersYet')}
                description={t('noUsersYetDesc')}
              />
            </Panel>
          ) : (
            <Panel>
              <Table>
                <thead>
                  <tr>
                    <Th>{t('colName')}</Th>
                    <Th className="hidden md:table-cell">{t('colEmail')}</Th>
                    <Th>{t('colRoles')}</Th>
                    <Th>{t('colStatus')}</Th>
                    <Th className="hidden lg:table-cell">{t('colLastLogin')}</Th>
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
                          {u.isActive ? t('statusActive') : t('statusDisabled')}
                        </Badge>
                      </Td>
                      <Td className="tnum hidden text-subtle lg:table-cell">
                        {u.lastLoginAt
                          ? new Date(u.lastLoginAt).toLocaleDateString(localeTag(lang))
                          : '—'}
                      </Td>
                      {canManage && (
                        <Td className="text-right">
                          <Button
                            size="sm"
                            loading={togglingId === u.id}
                            onClick={() => toggleActive(u)}
                          >
                            {u.isActive ? t('disableUser') : t('enableUser')}
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
                <h2 className="text-lg font-semibold tracking-tight">{t('addUser')}</h2>

                <Field label={t('fullName')} required>
                  <Input
                    required
                    autoComplete="off"
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  />
                </Field>

                <Field label={t('email')} required>
                  <Input
                    type="email"
                    required
                    autoComplete="off"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </Field>

                <Field
                  label={t('password')}
                  required
                  hint={t('atLeast8CharsHint')}
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

                <Field label={t('role')} required hint={t('roleHint')}>
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

                {formError && <Alert className="text-xs">{formError}</Alert>}

                <Button
                  type="submit"
                  variant="primary"
                  className="w-full"
                  loading={creating}
                  disabled={
                    !form.fullName || !form.email || form.password.length < 8 || !roles.length
                  }
                >
                  {t('createUser')}
                </Button>
              </form>
            </Card>
          )}

          {canReadRoles && (
            <Section title={t('rolesSectionTitle')} description={t('rolesSectionDesc')}>
              {loading ? (
                <SkeletonRows rows={3} label={t('loadingRoles')} />
              ) : (
                <Panel className="divide-y divide-border">
                  {roles.map((r) => (
                    <div key={r.id} className="p-3">
                      <div className="text-sm font-medium text-text">{humanise(r.name)}</div>
                      {r.description && (
                        <p className="mt-0.5 text-xs text-subtle">{r.description}</p>
                      )}
                      <p className="tnum mt-1 text-2xs text-subtle">
                        {t('permissionsCount', { count: r.permissions.length })}
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
