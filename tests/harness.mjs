import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import worker from "../cloudflare/worker.js";
export const sql = new DatabaseSync(":memory:");
sql.exec(
  fs.readFileSync(new URL("../cloudflare/schema.sql", import.meta.url), "utf8"),
);
function stmt(q, v = []) {
  return {
    bind(...a) {
      return stmt(q, a);
    },
    async first() {
      return sql.prepare(q).get(...v);
    },
    async all() {
      return { results: sql.prepare(q).all(...v) };
    },
    async run() {
      const r = sql.prepare(q).run(...v);
      return { meta: { changes: Number(r.changes) } };
    },
  };
}
export const outbox = [];
export const env = {
  DB: {
    prepare: stmt,
    batch: async (qs) => {
      sql.exec("BEGIN");
      try {
        const r = [];
        for (const q of qs) r.push(await q.run());
        sql.exec("COMMIT");
        return r;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  },
  MAILER: { send: async (msg) => outbox.push(msg) },
  ASSETS: { fetch: () => new Response("static") },
};
export async function call(method, path, body, cookie, extra = {}) {
  const r = await worker.fetch(
    new Request("https://test.invalid" + path, {
      method,
      headers: {
        origin: "https://test.invalid",
        "content-type": "application/json",
        "CF-Connecting-IP": "127.0.0.1",
        ...(cookie ? { cookie } : {}),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    env,
  );
  return {
    status: r.status,
    body: await r.json(),
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
export function link(email, purpose) {
  const mail = outbox
    .filter((m) => m.to === email && m.url.includes("auth=" + purpose))
    .at(-1);
  if (!mail) throw Error("No test mail");
  const p = new URLSearchParams(new URL(mail.url).hash.slice(1));
  return { purpose, token: p.get("token") };
}
export const fixturePassword = "Fixture-only-NotARealLogin-123!";
export async function verified(name) {
  const email = name + "@test.invalid";
  await call("POST", "/api/auth/register", {
    email,
    password: fixturePassword,
  });
  await call("POST", "/api/auth/complete", link(email, "verify"));
  return await call("POST", "/api/auth/login", {
    email,
    password: fixturePassword,
  });
}
