/**
 * In-memory stand-in for `@react-native-async-storage/async-storage`, whose
 * real implementation is a native module. Plaintext by design — this is where
 * the non-secret profile lives, and tests assert that nothing sensitive does.
 *
 * `__failWith` lets a test drive the failure branches (`loadApiUrl`'s catch,
 * `getSession`'s catch) that a happy-path fake could never reach.
 */
const store = new Map<string, string>();
let failure: Error | null = null;

function guard() {
  if (failure) throw failure;
}

async function getItem(key: string): Promise<string | null> {
  guard();
  return store.has(key) ? (store.get(key) as string) : null;
}

async function setItem(key: string, value: string): Promise<void> {
  guard();
  store.set(key, value);
}

async function removeItem(key: string): Promise<void> {
  guard();
  store.delete(key);
}

/** Test-only view of what plaintext storage currently holds. */
export function __entries(): Record<string, string> {
  return Object.fromEntries(store);
}

export function __failWith(error: Error | null): void {
  failure = error;
}

export function __reset(): void {
  store.clear();
  failure = null;
}

export default { getItem, setItem, removeItem };
