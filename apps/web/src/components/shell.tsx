'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getSession } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge, Button, cx } from '@/components/ui';

/**
 * Navigation grouped by intent rather than one flat list — with 12 destinations
 * a single column forces users to read every label to find anything.
 */
const NAV_GROUPS: {
  label: string;
  items: { href: string; label: string; permission?: string }[];
}[] = [
  {
    label: 'Clinical',
    items: [
      { href: '/dashboard', label: 'Dashboard' },
      { href: '/assistant', label: 'Nursing Assistant', permission: 'ai:ask' },
      { href: '/drug-prep', label: 'Drug Preparation', permission: 'ai:ask' },
      { href: '/dose-calculator', label: 'Dose Calculator', permission: 'dose:calculate' },
      { href: '/cbahi', label: 'CBAHI Standards', permission: 'ai:search' },
    ],
  },
  {
    label: 'Knowledge',
    items: [
      { href: '/policies', label: 'Policies Library', permission: 'documents:read' },
      { href: '/upload', label: 'Upload Document', permission: 'documents:upload' },
      { href: '/approvals', label: 'Approval Workflow', permission: 'documents:read' },
      { href: '/answer-review', label: 'Answer Review', permission: 'ai:review-answers' },
    ],
  },
  {
    label: 'Governance',
    items: [
      { href: '/users', label: 'Users & Roles', permission: 'users:read' },
      { href: '/audit', label: 'Audit Log', permission: 'audit:read' },
      { href: '/analytics', label: 'Analytics', permission: 'analytics:read' },
      { href: '/settings', label: 'Settings', permission: 'settings:read' },
    ],
  },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { session, loading, logout, hasPermission } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Check storage directly: provider state can lag a client-side navigation
    // that immediately follows login.
    if (!loading && !session && !getSession()) router.replace('/login');
  }, [loading, session, router]);

  // Close the drawer on navigation so it never covers the page you just opened.
  useEffect(() => setNavOpen(false), [pathname]);

  const closeNav = useCallback(() => {
    setNavOpen(false);
    openerRef.current?.focus();
  }, []);

  // Drawer is a modal surface: Esc closes it and Tab is trapped inside.
  useEffect(() => {
    if (!navOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        closeNav();
        return;
      }
      if (e.key !== 'Tab' || !drawerRef.current) return;
      const focusable = drawerRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    drawerRef.current?.querySelector<HTMLElement>('a[href]')?.focus();
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [navOpen, closeNav]);

  if (loading || !session) {
    return (
      <div
        className="flex min-h-screen items-center justify-center text-sm text-subtle"
        role="status"
        aria-live="polite"
      >
        Loading…
      </div>
    );
  }

  const groups = NAV_GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((i) => !i.permission || hasPermission(i.permission)),
  })).filter((g) => g.items.length > 0);

  const navContent = (
    <>
      <div className="flex items-center gap-2.5 px-4 py-4">
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-primary text-xs font-bold text-primary-fg"
          aria-hidden="true"
        >
          B
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight">
            BNP Decision Guard
          </div>
          <div className="truncate text-2xs text-subtle">Governed clinical answers</div>
        </div>
      </div>

      <nav aria-label="Main" className="flex-1 space-y-5 overflow-y-auto px-2 pb-4">
        {groups.map((group) => (
          <div key={group.label}>
            <div className="px-2 pb-1 text-2xs font-medium uppercase tracking-wide text-subtle">
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = pathname === item.href;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cx(
                        'block rounded-control px-2 py-1.5 text-sm transition-colors duration-150',
                        active
                          ? 'bg-primary-soft font-medium text-primary'
                          : 'text-muted hover:bg-sunken hover:text-text',
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-border p-3">
        <div className="mb-2 min-w-0 px-1">
          <div className="truncate text-sm font-medium">{session.user.fullName}</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {session.user.roles.map((r) => (
              <Badge key={r} tone="primary">
                {r.replaceAll('_', ' ').toLowerCase()}
              </Badge>
            ))}
          </div>
        </div>
        <Button size="sm" variant="ghost" className="w-full justify-start" onClick={logout}>
          Sign out
        </Button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {/* Persistent sidebar from lg up */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface lg:flex">
        {navContent}
      </aside>

      {/* Mobile drawer — the previous shell had no mobile treatment at all */}
      {navOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/40 animate-fade-in"
            onClick={closeNav}
            aria-hidden="true"
          />
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-surface shadow-lg animate-slide-in-left"
          >
            {navContent}
          </div>
        </div>
      )}

      {/* Top bar — mobile menu + theme; sticky so context is never lost */}
      <div className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-bg/85 px-4 backdrop-blur lg:pl-[calc(15rem+1.5rem)] lg:pr-6">
        <Button
          ref={openerRef}
          size="sm"
          variant="ghost"
          className="lg:hidden"
          aria-expanded={navOpen}
          aria-haspopup="dialog"
          onClick={() => setNavOpen(true)}
        >
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor" aria-hidden="true">
            <path d="M3 5.5A.5.5 0 0 1 3.5 5h13a.5.5 0 0 1 0 1h-13a.5.5 0 0 1-.5-.5Zm0 4.5a.5.5 0 0 1 .5-.5h13a.5.5 0 0 1 0 1h-13A.5.5 0 0 1 3 10Zm.5 4a.5.5 0 0 0 0 1h13a.5.5 0 0 0 0-1h-13Z" />
          </svg>
          <span className="sr-only">Open navigation</span>
        </Button>
        <span className="text-sm font-medium lg:hidden">BNP Decision Guard</span>
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>

      <main id="main" className="px-4 py-6 lg:pl-[calc(15rem+1.5rem)] lg:pr-6 lg:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

export { PageHeader } from '@/components/ui';

/** Document lifecycle → semantic tone. Kept here as the single mapping. */
export const STATUS_TONES: Record<
  string,
  'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info'
> = {
  DRAFT: 'neutral',
  IN_REVIEW: 'warning',
  APPROVED: 'info',
  INDEXED: 'info',
  ACTIVE: 'success',
  REJECTED: 'danger',
  EXPIRED: 'warning',
  INACTIVE: 'neutral',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? 'neutral'}>{status.replaceAll('_', ' ')}</Badge>
  );
}
