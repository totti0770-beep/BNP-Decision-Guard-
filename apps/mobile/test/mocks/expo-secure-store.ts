/**
 * Stand-in for the OS keychain/keystore.
 *
 * `expo-secure-store`'s real implementation is a native module — it cannot load
 * outside a device or simulator, so the unit suite maps the import here (see
 * `moduleNameMapper` in jest.config.js). The point of the mock is not merely to
 * stop the import from throwing: keeping this store *separate* from the
 * AsyncStorage mock is what lets a test assert that access and refresh tokens
 * land in the secure store and never in plaintext storage.
 */
const store = new Map<string, string>();

export async function getItemAsync(key: string): Promise<string | null> {
  return store.has(key) ? (store.get(key) as string) : null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}

/** Test-only view of what the keychain currently holds. */
export function __entries(): Record<string, string> {
  return Object.fromEntries(store);
}

export function __reset(): void {
  store.clear();
}
