import assert from "node:assert/strict";
import crypto from "node:crypto";
import worker from "../cloudflare/worker.js";
import { sql, env, call, verified, fixturePassword, link } from "./harness.mjs";
let n = 0;
function check(v, s) {
  assert.ok(v, s);
  console.log("PASS", ++n, s);
}
const customer = await verified("payer"),
  stranger = await verified("stranger"),
  restaurant = await verified("eatery"),
  driver = await verified("delivery"),
  owner = await verified("serviceowner");
for (const [u, role, status] of [
  [customer, "customer", "active"],
  [stranger, "customer", "active"],
  [restaurant, "restaurant", "approved"],
  [driver, "driver", "approved"],
]) {
  const id = u.body.user.userId;
  sql
    .prepare(
      "INSERT INTO profiles(id,role,status,business_name,data) VALUES(?,?,?,?,?)",
    )
    .run(
      id,
      role,
      status,
      role === "restaurant" ? "Fixture food" : null,
      JSON.stringify({
        id,
        role,
        status,
        fullName: "Test",
        businessName: "Fixture food",
      }),
    );
}
sql
  .prepare("UPDATE users SET is_admin=1 WHERE id=?")
  .run(owner.body.user.userId);
await call("POST", "/api/auth/login", {
  email: "serviceowner@test.invalid",
  password: fixturePassword,
});
const admin = await call(
  "POST",
  "/api/auth/complete",
  link("serviceowner@test.invalid", "owner"),
);
function order(id, status = "placed") {
  const o = {
    id,
    restaurant: "Fixture food",
    items: [{ name: "Test food", qty: 1, price: 89 }],
    foodSubtotal: 89,
    deliveryFee: 35,
    total: 124,
    status,
  };
  sql
    .prepare(
      "INSERT INTO orders(id,customer_id,restaurant_id,status,created_at,data) VALUES(?,?,?,?,?,?)",
    )
    .run(
      id,
      customer.body.user.userId,
      restaurant.body.user.userId,
      status,
      Date.now(),
      JSON.stringify(o),
    );
}
order("one");
const route = (id, action) => "/api/orders/" + id + "/" + action;
check(
  (await call("GET", route("one", "receipt"), undefined, stranger.cookie))
    .status === 403,
  "receipt hidden from other customer",
);
check(
  (await call("GET", route("one", "receipt"), undefined, customer.cookie)).body
    .receipt.payment.status === "simulated-not-paid",
  "receipt never implies paid",
);
check(
  (await call("POST", route("one", "test-checkout"), {}, customer.cookie))
    .status === 503,
  "missing provider config fails closed",
);
env.PAYSTACK_TEST_ENABLED = "true";
env.PAYSTACK_TEST_SECRET = "sk_live_forbidden";
env.PAYSTACK_TEST_SPLIT_CODE = "SPL_fixture";
check(
  (await call("POST", route("one", "test-checkout"), {}, customer.cookie))
    .status === 503,
  "live key rejected",
);
env.PAYSTACK_TEST_SECRET = "sk_test_fixture_not_real";
let calls = [],
  mode = "ok",
  transaction,
  refundStatus = "pending";
env.PAYSTACK_FETCH = async (url, options) => {
  const payload = options.body ? JSON.parse(options.body) : null;
  calls.push({ url, options, payload });
  if (mode === "timeout") throw Error("Fixture outage");
  let data;
  if (url.endsWith("/initialize")) {
    transaction = {
      domain: "test",
      reference: payload.reference,
      amount: payload.amount,
      currency: "ZAR",
      id: 777,
      status: "success",
    };
    data = {
      reference: payload.reference,
      authorization_url: "https://checkout.paystack.com/fixture-test",
    };
  } else if (url.includes("/verify/"))
    data = {
      ...transaction,
      ...(mode === "amount"
        ? { amount: 1 }
        : mode === "domain"
          ? { domain: "live" }
          : mode === "reference"
            ? { reference: "wrong" }
            : mode === "currency"
              ? { currency: "USD" }
              : {}),
    };
  else if (payload) data = { id: 888, status: "pending" };
  else
    data = {
      id: 888,
      transaction: { reference: transaction.reference },
      amount: mode === "refund-mismatch" ? 1 : 12400,
      status: refundStatus,
    };
  return Response.json({ status: true, data });
};
check(
  (
    await call(
      "POST",
      route("one", "test-checkout"),
      { amount: 1, currency: "USD" },
      stranger.cookie,
    )
  ).status === 403,
  "outsider cannot create checkout",
);
check(
  (await call("POST", route("one", "test-checkout"), {}, restaurant.cookie))
    .status === 403,
  "restaurant cannot create checkout",
);
let r = await call(
  "POST",
  route("one", "test-checkout"),
  { amount: 1, currency: "USD" },
  customer.cookie,
);
check(
  r.status === 201 &&
    calls[0].payload.amount === 12400 &&
    calls[0].payload.currency === "ZAR",
  "server amount and currency ignore client totals",
);
check(
  calls[0].payload.split_code === "SPL_fixture",
  "only configured split code sent",
);
await call("POST", route("one", "test-checkout"), {}, customer.cookie);
check(calls.length === 1, "checkout retry does not double initialize");
check(
  (
    await call(
      "PUT",
      "/api/orders/one",
      { status: "accepted" },
      restaurant.cookie,
    )
  ).status === 409,
  "unverified test payment blocks restaurant acceptance",
);
for (const m of ["amount", "domain", "reference", "currency"]) {
  mode = m;
  check(
    (
      await call(
        "POST",
        route("one", "verify-test-payment"),
        {},
        customer.cookie,
      )
    ).status === 409,
    "verification rejects " + m + " mismatch",
  );
}
mode = "ok";
const hook = "/api/payments/paystack-test/webhook",
  raw = JSON.stringify({
    event: "charge.success",
    data: { reference: transaction.reference },
  });
async function webhook(body, signature) {
  return worker.fetch(
    new Request("https://test.invalid" + hook, {
      method: "POST",
      headers: signature,
      body,
    }),
    env,
  );
}
check(
  (await webhook(raw, { "x-paystack-signature": "0".repeat(128) })).status ===
    401,
  "forged webhook rejected",
);
const legacy = crypto
  .createHmac("sha512", env.PAYSTACK_TEST_SECRET)
  .update(raw)
  .digest("hex");
check(
  (await webhook(raw, { "x-paystack-signature": legacy })).status === 200,
  "signed legacy event verified with provider",
);
check(
  sql.prepare("SELECT status FROM payment_attempts WHERE order_id='one'").get()
    .status === "paid",
  "verified test event marks paid",
);
const before = calls.length;
check(
  (await (await webhook(raw, { "x-paystack-signature": legacy })).json())
    .duplicate && calls.length === before,
  "duplicate event does not reverify",
);
env.PAYSTACK_TEST_WEBHOOK_SECRET = "whsec_fixture";
const raw2 = JSON.stringify({
  event: "charge.success",
  data: { reference: transaction.reference },
  fixture: 2,
});
function modern(text, t) {
  return (
    "t=" +
    t +
    ",v1=whk_fixture:" +
    crypto
      .createHmac("sha512", env.PAYSTACK_TEST_WEBHOOK_SECRET)
      .update(t + "." + text)
      .digest("hex")
  );
}
check(
  (
    await webhook(raw2, {
      "x-paystack-signature": crypto
        .createHmac("sha512", env.PAYSTACK_TEST_SECRET)
        .update(raw2)
        .digest("hex"),
    })
  ).status === 401,
  "no legacy downgrade after modern secret configured",
);
check(
  (
    await webhook(raw2, {
      "Paystack-Signature": modern(raw2, Math.floor(Date.now() / 1000) - 301),
    })
  ).status === 401,
  "stale timestamp rejected",
);
check(
  (
    await webhook(raw2, {
      "Paystack-Signature": modern(raw2, Math.floor(Date.now() / 1000)),
    })
  ).status === 200,
  "current timestamped event accepted",
);
check(
  (
    await call(
      "POST",
      route("one", "support"),
      { type: "help", reason: "tiny" },
      customer.cookie,
    )
  ).status === 400,
  "support reason validation",
);
r = await call(
  "POST",
  route("one", "support"),
  { type: "cancellation", reason: "Fixture cancellation please" },
  customer.cookie,
);
const caseId = r.body.case.id;
check(
  r.status === 201 &&
    sql.prepare("SELECT status FROM orders WHERE id='one'").get().status ===
      "placed",
  "request alone does not cancel",
);
check(
  (
    await call(
      "POST",
      route("one", "support"),
      { type: "cancellation", reason: "Same fixture" },
      customer.cookie,
    )
  ).body.duplicate,
  "support request idempotent",
);
check(
  (await call("GET", "/api/support-cases", undefined, stranger.cookie)).body
    .cases.length === 0,
  "cases private to customer and owner",
);
check(
  (
    await call(
      "POST",
      route("one", "case-decision"),
      { caseId, decision: "accepted", note: "Fixture review complete" },
      customer.cookie,
    )
  ).status === 403,
  "customer cannot self approve",
);
r = await call(
  "POST",
  route("one", "case-decision"),
  { caseId, decision: "accepted", note: "Fixture review complete" },
  admin.cookie,
);
check(
  r.status === 200 &&
    sql.prepare("SELECT status FROM orders WHERE id='one'").get().status ===
      "cancelled",
  "owner reviewed cancellation persisted atomically",
);
check(
  sql.prepare("SELECT status FROM payment_attempts WHERE order_id='one'").get()
    .status === "paid",
  "cancellation does not imply refund",
);
check(
  (await call("POST", route("one", "test-refund"), { caseId }, customer.cookie))
    .status === 403,
  "customer cannot request provider refund",
);
r = await call("POST", route("one", "test-refund"), { caseId }, admin.cookie);
check(
  r.status === 201 && r.body.refund.status === "pending",
  "refund request not called complete",
);
const refundCalls = calls.filter((c) => c.url.endsWith("/refund")).length;
await call("POST", route("one", "test-refund"), { caseId }, admin.cookie);
check(
  calls.filter((c) => c.url.endsWith("/refund")).length === refundCalls,
  "refund retry no duplicate provider request",
);
check(
  (await call("POST", route("one", "verify-test-refund"), {}, admin.cookie))
    .body.status === "pending",
  "pending refund remains pending",
);
mode = "refund-mismatch";
refundStatus = "processed";
check(
  (await call("POST", route("one", "verify-test-refund"), {}, admin.cookie))
    .status === 409,
  "refund amount mismatch rejected",
);
mode = "ok";
check(
  (await call("POST", route("one", "verify-test-refund"), {}, admin.cookie))
    .body.status === "processed",
  "refund confirmed only after provider verification",
);
check(
  (await call("GET", route("one", "receipt"), undefined, customer.cookie)).body
    .receipt.payment.status === "refunded",
  "receipt shows verified refund",
);
order("late", "picked_up");
r = await call(
  "POST",
  route("late", "support"),
  { type: "cancellation", reason: "Too late fixture" },
  customer.cookie,
);
check(
  (
    await call(
      "POST",
      route("late", "case-decision"),
      {
        caseId: r.body.case.id,
        decision: "accepted",
        note: "Fixture review complete",
      },
      admin.cookie,
    )
  ).status === 409,
  "post pickup cancellation blocked",
);
order("ambiguous");
mode = "timeout";
await call("POST", route("ambiguous", "test-checkout"), {}, customer.cookie);
const count = calls.length;
check(
  (await call("POST", route("ambiguous", "test-checkout"), {}, customer.cookie))
    .body.payment.status === "initializing" && count === calls.length,
  "timeout retry remains ambiguous, never doubles charge",
);
check(
  (await call("GET", "/api/payment-readiness", undefined, customer.cookie)).body
    .livePayments === false,
  "readiness never claims live payments",
);
check(
  (await call("POST", route("one", "verify-test-payment"), {}, driver.cookie))
    .status === 403,
  "driver cannot trigger provider verification",
);
check(
  (
    await call(
      "POST",
      route("one", "support"),
      { type: "help", reason: "Fixture unauthorized request" },
      restaurant.cookie,
    )
  ).status === 403,
  "restaurant cannot open customer dispute",
);
check(
  (
    await call(
      "POST",
      route("one", "case-decision"),
      { caseId, decision: "accepted", note: "Reviewed again" },
      admin.cookie,
    )
  ).status === 404,
  "reviewed case cannot be replayed",
);
check(
  (await call("POST", route("one", "verify-test-refund"), {}, stranger.cookie))
    .status === 403,
  "other customer cannot inspect provider refund",
);
check(
  (await call("POST", route("late", "test-refund"), { caseId }, admin.cookie))
    .status === 400,
  "refund requires case belonging to same order",
);
mode = "ok";
let callsBefore = calls.length;
check(
  (await call("POST", route("late", "test-checkout"), {}, customer.cookie))
    .status === 409 && calls.length === callsBefore,
  "checkout blocked after pickup",
);
check(
  (
    await webhook("not json", {
      "Paystack-Signature": modern("not json", Math.floor(Date.now() / 1000)),
    })
  ).status === 400,
  "signed malformed payload rejected",
);
check(
  (
    await webhook(raw2, {
      "Paystack-Signature":
        modern(raw2, Math.floor(Date.now() / 1000)) + ",t=1",
    })
  ).status === 401,
  "ambiguous signature timestamp rejected",
);
for (let i = 0; i < 41; i++)
  await call("POST", route("one", "verify-test-payment"), {}, driver.cookie);
check(
  (await call("POST", route("one", "verify-test-payment"), {}, driver.cookie))
    .status === 429,
  "provider operation rate limit enforced",
);
console.log(
  n,
  "payment/support fixture checks passed. No real network provider called.",
);
