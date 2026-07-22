import { createClient, type Client } from "@libsql/client";

/**
 * Lazily-constructed libSQL client.
 *
 * The client must NOT be built at module-import time: `next build`'s "collecting
 * page data" phase imports every app/api route module, which would construct the
 * client during the build. TURSO_DATABASE_URL/TURSO_AUTH_TOKEN are Production-only
 * in Vercel (absent from Preview), so a build-time client throws
 * `LibsqlError: URL_INVALID` and Preview deploys fail to build. Deferring
 * construction to first use keeps the build independent of DB env — the vars are
 * only read when a request actually hits the client.
 */
let client: Client | null = null;

export function getDb(): Client {
  if (!client) {
    client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    });
  }
  return client;
}

/**
 * Back-compat handle: existing `db.execute(...)` call sites keep working, but the
 * underlying client is still built lazily on first property access (never at
 * import time). Prefer `getDb()` in new code.
 */
export const db: Client = new Proxy({} as Client, {
  get(_target, prop, receiver) {
    const value = Reflect.get(getDb(), prop, receiver);
    return typeof value === "function" ? value.bind(getDb()) : value;
  },
});
