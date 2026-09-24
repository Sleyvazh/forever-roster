import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { sql } from "drizzle-orm";
import { buildApp } from "../src/app";
import { loadConfig, type Config } from "../src/config";
import { createDb } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { memoryMailer } from "../src/lib/mailer";

export const ORIGIN = "http://app.test";
const DB_URL = process.env.DATABASE_URL_TEST ?? "postgres://forever:forever@localhost:5432/forever_test";

export interface TestEnv {
  app: FastifyInstance;
  mailer: ReturnType<typeof memoryMailer>;
  fetchMock: { impl: typeof fetch };
  cfg: Config;
  close(): Promise<void>;
}

export async function setup(overrides: Partial<Record<keyof Config, string>> = {}): Promise<TestEnv> {
  const cfg = loadConfig({
    NODE_ENV: "test", APP_ORIGIN: ORIGIN, DATABASE_URL: DB_URL, COOKIE_SECURE: "false", HIBP_CHECK: "false",
    BNET_CLIENT_ID: "client", BNET_CLIENT_SECRET: "secret", BNET_OAUTH_HOST: "https://oauth.bnet.test",
    ...overrides,
  });
  const { db, pool } = createDb(DB_URL);
  await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;`);
  await runMigrations(db);
  const mailer = memoryMailer();
  const fetchMock = { impl: (async () => { throw new Error("réseau désactivé en test"); }) as typeof fetch };
  const app = await buildApp({ ctx: { db, cfg, mailer, fetch: ((...a: Parameters<typeof fetch>) => fetchMock.impl(...a)) as typeof fetch }, rateLimit: false });
  await app.ready();
  return { app, mailer, fetchMock, cfg, async close() { await app.close(); await pool.end(); } };
}

/** Petit client HTTP qui garde les cookies et le jeton CSRF, comme le ferait le navigateur. */
export class Client {
  cookies = new Map<string, string>();
  csrf: string | null = null;
  constructor(private env: TestEnv) {}

  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<LightMyRequestResponse> {
    const res = await this.env.app.inject({
      method: method as "GET", url,
      headers: {
        origin: ORIGIN,
        ...(this.csrf ? { "x-csrf-token": this.csrf } : {}),
        ...(this.cookies.size ? { cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...headers,
      },
      ...(body !== undefined ? { payload: body as object } : {}),
    });
    for (const c of res.cookies) {
      if (c.value === "" || (c.maxAge !== undefined && c.maxAge <= 0) || (c.expires && c.expires.getTime() < Date.now())) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    const json = safeJson(res);
    if (json && typeof json === "object" && "csrfToken" in json) this.csrf = (json as { csrfToken: string | null }).csrfToken;
    return res;
  }
  get = (url: string) => this.req("GET", url);
  post = (url: string, body?: unknown) => this.req("POST", url, body ?? {});
  patch = (url: string, body?: unknown) => this.req("PATCH", url, body ?? {});
  put = (url: string, body?: unknown) => this.req("PUT", url, body ?? {});
  del = (url: string, body?: unknown) => this.req("DELETE", url, body);
}

export function safeJson(res: LightMyRequestResponse): any {
  try { return res.json(); } catch { return null; }
}

export const tokenFrom = (text: string) => text.match(/#([A-Za-z0-9_-]{20,})/)?.[1] ?? "";

let n = 0;
/** Crée un compte confirmé et connecté. */
export async function signedIn(env: TestEnv, name = `Joueur${++n}`) {
  const c = new Client(env);
  const email = `${name.toLowerCase()}@example.test`;
  const password = "correct horse battery staple";
  const r = await c.post("/api/auth/register", { email, password, displayName: name });
  if (r.statusCode !== 202) throw new Error(r.body);
  const mail = env.mailer.outbox.filter(m => m.to === email).at(-1)!;
  await c.post("/api/auth/verify-email", { token: tokenFrom(mail.text) });
  const login = await c.post("/api/auth/login", { email, password });
  if (login.statusCode !== 200) throw new Error(login.body);
  return { c, email, password, user: login.json().user as { id: string } };
}
