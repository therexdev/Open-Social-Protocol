/** Firefox's browser namespace returns promises; its chrome compatibility namespace uses callbacks.
 * Install before any extension realm accesses the shared Chrome-shaped API surface. */
const scope = globalThis as typeof globalThis & { browser?: typeof chrome };
if (scope.browser?.runtime?.id && scope.browser !== scope.chrome) {
  Object.defineProperty(scope, "chrome", { value: scope.browser, configurable: true, writable: true });
}

/** Extension UUIDs in Firefox differ from runtime.id. URL.origin is also null for
 * these schemes in several URL implementations, so compare scheme + host explicitly. */
export function extensionOrigin(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`.toLowerCase();
}
