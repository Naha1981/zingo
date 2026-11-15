import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import worker from "../cloudflare/worker.js";
import { env, sql, outbox, verified, fixturePassword } from "./harness.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.ZINGO_PLAYWRIGHT_MODULE || "playwright",
);
const base = "http://localhost:4196";
const root = path.resolve("dist");
env.ASSETS.fetch = async (req) => {
  let f = path.join(root, new URL(req.url).pathname);
  if (!f.startsWith(root)) return new Response("", { status: 403 });
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
    new Request(base + req.url, {
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
await new Promise((r) => server.listen(4196, "127.0.0.1", r));
const owner = await verified("browser-owner");
sql
  .prepare("UPDATE users SET is_admin=1 WHERE id=?")
  .run(owner.body.user.userId);
const b = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const contexts = [];
const errors = [];
let count = 0;
const check = (v, label) => {
  assert.ok(v, label);
  console.log("PASS", ++count, label);
};
const page = async () => {
  const c = await b.newContext({ viewport: { width: 390, height: 844 } });
  contexts.push(c);
  const p = await c.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  return p;
};
async function emailLink(p, email, purpose) {
  const msg = outbox
    .filter((m) => m.to === email && m.url.includes("auth=" + purpose))
    .at(-1);
  check(!!msg, `test outbox ${purpose} available`);
  await p.goto(base + new URL(msg.url).hash);
  await p.getByRole("button", { name: "Confirm", exact: true }).click();
}
async function signup(p, email) {
  await p.goto(base);
  await p.getByRole("button", { name: "New here? Create an account" }).click();
  await p.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await p
    .getByRole("textbox", { name: "Password", exact: true })
    .fill(fixturePassword);
  await p
    .getByRole("button", { name: "Create preview account", exact: true })
    .click();
  await p.getByText("Check your email to verify").waitFor();
  check(
    !(await p.getByRole("button", { name: "Order food", exact: true }).count()),
    "unverified UI remains signed out",
  );
  await emailLink(p, email, "verify");
  await p.getByRole("textbox", { name: "Email", exact: true }).fill(email);
  await p
    .getByRole("textbox", { name: "Password", exact: true })
    .fill(fixturePassword);
  await p.getByRole("button", { name: "Sign in", exact: true }).click();
  await p.getByRole("heading", { name: "How will you use ZINGO?" }).waitFor();
}
const customer = await page(),
  restaurant = await page(),
  driver = await page(),
  admin = await page();
try {
  await signup(customer, "browser-customer@test.invalid");
  await customer.getByRole("button", { name: "Customer Discover" }).click();
  await customer
    .getByRole("textbox", { name: "Full name", exact: true })
    .fill("Fictional customer");
  await customer
    .getByRole("button", { name: "Create my customer account" })
    .click();
  await customer
    .getByRole("button", { name: "Order food", exact: true })
    .waitFor();
  check(true, "new verified customer onboarding");
  await customer.screenshot({
    path: "/downloads/zingo-fix-customer-15nov.png",
    fullPage: true,
  });
  await signup(restaurant, "browser-restaurant@test.invalid");
  await restaurant.getByRole("button", { name: "Restaurant Receive" }).click();
  for (const [name, value] of Object.entries({
    "Full name": "Fictional restaurant",
    "Contact phone": "+27000000000",
    "Restaurant / business name": "Fictional kitchen browser QA",
    "Restaurant address": "Fictional address only",
    "Service area": "Fictional test area",
    "Opening hours": "Mon-Fri 09:00-17:00",
    "Business contact email": "kitchen@test.invalid",
    "Menu setup plan":
      "Fictional burger, R89, allergen and availability review required",
  }))
    await restaurant.getByRole("textbox", { name, exact: true }).fill(value);
  await restaurant.getByRole("checkbox").check();
  await restaurant
    .getByRole("button", { name: "Create my restaurant account" })
    .click();
  await restaurant.getByText("Submitted · Awaiting review").waitFor();
  check(true, "restaurant pending with operating setup");
  await signup(driver, "browser-driver@test.invalid");
  await driver.getByRole("button", { name: "Driver Accept" }).click();
  await driver
    .getByRole("textbox", { name: "Full name", exact: true })
    .fill("Fictional bicycle driver");
  await driver
    .getByRole("textbox", { name: "Contact phone", exact: true })
    .fill("+27000000000");
  await driver
    .getByRole("textbox", { name: "Service area", exact: true })
    .fill("Fictional test area");
  await driver
    .getByRole("combobox", { name: "Vehicle type" })
    .selectOption("Bicycle");
  check(
    !(await driver
      .getByRole("textbox", { name: "Vehicle registration", exact: true })
      .count()),
    "bicycle registration absent",
  );
  await driver.getByRole("checkbox").check();
  await driver.screenshot({
    path: "/downloads/zingo-fix-bicycle-15nov.png",
    fullPage: true,
  });
  await driver
    .getByRole("button", { name: "Create my driver account" })
    .click();
  await driver.getByText("Submitted · Awaiting review").waitFor();
  check(true, "bicycle submits without registration");
  await admin.goto(base);
  await admin
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("browser-owner@test.invalid");
  await admin
    .getByRole("textbox", { name: "Password", exact: true })
    .fill(fixturePassword);
  await admin.getByRole("button", { name: "Sign in", exact: true }).click();
  await admin
    .getByText("Password accepted. Open the owner confirmation link")
    .waitFor();
  check(
    !(await admin.getByRole("button", { name: "ZINGO Ops" }).count()),
    "owner password does not unlock ops",
  );
  await emailLink(admin, "browser-owner@test.invalid", "owner");
  await admin.getByRole("heading", { name: "Marketplace overview" }).waitFor();
  await admin
    .getByRole("heading", { name: "Fictional kitchen browser QA", exact: true })
    .waitFor();
  check(true, "owner email step-up and applications");
  await admin.screenshot({
    path: "/downloads/zingo-fix-owner-15nov.png",
    fullPage: true,
  });
  for (const name of [
    "Fictional kitchen browser QA",
    "Fictional bicycle driver",
  ]) {
    const card = admin
      .getByRole("article")
      .filter({ has: admin.getByRole("heading", { name, exact: true }) });
    check(
      await card
        .getByRole("button", { name: "Approve", exact: true })
        .isDisabled(),
      "approval disabled until checks",
    );
    for (const c of await card.getByRole("checkbox").all()) await c.check();
    await card.getByRole("button", { name: "Approve", exact: true }).click();
    await card.waitFor({ state: "detached" });
  }
  await restaurant.getByRole("button", { name: "Check review status" }).click();
  await restaurant
    .getByRole("heading", { name: "Your restaurant orders" })
    .waitFor();
  await driver.getByRole("button", { name: "Check review status" }).click();
  await driver.getByRole("heading", { name: "Your deliveries" }).waitFor();
  await customer.reload();
  await customer
    .getByRole("button", { name: "Add Double Smash Burger", exact: true })
    .click();
  await customer.getByRole("button", { name: "Open cart" }).click();
  await customer
    .getByRole("textbox", { name: "Delivery location", exact: true })
    .fill("Fictional browser test - no dispatch");
  await customer.getByRole("button", { name: "Place demo order" }).click();
  await customer.getByText("Test order saved.").waitFor();
  check(true, "new customer demo order");
  await restaurant.reload();
  for (const label of ["Accept order", "Start preparing", "Mark ready"]) {
    await restaurant.getByRole("button", { name: label, exact: true }).click();
  }
  await restaurant.screenshot({
    path: "/downloads/zingo-fix-restaurant-15nov.png",
    fullPage: true,
  });
  check(true, "restaurant progression");
  await driver.reload();
  await driver
    .getByRole("button", { name: "Accept & pick up", exact: true })
    .click();
  await driver
    .getByRole("button", { name: "Confirm delivered", exact: true })
    .click();
  await driver.getByText("1 completed deliveries today.").waitFor();
  await driver.screenshot({
    path: "/downloads/zingo-fix-driver-15nov.png",
    fullPage: true,
  });
  check(true, "driver completion and daily totals");
  await admin.reload();
  await admin.getByText("Delivered", { exact: true }).waitFor();
  check(true, "owner ledger same delivered order");
  for (const route of ["terms", "privacy", "help"]) {
    await customer.goto(base + "/" + route);
    await customer.getByRole("link", { name: "Back to ZINGO" }).waitFor();
    check(true, route + " real content route");
  }
  await customer.screenshot({
    path: "/downloads/zingo-fix-help-15nov.png",
    fullPage: true,
  });
  const recovery = await page();
  await recovery.goto(base);
  await recovery
    .getByRole("button", { name: "Forgot password?", exact: true })
    .click();
  await recovery
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("browser-customer@test.invalid");
  await recovery
    .getByRole("button", { name: "Send email link", exact: true })
    .click();
  await recovery
    .getByText("If this account exists, an email has been sent.")
    .waitFor();
  const resetmail = outbox
    .filter(
      (m) =>
        m.to === "browser-customer@test.invalid" &&
        m.url.includes("auth=recover"),
    )
    .at(-1);
  await recovery.goto(base + new URL(resetmail.url).hash);
  await recovery
    .getByRole("textbox", { name: "New password", exact: true })
    .fill("Fixture-changed-only-NotReal-123!");
  await recovery.getByRole("button", { name: "Confirm", exact: true }).click();
  await recovery.getByText("Password changed. All previous sessions").waitFor();
  check(true, "password recovery UI with fixture email");
  await customer.goto(base);
  await customer
    .getByRole("button", { name: "Sign in", exact: true })
    .waitFor();
  check(true, "recovery revokes original browser session");
  await recovery
    .getByRole("textbox", { name: "Email", exact: true })
    .fill("browser-customer@test.invalid");
  await recovery
    .getByRole("textbox", { name: "Password", exact: true })
    .fill("Fixture-changed-only-NotReal-123!");
  await recovery.getByRole("button", { name: "Sign in", exact: true }).click();
  await recovery
    .getByRole("button", { name: "My orders", exact: true })
    .waitFor();
  check(true, "new password login after recovery");
  await recovery.setViewportSize({ width: 1280, height: 900 });
  await recovery.screenshot({
    path: "/downloads/zingo-fix-desktop-15nov.png",
    fullPage: true,
  });

  check(errors.length === 0, "no browser page errors");
  console.log("BROWSER", count, "checks passed");
} finally {
  await b.close();
  server.close();
}
