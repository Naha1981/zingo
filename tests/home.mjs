import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import worker from "../cloudflare/worker.js";
const sql = new DatabaseSync(":memory:");
sql.exec(
  fs.readFileSync(new URL("../cloudflare/schema.sql", import.meta.url), "utf8"),
);
function stmt(query, values = []) {
  return {
    bind(...v) {
      return stmt(query, v);
    },
    async first() {
      return sql.prepare(query).get(...values);
    },
    async all() {
      return { results: sql.prepare(query).all(...values) };
    },
    async run() {
      const r = sql.prepare(query).run(...values);
      return { meta: { changes: Number(r.changes) } };
    },
  };
}
const env = {
  DB: { prepare: stmt, batch: (qs) => Promise.all(qs.map((q) => q.run())) },
  ASSETS: { fetch: () => new Response("static") },
};

const root = path.resolve("dist");
env.ASSETS.fetch = async (req) => {
  let f = path.join(root, new URL(req.url).pathname);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory())
    f = path.join(root, "index.html");
  return new Response(fs.readFileSync(f), {
    headers: {
      "content-type": f.endsWith(".js")
        ? "application/javascript"
        : f.endsWith(".css")
          ? "text/css"
          : f.endsWith(".png")
            ? "image/png"
            : "text/html",
    },
  });
};
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const r = await worker.fetch(
    new Request("http://localhost:4198" + req.url, {
      method: req.method,
      headers: req.headers,
      ...(["GET", "HEAD"].includes(req.method)
        ? {}
        : { body: Buffer.concat(chunks) }),
    }),
    env,
  );
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise((r) => server.listen(4198, "127.0.0.1", r));
const require = createRequire(import.meta.url),
  {
    chromium,
  } = require("/home/sandbox/littleledger-register-stage/node_modules/playwright");
const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox"],
});
let n = 0;
const check = (v, s) => {
  assert.ok(v, s);
  console.log("PASS", ++n, s);
};
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({
        viewport: { width, height: 844 },
      }),
      p = await context.newPage(),
      errors = [],
      privateCalls = [];
    p.on("pageerror", (e) => errors.push(e.message));
    p.on("request", (r) => {
      if (/\/api\/(orders|restaurants)/.test(r.url()))
        privateCalls.push(r.url());
    });
    await p.goto("http://localhost:4198/");
    await p
      .getByRole("heading", { name: "What are you going to eat today?" })
      .waitFor();
    check(true, width + " fresh logged-out visitor opens Home");
    check(
      (await p
        .getByRole("textbox", { name: "Password", exact: true })
        .count()) === 0,
      width + " no auth form on first opening",
    );
    check(
      privateCalls.length === 0,
      width + " no private data API requests from guest",
    );
    check(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      width + " no horizontal overflow",
    );
    await p
      .getByPlaceholder("Search dishes and favourites...")
      .fill("Margherita");
    check(
      await p
        .getByRole("heading", { name: "Margherita Pizza", exact: true })
        .isVisible(),
      width + " public menu search works",
    );
    await p.getByRole("button", { name: "My orders", exact: true }).click();
    await p.getByRole("textbox", { name: "Password", exact: true }).waitFor();
    check(true, width + " My orders requires sign-in");
    await p.getByRole("button", { name: "Back to Home", exact: true }).click();
    await p
      .getByRole("heading", { name: "What are you going to eat today?" })
      .waitFor();
    await p.getByRole("button", { name: "Open cart", exact: true }).click();
    await p
      .getByRole("button", {
        name: "Sign in to place a test order",
        exact: true,
      })
      .click();
    await p.getByRole("textbox", { name: "Password", exact: true }).waitFor();
    check(true, width + " checkout requires sign-in");
    await p.reload();
    await p
      .getByRole("heading", { name: "What are you going to eat today?" })
      .waitFor();
    check(true, width + " reload opens Home again");
    check(
      (
        await context.request.get("http://localhost:4198/api/orders")
      ).status() === 401,
      width + " backend order privacy unchanged",
    );
    check(errors.length === 0, width + " no browser errors");
    await p.screenshot({
      path: "/downloads/zingo-home-before-release-" + width + ".png",
      fullPage: true,
    });
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
console.log(n, "Home browser checks passed");
