'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  dirFor,
  isRtl,
  t as translate,
  type Key,
  type Lang,
  type Params,
} from './i18n';

export const LANG_KEY = 'bnp.lang';

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Translate a key in the active language, filling any {placeholders}. */
  t: (key: Key, params?: Params) => string;
  rtl: boolean;
  /** False until the stored preference has been read — see ThemeToggle. */
  mounted: boolean;
}

const LanguageContext = createContext<LanguageContextValue>({
  lang: 'en',
  setLang: () => undefined,
  t: (key, params) => translate('en', key, params),
  rtl: false,
  mounted: false,
});

export function readStoredLang(): Lang {
  if (typeof window === 'undefined') return 'en';
  try {
    return window.localStorage.getItem(LANG_KEY) === 'ar' ? 'ar' : 'en';
  } catch {
    // Private mode / blocked storage: fall back to the default rather than
    // taking the whole app down over a preference.
    return 'en';
  }
}

/**
 * Active interface language, persisted per browser.
 *
 * Deliberately not locale-routed (no `/[locale]/…` segments, no middleware):
 * every route here is statically prerendered and sits behind auth, so
 * locale-in-URL would buy no SEO while restructuring all 13 routes and
 * breaking both the browser smoke test's paths and the Railway `/login`
 * healthcheck. Language is a per-user preference, exactly like theme, and
 * reuses that mechanism — see LANG_INIT in app/layout.tsx, which applies
 * `lang`/`dir` before first paint so the page never renders LTR and snaps RTL
 * on hydration.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('en');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setLangState(readStoredLang());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    // LANG_INIT already set these for the first paint; this keeps them correct
    // when the user switches language without a reload.
    document.documentElement.lang = lang;
    document.documentElement.dir = dirFor(lang);
    try {
      window.localStorage.setItem(LANG_KEY, lang);
    } catch {
      // Preference simply won't persist; the session still works.
    }
  }, [lang, mounted]);

  const t = useCallback(
    (key: Key, params?: Params) => translate(lang, key, params),
    [lang],
  );

  return (
    <LanguageContext.Provider
      value={{ lang, setLang: setLangState, t, rtl: isRtl(lang), mounted }}
    >
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  return useContext(LanguageContext);
}

/** Shorthand for the common case of only needing the translate function. */
export function useT(): (key: Key, params?: Params) => string {
  return useContext(LanguageContext).t;
}
