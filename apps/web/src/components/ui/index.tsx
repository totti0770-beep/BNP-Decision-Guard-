'use client';

import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

/* ------------------------------------------------------------------ Button */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-primary-fg hover:bg-primary-hover active:brightness-95 shadow-sm',
  secondary:
    'border border-border-strong bg-surface text-text hover:bg-sunken active:bg-sunken',
  ghost: 'text-muted hover:bg-sunken hover:text-text',
  danger: 'bg-danger text-white hover:brightness-110 active:brightness-95 shadow-sm',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

/**
 * `loading` keeps the button mounted and sized (no layout shift) and marks it
 * `aria-busy`, so assistive tech reports progress instead of the label simply
 * vanishing.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex select-none items-center justify-center rounded-control font-medium',
        'transition-colors duration-150',
        'disabled:pointer-events-none disabled:opacity-50',
        BUTTON_SIZES[size],
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
});

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 16 16" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r="6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeOpacity="0.25"
      />
      <path
        d="M8 1.5A6.5 6.5 0 0 1 14.5 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------- Field */

interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
}
const FieldContext = createContext<FieldContextValue | null>(null);

export function Field({
  label,
  hint,
  error,
  required,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  // Error wins over hint when both exist, so screen readers hear the blocker.
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: !!error }}>
      <div className={cx('space-y-1.5', className)}>
        <label htmlFor={id} className="block text-xs font-medium text-muted">
          {label}
          {required && (
            <span className="text-danger" aria-hidden="true">
              {' '}
              *
            </span>
          )}
        </label>
        {children}
        {error ? (
          <p id={errorId} role="alert" className="text-xs text-danger">
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="text-xs text-subtle">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

const CONTROL_BASE =
  'w-full rounded-control border bg-surface px-3 text-sm text-text placeholder:text-subtle ' +
  'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60';

function useControl() {
  const ctx = useContext(FieldContext);
  return {
    id: ctx?.id,
    'aria-describedby': ctx?.describedBy,
    'aria-invalid': ctx?.invalid || undefined,
    borderClass: ctx?.invalid
      ? 'border-danger'
      : 'border-border-strong hover:border-subtle',
  };
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...rest }, ref) {
    const { borderClass, ...a11y } = useControl();
    return (
      <input
        ref={ref}
        {...a11y}
        className={cx(CONTROL_BASE, 'h-9', borderClass, className)}
        {...rest}
      />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...rest }, ref) {
  const { borderClass, ...a11y } = useControl();
  return (
    <textarea
      ref={ref}
      {...a11y}
      className={cx(CONTROL_BASE, 'py-2', borderClass, className)}
      {...rest}
    />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...rest }, ref) {
  const { borderClass, ...a11y } = useControl();
  return (
    <select
      ref={ref}
      {...a11y}
      className={cx(CONTROL_BASE, 'h-9 pr-8', borderClass, className)}
      {...rest}
    >
      {children}
    </select>
  );
});

/* ------------------------------------------------------------------- Badge */

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'bg-sunken text-muted ring-border',
  primary: 'bg-primary-soft text-primary ring-primary/20',
  success: 'bg-success-soft text-success ring-success/20',
  warning: 'bg-warning-soft text-warning ring-warning/20',
  danger: 'bg-danger-soft text-danger ring-danger/20',
  info: 'bg-info-soft text-info ring-info/20',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium ring-1 ring-inset',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- Surfaces */

/**
 * Three distinct containers so the UI isn't "card everything":
 * - Section: grouped content with a heading, no box — the default.
 * - Card: a discrete, often clickable object.
 * - Panel: a framed region that holds other things (tables, lists).
 */
export function Section({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('space-y-3', className)}>
      {(title || actions) && (
        <div className="flex items-end justify-between gap-4">
          <div className="space-y-0.5">
            {title && <h2 className="text-lg font-semibold tracking-tight">{title}</h2>}
            {description && <p className="text-sm text-subtle">{description}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Card({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        'rounded-card border border-border bg-surface p-4 shadow-sm',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Panel({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cx(
        'overflow-hidden rounded-panel border border-border bg-surface',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/* ----------------------------------------------------------------- Loading */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('shimmer rounded-control', className)} aria-hidden="true" />;
}

/** Announces loading to assistive tech while showing shimmer rows visually. */
export function SkeletonRows({ rows = 4, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
      <span className="sr-only">{label}…</span>
    </div>
  );
}

/* ------------------------------------------------------------- Empty/Error */

/**
 * Empty states explain what is happening and what to do next — never a bare
 * "No data".
 */
export function EmptyState({
  title,
  description,
  action,
  tone = 'neutral',
}: {
  title: string;
  description: string;
  action?: ReactNode;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div
        className={cx(
          'mb-3 h-9 w-9 rounded-full',
          tone === 'danger' ? 'bg-danger-soft' : 'bg-sunken',
        )}
        aria-hidden="true"
      />
      <p className="text-sm font-medium text-text">{title}</p>
      <p className="mt-1 max-w-sm text-sm text-subtle">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Calm, human error presentation — no stack traces, always an action. */
export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div role="alert" className="rounded-card border border-danger/30 bg-danger-soft p-4">
      <p className="text-sm font-medium text-danger">Something went wrong</p>
      <p className="mt-1 text-sm text-muted">{message}</p>
      {onRetry && (
        <Button size="sm" className="mt-3" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------- Table */

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className={cx('w-full border-collapse text-sm', className)}>{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cx(
        'border-b border-border bg-sunken px-4 py-2 text-left text-2xs font-medium uppercase tracking-wide text-subtle',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <td className={cx('border-b border-border px-4 py-2.5 align-middle', className)}>
      {children}
    </td>
  );
}

/* -------------------------------------------------------- Segmented filter */

/**
 * A small set of mutually-exclusive filters. Rendered as buttons with
 * `aria-pressed` rather than styled links, so keyboard and screen-reader users
 * get the selected state that the previous colour-only treatment never
 * conveyed.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string; count?: number }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-control border border-border bg-sunken p-0.5"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'rounded-[4px] px-3 py-1 text-xs font-medium transition-colors',
              active
                ? 'bg-surface text-text shadow-sm'
                : 'text-muted hover:text-text',
            )}
          >
            {o.label}
            {o.count != null && (
              <span className="tnum ml-1.5 text-subtle">{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- Pagination */

/**
 * The range is announced via `aria-live`, because previously the only feedback
 * that Next/Previous did anything was rows silently changing.
 */
export function Pagination({
  offset,
  limit,
  total,
  onChange,
  noun = 'results',
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (next: number) => void;
  noun?: string;
}) {
  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + limit, total);

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p aria-live="polite" className="tnum text-xs text-subtle">
        {total === 0 ? `No ${noun}` : `${from}–${to} of ${total} ${noun}`}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={offset === 0}
          onClick={() => onChange(Math.max(0, offset - limit))}
        >
          Previous
        </Button>
        <Button
          size="sm"
          disabled={offset + limit >= total}
          onClick={() => onChange(offset + limit)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Page head */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-subtle">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
