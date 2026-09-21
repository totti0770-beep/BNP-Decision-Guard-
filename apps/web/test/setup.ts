/**
 * The two browser globals `src/lib/api.ts` reaches for, as in-memory
 * stand-ins. Loaded via jest `setupFiles`, so they exist before any module
 * under test is imported.
 *
 * `window` is a plain object with only `location` on it: `api.ts` tests
 * `typeof window === 'undefined'` to detect the server, and assigns
 * `window.location.href` to redirect. `localStorage` is a Map behind the
 * `Storage` method names the module calls. Both are reset from the specs via
 * `__resetBrowser()`.
 */
const store = new Map<string, string>();

const localStorageStub = {
  getItem: (key: string): string | null => store.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    store.set(key, String(value));
  },
  removeItem: (key: string): void => {
    store.delete(key);
  },
  clear: (): void => store.clear(),
  get length(): number {
    return store.size;
  },
  key: (i: number): string | null => [...store.keys()][i] ?? null,
};

const windowStub = { location: { href: '/' } };

Object.assign(globalThis, { localStorage: localStorageStub, window: windowStub });

(globalThis as unknown as { __resetBrowser: () => void }).__resetBrowser = () => {
  store.clear();
  windowStub.location.href = '/';
};
