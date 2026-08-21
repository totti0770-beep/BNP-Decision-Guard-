'use client';

import { LANG_LABEL } from '@/lib/i18n';
import { useLanguage } from '@/lib/language';

/**
 * EN / عربي switch. Deliberately the same shape as ThemeToggle — including the
 * fixed-size placeholder before mount, so the toolbar doesn't shift once the
 * stored preference resolves.
 *
 * Shows the language you would switch *to*, labelled in that language, which is
 * the convention a reader of either language can act on without translating the
 * control first.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { lang, setLang, mounted } = useLanguage();

  if (!mounted) return <div className={className} style={{ width: 32, height: 32 }} />;

  const next = lang === 'ar' ? 'en' : 'ar';
  const label = next === 'ar' ? 'التبديل إلى العربية' : 'Switch to English';

  return (
    <button
      type="button"
      onClick={() => setLang(next)}
      title={label}
      aria-label={label}
      className={`inline-flex h-8 min-w-8 items-center justify-center rounded-control px-1.5 text-2xs font-medium text-muted transition-colors hover:bg-sunken hover:text-text ${className ?? ''}`}
    >
      {LANG_LABEL[next]}
    </button>
  );
}
