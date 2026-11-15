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
sql.exec(
  `INSERT INTO users VALUES('fictional-kitchen','kitchen@test.invalid','none','none',0,0); INSERT INTO profiles VALUES('fictional-kitchen','restaurant','approved','Fictional QA Kitchen','{"businessName":"Fictional QA Kitchen","cuisine":"Fictional demo"}');`,
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
    await p
      .getByRole("button", { name: "Add Double Smash Burger", exact: true })
      .click();
    await p.getByRole("button", { name: "Open cart", exact: true }).click();
    await p
      .getByRole("button", {
        name: "Sign in to place a test order",
        exact: true,
      })
      .click();
    await p.getByRole("textbox", { name: "Password", exact: true }).waitFor();
    check(true, width + " checkout requires sign-in");
    await p.getByRole("button", { name: "Back to Home", exact: true }).click();
    await p.getByRole("button", { name: "Open cart", exact: true }).click();
    check(
      (await p.getByText("Double Smash Burger", { exact: true }).count()) > 0,
      width + " basket survives auth boundary",
    );
    await p.reload();
    await p.getByRole("button", { name: "Open cart", exact: true }).click();
    check(
      (await p.getByText("Double Smash Burger", { exact: true }).count()) > 0,
      width + " basket survives reload",
    );

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
    await p.reload();
    await p.getByRole("button", { name: "Open cart", exact: true }).click();
    await p
      .getByRole("button", {
        name: "Sign in to place a test order",
        exact: true,
      })
      .click();
    await p
      .getByRole("button", { name: "New here? Create an account", exact: true })
      .click();
    await p
      .getByRole("textbox", { name: "Email", exact: true })
      .fill("basket" + width + "@test.invalid");
    await p
      .getByRole("textbox", { name: "Password", exact: true })
      .fill("Fixture-only-NotARealLogin-123!");
    await p
      .getByRole("button", { name: "Create preview account", exact: true })
      .click();
    await p
      .getByRole("button", {
        name: "Customer Discover restaurants and order food.",
        exact: true,
      })
      .click();
    await p
      .getByRole("textbox", { name: "Full name", exact: true })
      .fill("Fictional QA");
    await p
      .getByRole("button", { name: "Create my customer account", exact: true })
      .click();
    await p
      .getByRole("textbox", { name: "Delivery location", exact: true })
      .waitFor();
    check(
      (await p.getByText("Double Smash Burger", { exact: true }).count()) > 0,
      width + " signup resumes populated basket",
    );
    await p
      .getByRole("textbox", { name: "Delivery location", exact: true })
      .fill("Fictional test only no dispatch");
    check(
      await p
        .getByRole("button", {
          name: "Place demo order · R124.00",
          exact: true,
        })
        .isEnabled(),
      width + " correct enabled checkout after signup",
    );
    await p.screenshot({
      path: "/downloads/zingo-basket-signup-" + width + ".png",
      fullPage: true,
    });
    await p.locator(".drawer-heading button").click();
    await p.getByRole("button", { name: "Sign out", exact: true }).click();
    await p.getByRole("button", { name: "Open cart", exact: true }).waitFor();
    await p.getByRole("button", { name: "Open cart", exact: true }).click();
    check(
      await p.getByText("Your basket is empty", { exact: true }).isVisible(),
      width + " signout clears basket",
    );
    check(
      (await p.getByText("R0.00", { exact: true }).count()) >= 3,
      width + " empty totals zero",
    );
    check(errors.length === 0, width + " no browser errors");
    await p.screenshot({
      path: "/downloads/zingo-home-before-release-" + width + ".png",
      fullPage: true,
    });
    const base='http://localhost:4198';
    const fixtureHeaders={Origin:base,'Content-Type':'application/json'};
    const reg=await context.request.post(base+'/api/auth/register',{headers:fixtureHeaders,data:{email:'merchant'+width+'@test.invalid',password:'Fixture-only-NotARealLogin-123!'}});
    const account=await reg.json();
    await context.request.post(base+'/api/onboarding',{headers:fixtureHeaders,data:{role:'restaurant',fullName:'Fictional merchant',phone:'000-TEST',businessName:'FICTIONAL Menu '+width,businessAddress:'Fictional only',cuisine:'Test'}});
    sql.prepare("UPDATE profiles SET status='approved' WHERE id=?").run(account.user.userId);
    await p.reload();
    await p.getByRole('textbox',{name:'Dish name',exact:true}).fill('FICTIONAL UI dish '+width);
    await p.getByRole('textbox',{name:'Dish description',exact:true}).fill('Fictional dish for UI verification only');
    await p.getByRole('spinbutton',{name:'Dish price (ZAR)',exact:true}).fill('57.25');
    await p.getByRole('button',{name:'Add test dish',exact:true}).click();
    await p.getByRole('heading',{name:'Saved test dishes (1)',exact:true}).waitFor();
    check(true,width+' merchant UI saves persisted menu item');
    check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),width+' merchant menu no overflow');
    await p.screenshot({path:'/downloads/zingo-menu-merchant-'+width+'.png',fullPage:true});
    await p.reload();
    await p.getByRole('heading',{name:'Saved test dishes (1)',exact:true}).waitFor();
    check(true,width+' merchant menu survives reload');
    await p.getByRole('button',{name:'Sign out',exact:true}).click();
    await p.getByRole('button',{name:'Sign in',exact:true}).waitFor();
    await context.request.post(base+'/api/auth/login',{headers:fixtureHeaders,data:{email:'basket'+width+'@test.invalid',password:'Fixture-only-NotARealLogin-123!'}});
    await p.reload();
    await p.getByRole('button').filter({hasText:'FICTIONAL Menu '+width}).click();
    await p.getByRole('button',{name:'Add FICTIONAL UI dish '+width,exact:true}).click();
    await p.reload();
    await p.getByRole('button',{name:'Open cart',exact:true}).click();
    check(await p.getByRole('button',{name:'Place demo order · R92.25',exact:true}).count()===1,width+' custom basket and selected restaurant survive reload');
    await p.getByRole('textbox',{name:'Delivery location',exact:true}).fill('Fictional no dispatch');
    await p.getByRole('button',{name:'Place demo order · R92.25',exact:true}).click();
    await p.getByText('Test order saved.',{exact:false}).waitFor();
    check(true,width+' UI custom menu checkout succeeds');
    check(errors.length===0,width+' no custom menu browser errors');
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
console.log(n, "Home browser checks passed");
