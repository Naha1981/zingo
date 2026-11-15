import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import {
  sql,
  env,
  call,
  link,
  verified,
  fixturePassword,
  outbox,
} from "./harness.mjs";
let n = 0;
const check = (x, label) => {
  assert.ok(x, label);
  console.log("PASS", ++n, label);
};
const reg = await call("POST", "/api/auth/register", {
  email: "safe@test.invalid",
  password: fixturePassword,
});
check(
  reg.body.verificationRequired && !reg.cookie,
  "unverified signup has no session",
);
check(
  (await call("GET", "/api/orders", undefined, reg.cookie)).status === 401,
  "unverified cannot order",
);
const token = link("safe@test.invalid", "verify");
check(
  !JSON.stringify(reg).includes(token.token),
  "token never returned in API response",
);
check(
  !sql
    .prepare("SELECT token_hash FROM auth_tokens")
    .get()
    .token_hash.includes(token.token),
  "token stored hashed",
);
check(
  (await call("POST", "/api/auth/complete", token)).status === 200,
  "email verified",
);
check(
  (await call("POST", "/api/auth/complete", token)).status === 400,
  "verification link one-use",
);
const login = await call("POST", "/api/auth/login", {
  email: "safe@test.invalid",
  password: fixturePassword,
});
check(!!login.cookie, "verified password login works");
const recover1 = await call("POST", "/api/auth/recover", {
    email: "safe@test.invalid",
  }),
  recover2 = await call("POST", "/api/auth/recover", {
    email: "absent@test.invalid",
  });
check(
  JSON.stringify(recover1.body) === JSON.stringify(recover2.body),
  "recovery response does not disclose account",
);
const reset = link("safe@test.invalid", "recover");
check(
  (
    await call("POST", "/api/auth/complete", {
      ...reset,
      password: "Different-fixture-only-123!",
    })
  ).status === 200,
  "password recovery",
);
check(
  (await call("GET", "/api/orders", undefined, login.cookie)).status === 401,
  "recovery revokes sessions",
);
check(
  (
    await call("POST", "/api/auth/login", {
      email: "safe@test.invalid",
      password: fixturePassword,
    })
  ).status === 401,
  "old password rejected",
);
check(
  (
    await call("POST", "/api/auth/complete", {
      ...reset,
      password: "Different-fixture-only-123!",
    })
  ).status === 400,
  "recovery link one-use",
);
const owner = await verified("owner");
const uid = owner.body.user.userId;
sql.prepare("UPDATE users SET is_admin=1 WHERE id=?").run(uid);
check(
  (await call("GET", "/api/admin/applications", undefined, owner.cookie))
    .status === 401,
  "new owner flag alone does not authorize existing session",
);
const challenge = await call("POST", "/api/auth/login", {
  email: "owner@test.invalid",
  password: fixturePassword,
});
check(
  challenge.body.ownerChallenge && !challenge.cookie,
  "owner password alone creates no session",
);
const ownerlink = link("owner@test.invalid", "owner");
const step = await call("POST", "/api/auth/complete", ownerlink);
check(!!step.cookie, "owner email step-up creates session");
check(
  (await call("GET", "/api/admin/applications", undefined, step.cookie))
    .status === 200,
  "owner authorized after step-up",
);
check(
  (await call("POST", "/api/auth/complete", ownerlink)).status === 400,
  "owner challenge one-use",
);
sql.prepare("UPDATE owner_sessions SET verified_until=0").run();
check(
  (await call("GET", "/api/admin/applications", undefined, step.cookie))
    .status === 401,
  "owner step-up expires",
);
await call("POST", "/api/auth/login", {
  email: "owner@test.invalid",
  password: fixturePassword,
});
const activeOwner = await call(
  "POST",
  "/api/auth/complete",
  link("owner@test.invalid", "owner"),
);
const driver = await verified("bike");
const setup = {
  role: "driver",
  fullName: "Fictional bike",
  phone: "+27000000000",
  vehicleType: "Bicycle",
  serviceArea: "QA only",
  eligibilityConfirmed: true,
};
check(
  (await call("POST", "/api/onboarding", setup, driver.cookie)).status === 201,
  "bicycle without registration accepted",
);
check(
  (await call("GET", "/api/orders", undefined, driver.cookie)).status === 403,
  "new driver remains pending",
);
check(
  (
    await call(
      "PUT",
      "/api/admin/applications/" + driver.body.user.userId,
      { decision: "approved" },
      activeOwner.cookie,
    )
  ).status === 400,
  "approval without recorded checks denied",
);
check(
  (
    await call(
      "PUT",
      "/api/admin/applications/" + driver.body.user.userId,
      {
        decision: "approved",
        checks: ["identity", "vehicle", "contact", "service-area"],
      },
      activeOwner.cookie,
    )
  ).status === 200,
  "recorded partner review required",
);
const pr = JSON.parse(
  sql
    .prepare("SELECT data FROM profiles WHERE id=?")
    .get(driver.body.user.userId).data,
);
check(
  pr.reviewChecks.length === 4 && pr.approvedBy === "owner@test.invalid",
  "approval actor and checks persisted",
);
const motor = await verified("motor");
check(
  (
    await call(
      "POST",
      "/api/onboarding",
      { ...setup, vehicleType: "Car" },
      motor.cookie,
    )
  ).status === 400,
  "motor vehicle registration required",
);
const restaurant = await verified("newrest");
check(
  (
    await call(
      "POST",
      "/api/onboarding",
      {
        role: "restaurant",
        fullName: "QA",
        phone: "+27000000000",
        businessName: "QA",
        businessAddress: "QA",
        serviceArea: "QA",
        eligibilityConfirmed: true,
      },
      restaurant.cookie,
    )
  ).status === 400,
  "incomplete restaurant setup rejected",
);
await call("POST", "/api/auth/request-verification", {
  email: "motor@test.invalid",
});
sql
  .prepare("UPDATE auth_tokens SET expires_at=0 WHERE user_id=?")
  .run(motor.body.user.userId);
check(
  (
    await call(
      "POST",
      "/api/auth/complete",
      link("motor@test.invalid", "verify"),
    )
  ).status === 400,
  "expired link rejected",
);
const oldMailer = env.MAILER;
delete env.MAILER;
check(
  (await call("POST", "/api/auth/recover", { email: "safe@test.invalid" }))
    .status === 503,
  "missing mail transport fails closed",
);
env.MAILER = oldMailer;
check(
  (
    await call(
      "POST",
      "/api/auth/recover",
      { email: "x@test.invalid" },
      undefined,
      { origin: "https://evil.invalid" },
    )
  ).status === 403,
  "cross-origin auth write denied",
);
for (let i = 0; i < 13; i++)
  await call(
    "POST",
    "/api/auth/recover",
    { email: "limit" + i + "@test.invalid" },
    undefined,
    { "CF-Connecting-IP": "192.0.2.50" },
  );
check(
  (
    await call(
      "POST",
      "/api/auth/recover",
      { email: "last@test.invalid" },
      undefined,
      { "CF-Connecting-IP": "192.0.2.50" },
    )
  ).status === 429,
  "email request IP rate limit",
);
const js = ts.transpileModule(
  fs.readFileSync(new URL("../src/daily.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
  },
).outputText;
const { completedToday, johannesburgDay } = await import(
  "data:text/javascript;base64," + Buffer.from(js).toString("base64")
);
const now = Date.parse("2026-11-15T00:05:00+02:00");
check(johannesburgDay(now) === "2026-11-15", "SAST date boundary");
check(
  completedToday(
    [
      { status: "delivered", deliveredAt: Date.parse("2026-11-14T22:01Z") },
      { status: "delivered", deliveredAt: Date.parse("2026-11-14T21:59Z") },
      { status: "delivered" },
      { status: "ready", deliveredAt: now },
    ],
    now,
  ).length === 1,
  "daily totals exclude yesterday unknown and incomplete",
);
check(
  sql.prepare("SELECT count(*) n FROM access_audit").get().n > 0,
  "access audit recorded",
);

const rest2 = await verified("rest2");
const rest1 = await verified("rest1");
for (const [r, name] of [
  [rest1, "one"],
  [rest2, "two"],
]) {
  await call(
    "POST",
    "/api/onboarding",
    {
      role: "restaurant",
      fullName: name,
      phone: "+27000000000",
      businessName: name,
      businessAddress: "Fictional",
      serviceArea: "Fictional",
      operatingHours: "9-5",
      contactEmail: name + "@test.invalid",
      menuPlan: "Fictional menu",
      eligibilityConfirmed: true,
    },
    r.cookie,
  );
  sql
    .prepare("UPDATE profiles SET status='approved' WHERE id=?")
    .run(r.body.user.userId);
}
const buyer = await verified("buyer");
await call(
  "POST",
  "/api/onboarding",
  { role: "customer", fullName: "Buyer" },
  buyer.cookie,
);
await call(
  "POST",
  "/api/orders",
  {
    restaurantId: rest1.body.user.userId,
    address: "Fictional",
    items: [{ name: "Double Smash Burger", qty: 1 }],
  },
  buyer.cookie,
);
check(
  (await call("GET", "/api/orders", undefined, rest1.cookie)).body.orders
    .length === 1,
  "restaurant sees own order",
);
check(
  (await call("GET", "/api/orders", undefined, rest2.cookie)).body.orders
    .length === 0,
  "second restaurant cannot read first order",
);
check(
  (await call("GET", "/api/auth/security", undefined, activeOwner.cookie)).body
    .events.length > 0,
  "owner access history readable",
);
check(
  (await call("POST", "/api/auth/revoke-all", {}, activeOwner.cookie))
    .status === 200,
  "owner can revoke all sessions",
);
check(
  (await call("GET", "/api/admin/applications", undefined, activeOwner.cookie))
    .status === 401,
  "revoked owner session denied",
);
console.log(n + " safety checks passed; no external email/payment used");
