'use client';

import { useEffect, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

const NAV: { href: string; label: string; permission?: string; icon: string }[] = [
  { href: '/dashboard', label: 'Dashboard', icon: '◧' },
  { href: '/assistant', label: 'AI Nursing Assistant', permission: 'ai:ask', icon: '✚' },
  { href: '/drug-prep', label: 'Drug Preparation', permission: 'ai:ask', icon: '⚗' },
  { href: '/dose-calculator', label: 'Dose Calculator', permission: 'dose:calculate', icon: '∑' },
  { href: '/cbahi', label: 'CBAHI Standards', permission: 'ai:search', icon: '✓' },
  { href: '/policies', label: 'Policies Library', permission: 'documents:read', icon: '▤' },
  { href: '/upload', label: 'Upload Document', permission: 'documents:upload', icon: '↥' },
  { href: '/approvals', label: 'Approval Workflow', permission: 'documents:read', icon: '⇄' },
  { href: '/users', label: 'Users & Roles', permission: 'users:read', icon: '☺' },
  { href: '/audit', label: 'Audit Logs', permission: 'audit:read', icon: '≡' },
  { href: '/analytics', label: 'Analytics', permission: 'analytics:read', icon: '∿' },
  { href: '/settings', label: 'Settings', permission: 'settings:read', icon: '⚙' },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { session, loading, logout, hasPermission } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) router.replace('/login');
  }, [loading, session, router]);

  if (loading || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 flex w-64 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 font-bold text-white">
            B
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">
              BNP Decision Guard
            </div>
            <div className="text-[11px] text-slate-400">Trusted answers only</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {NAV.filter((n) => !n.permission || hasPermission(n.permission)).map(
            (item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                  pathname.startsWith(item.href)
                    ? 'bg-brand-50 font-medium text-brand-700'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className="w-4 text-center">{item.icon}</span>
                {item.label}
              </Link>
            ),
          )}
        </nav>
        <div className="border-t border-slate-100 p-4">
          <div className="mb-2">
            <div className="text-sm font-medium">{session.user.fullName}</div>
            <div className="text-xs text-slate-400">
              {session.user.roles.join(', ').replaceAll('_', ' ')}
            </div>
          </div>
          <button onClick={logout} className="btn-secondary w-full text-xs">
            Sign out
          </button>
        </div>
      </aside>
      <main className="ml-64 flex-1 p-8">{children}</main>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="mb-6">
      <h1 className="text-xl font-bold">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
    </header>
  );
}

export const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  IN_REVIEW: 'bg-amber-100 text-amber-800',
  APPROVED: 'bg-sky-100 text-sky-800',
  INDEXED: 'bg-indigo-100 text-indigo-800',
  ACTIVE: 'bg-emerald-100 text-emerald-800',
  REJECTED: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-orange-100 text-orange-800',
  INACTIVE: 'bg-slate-200 text-slate-500',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`badge ${STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-700'}`}>
      {status.replaceAll('_', ' ')}
    </span>
  );
}
