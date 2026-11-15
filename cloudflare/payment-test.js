// Test-mode integration only. No live key, bank data or real-money route is accepted.
const fail = (message, status = 400) => {
  throw { message, status };
};
const json = (v, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
const hex = (b) =>
  [...new Uint8Array(b)].map((n) => n.toString(16).padStart(2, "0")).join("");
const same = (a, b) => {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};
const sha = async (s) =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
async function hmac(key, text) {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-512" },
    false,
    ["sign"],
  );
  return hex(
    await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(text)),
  );
}
function configured(env) {
  return (
    env.PAYSTACK_TEST_ENABLED === "true" &&
    /^sk_test_/.test(env.PAYSTACK_TEST_SECRET || "") &&
    /^SPL_/.test(env.PAYSTACK_TEST_SPLIT_CODE || "")
  );
}
function ready(env) {
  if (!configured(env))
    fail(
      "Paystack test mode is not configured. No checkout or refund has been created.",
      503,
    );
}
async function provider(env, route, body) {
  ready(env);
  if (
    !/^\/(transaction\/(initialize|verify\/[A-Za-z0-9.=_-]+)|refund(?:\/[0-9]+)?)$/.test(
      route,
    )
  )
    fail("Unsupported test operation.");
  const r = await (env.PAYSTACK_FETCH || fetch)(
    "https://api.paystack.co" + route,
    {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: "Bearer " + env.PAYSTACK_TEST_SECRET,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  let j;
  try {
    j = await r.json();
  } catch {
    fail(
      "Payment provider response unavailable. Reconcile before retrying.",
      502,
    );
  }
  if (!r.ok || j.status !== true)
    fail(
      "Payment provider did not confirm this operation. Reconcile before retrying.",
      502,
    );
  return j.data;
}
async function reconcile(env, row) {
  const p = await provider(env, "/transaction/verify/" + row.reference);
  if (
    p.domain !== "test" ||
    p.reference !== row.reference ||
    p.amount !== row.amount ||
    p.currency !== "ZAR"
  )
    fail("Payment verification did not match this test order.", 409);
  if (p.status === "success") {
    await env.DB.prepare(
      "UPDATE payment_attempts SET status='paid',provider_id=?,updated_at=? WHERE reference=? AND status IN ('initializing','pending','failed')",
    )
      .bind(String(p.id), Date.now(), row.reference)
      .run();
  } else if (["failed", "abandoned"].includes(p.status)) {
    await env.DB.prepare(
      "UPDATE payment_attempts SET status='failed',updated_at=? WHERE reference=? AND status IN ('initializing','pending')",
    )
      .bind(Date.now(), row.reference)
      .run();
  }
  return { status: p.status, testOnly: true };
}
async function audit(db, id, action, actor) {
  await db
    .prepare(
      "INSERT INTO order_events(id,order_id,actor_id,action,created_at) VALUES(?,?,?,?,?)",
    )
    .bind(crypto.randomUUID(), id, actor, action, Date.now())
    .run();
}
async function reconcileRefund(env, row) {
  const r = await provider(env, "/refund/" + row.provider_id);
  const p = await env.DB.prepare(
    "SELECT * FROM payment_attempts WHERE order_id=?",
  )
    .bind(row.order_id)
    .first();
  if (!p) fail("Payment record missing.", 409);
  const verifiedPayment = await reconcile(env, p);
  if (
    verifiedPayment.status !== "success" ||
    !["paid", "refunded"].includes(p.status)
  )
    fail("Refund payment state mismatch.", 409);
  const transaction =
    typeof r.transaction === "object" ? r.transaction.reference : r.transaction;
  if (
    String(r.id) !== row.provider_id ||
    r.amount !== row.amount ||
    ![p.reference, p.provider_id].includes(String(transaction))
  )
    fail("Refund verification mismatch.", 409);
  if (!["processed", "failed", "pending", "processing"].includes(r.status))
    fail("Unknown refund state.", 409);
  await env.DB.prepare(
    "UPDATE payment_refunds SET status=?,updated_at=? WHERE id=? AND status<>'processed'",
  )
    .bind(r.status, Date.now(), row.id)
    .run();
  if (r.status === "processed")
    await env.DB.prepare(
      "UPDATE payment_attempts SET status='refunded',updated_at=? WHERE order_id=?",
    )
      .bind(Date.now(), row.order_id)
      .run();
  return { status: r.status, testOnly: true };
}
export async function paymentWebhook(req, env) {
  ready(env);
  const raw = await req.text();
  if (raw.length > 20000) fail("Event too large.", 413);
  const modern = req.headers.get("paystack-signature"),
    legacy = req.headers.get("x-paystack-signature") || "";
  let valid = false;
  if (modern) {
    const fields = modern.split(",").map((x) => x.trim());
    const ts = fields.filter((x) => x.startsWith("t="));
    if (ts.length !== 1 || !/^t=[0-9]+$/.test(ts[0]))
      fail("Invalid signature.", 401);
    const t = ts[0].slice(2);
    if (
      Math.abs(Date.now() / 1000 - Number(t)) > 300 ||
      !/^whsec_/.test(env.PAYSTACK_TEST_WEBHOOK_SECRET || "")
    )
      fail("Invalid or stale signature.", 401);
    const expected = await hmac(
      env.PAYSTACK_TEST_WEBHOOK_SECRET,
      t + "." + raw,
    );
    valid = fields
      .filter((x) => x.startsWith("v1="))
      .some(
        (x) =>
          /^v1=whk_[^:]+:[0-9a-f]{128}$/.test(x) &&
          same(x.slice(x.indexOf(":") + 1), expected),
      );
  } else if (
    !env.PAYSTACK_TEST_WEBHOOK_SECRET &&
    /^[0-9a-f]{128}$/.test(legacy)
  ) {
    valid = same(legacy, await hmac(env.PAYSTACK_TEST_SECRET, raw));
  }
  if (!valid) fail("Invalid signature.", 401);
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    fail("Invalid event.");
  }
  const eventHash = await sha(raw);
  if (
    await env.DB.prepare(
      "SELECT event_hash FROM payment_events WHERE event_hash=?",
    )
      .bind(eventHash)
      .first()
  )
    return json({ ok: true, duplicate: true });
  if (event.event === "charge.success") {
    const row = await env.DB.prepare(
      "SELECT * FROM payment_attempts WHERE reference=?",
    )
      .bind(String(event.data?.reference || ""))
      .first();
    if (!row) return json({ ok: true, ignored: true });
    await reconcile(env, row);
  } else if (
    [
      "refund.processed",
      "refund.failed",
      "refund.pending",
      "refund.processing",
    ].includes(event.event)
  ) {
    const id = String(event.data?.id || "");
    if (!/^[0-9]+$/.test(id)) fail("Invalid refund event.");
    const row = await env.DB.prepare(
      "SELECT * FROM payment_refunds WHERE provider_id=?",
    )
      .bind(id)
      .first();
    if (!row) return json({ ok: true, ignored: true });
    await reconcileRefund(env, row);
  }
  await env.DB.prepare(
    "INSERT OR IGNORE INTO payment_events(event_hash,event_type,created_at) VALUES(?,?,?)",
  )
    .bind(eventHash, String(event.event || "unknown"), Date.now())
    .run();
  return json({ ok: true, testOnly: true });
}
export async function serviceRoutes(req, env, ctx) {
  const { path, method, body, user, profile } = ctx,
    db = env.DB;
  if (path === "/api/payment-readiness" && method === "GET")
    return json({
      testConfigured: configured(env),
      livePayments: false,
      splitVerified: false,
      notice:
        "Test mode only. Actual Paystack checkout, split recipients, fees and refund remain unverified until configured and exercised.",
    });
  if (path === "/api/support-cases" && method === "GET") {
    const rows = user.is_admin
      ? await db
          .prepare(
            "SELECT * FROM support_cases ORDER BY created_at DESC LIMIT 100",
          )
          .all()
      : await db
          .prepare(
            "SELECT * FROM support_cases WHERE customer_id=? ORDER BY created_at DESC LIMIT 100",
          )
          .bind(user.id)
          .all();
    return json({ cases: rows.results });
  }
  const match = path.match(
    /^\/api\/orders\/([^/]+)\/(test-checkout|verify-test-payment|support|receipt|case-decision|test-refund|verify-test-refund)$/,
  );
  if (!match) return null;
  const [, id, action] = match,
    row = await db.prepare("SELECT * FROM orders WHERE id=?").bind(id).first();
  if (!row) fail("Order not found.", 404);
  const o = JSON.parse(row.data);
  const owner = !!user.is_admin,
    customer = row.customer_id === user.id,
    restaurant =
      profile?.role === "restaurant" &&
      profile.status === "approved" &&
      row.restaurant_id === user.id,
    driver =
      profile?.role === "driver" &&
      profile.status === "approved" &&
      row.driver_id === user.id;
  if (!owner && !customer && !restaurant && !driver)
    fail("This order is not available to this account.", 403);
  if (action === "receipt" && method === "GET") {
    const p = await db
        .prepare(
          "SELECT reference,amount,currency,status,updated_at FROM payment_attempts WHERE order_id=?",
        )
        .bind(id)
        .first(),
      r = await db
        .prepare(
          "SELECT amount,status,updated_at FROM payment_refunds WHERE order_id=?",
        )
        .bind(id)
        .first(),
      events = await db
        .prepare(
          "SELECT action,created_at FROM order_events WHERE order_id=? ORDER BY created_at LIMIT 100",
        )
        .bind(id)
        .all();
    return json({
      receipt: {
        id,
        restaurant: o.restaurant,
        items: o.items,
        foodSubtotal: o.foodSubtotal,
        deliveryFee: o.deliveryFee,
        total: o.total,
        status: row.status,
        payment: p || { status: "simulated-not-paid" },
        refund: r || null,
        testOnly: true,
        events: events.results,
        notice:
          "Test receipt only. Not proof of payment, settlement or tax invoice.",
      },
    });
  }
  if (action === "support" && method === "POST") {
    if (!customer) fail("Only the customer may open this request.", 403);
    if (
      !["cancellation", "dispute", "help"].includes(body.type) ||
      typeof body.reason !== "string" ||
      body.reason.trim().length < 5 ||
      body.reason.length > 1000
    )
      fail("Choose a request type and enter 5 to 1000 characters.");
    const existing = await db
      .prepare("SELECT * FROM support_cases WHERE order_id=? AND kind=?")
      .bind(id, body.type)
      .first();
    if (existing) return json({ case: existing, duplicate: true });
    const caseId = crypto.randomUUID();
    await db
      .prepare(
        "INSERT INTO support_cases(id,order_id,customer_id,kind,reason,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .bind(
        caseId,
        id,
        user.id,
        body.type,
        body.reason.trim(),
        "open",
        Date.now(),
        Date.now(),
      )
      .run();
    await audit(db, id, "customer_" + body.type + "_request", user.id);
    return json(
      {
        case: { id: caseId, status: "open" },
        notice:
          "Request recorded. It does not cancel the order or move money until reviewed.",
      },
      201,
    );
  }
  if (action === "case-decision" && method === "POST") {
    if (!owner) fail("Owner review required.", 403);
    const c = await db
      .prepare(
        "SELECT * FROM support_cases WHERE id=? AND order_id=? AND status='open'",
      )
      .bind(body.caseId, id)
      .first();
    if (!c) fail("Open case not found.", 404);
    if (
      !["accepted", "declined", "resolved"].includes(body.decision) ||
      typeof body.note !== "string" ||
      body.note.trim().length < 5 ||
      body.note.length > 1000
    )
      fail("Record a decision and response note.");
    const cancelling =
      c.kind === "cancellation" && body.decision === "accepted";
    if (
      cancelling &&
      ["picked_up", "delivered", "cancelled"].includes(row.status)
    )
      fail(
        "This stage needs a separate support resolution, not a pre-pickup cancellation.",
        409,
      );
    const now = Date.now(),
      review = db
        .prepare(
          "UPDATE support_cases SET status=?,response=?,reviewed_by=?,updated_at=? WHERE id=? AND status='open' AND EXISTS(SELECT 1 FROM orders WHERE id=? AND status=?)",
        )
        .bind(
          body.decision,
          body.note.trim(),
          user.id,
          now,
          c.id,
          id,
          row.status,
        );
    const qs = [review];
    if (cancelling)
      qs.push(
        db
          .prepare(
            "UPDATE orders SET status='cancelled',data=? WHERE id=? AND status=? AND EXISTS(SELECT 1 FROM support_cases WHERE id=? AND status='accepted' AND updated_at=? AND reviewed_by=?)",
          )
          .bind(
            JSON.stringify({ ...o, status: "cancelled", cancelledAt: now }),
            id,
            row.status,
            c.id,
            now,
            user.id,
          ),
      );
    const result = await db.batch(qs);
    if (!result[0].meta.changes) fail("Order or case changed; refresh.", 409);
    await audit(db, id, "owner_" + c.kind + "_" + body.decision, user.id);
    return json({
      ok: true,
      notice:
        "Decision saved. No refund is implied; any test refund must be separately requested and verified.",
    });
  }
  if (action === "test-checkout" && method === "POST") {
    if (!customer || profile?.status !== "active")
      fail("Active customer required.", 403);
    if (row.status !== "placed")
      fail(
        "Test checkout is only available before restaurant acceptance.",
        409,
      );
    ready(env);
    const existing = await db
      .prepare(
        "SELECT reference,status,authorization_url FROM payment_attempts WHERE order_id=?",
      )
      .bind(id)
      .first();
    if (existing)
      return json({ payment: existing, reused: true, testOnly: true });
    const reference = "zingo-test-" + crypto.randomUUID(),
      amount = Math.round(o.total * 100);
    await db
      .prepare(
        "INSERT INTO payment_attempts(reference,order_id,amount,currency,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        reference,
        id,
        amount,
        "ZAR",
        "initializing",
        Date.now(),
        Date.now(),
      )
      .run();
    const data = await provider(env, "/transaction/initialize", {
      email: user.email,
      amount,
      currency: "ZAR",
      reference,
      split_code: env.PAYSTACK_TEST_SPLIT_CODE,
      metadata: { order_id: id, test_only: true },
      callback_url:
        new URL(req.url).origin + "/?payment_reference=" + reference,
    });
    const u = new URL(data.authorization_url);
    if (
      u.protocol !== "https:" ||
      u.hostname !== "checkout.paystack.com" ||
      data.reference !== reference
    )
      fail("Unexpected payment destination. Reconcile before retrying.", 502);
    await db
      .prepare(
        "UPDATE payment_attempts SET status='pending',authorization_url=?,updated_at=? WHERE reference=?",
      )
      .bind(u.href, Date.now(), reference)
      .run();
    await audit(db, id, "test_checkout_initialized", user.id);
    return json(
      {
        payment: { reference, status: "pending", authorization_url: u.href },
        testOnly: true,
        splitVerified: false,
      },
      201,
    );
  }
  if (action === "verify-test-payment" && method === "POST") {
    if (!owner && !customer)
      fail("Customer or owner verification required.", 403);
    ready(env);
    const p = await db
      .prepare("SELECT * FROM payment_attempts WHERE order_id=?")
      .bind(id)
      .first();
    if (!p) fail("No test payment exists.", 404);
    return json(await reconcile(env, p));
  }
  if (action === "verify-test-refund" && method === "POST") {
    if (!owner) fail("Owner review required.", 403);
    ready(env);
    const r = await db
      .prepare("SELECT * FROM payment_refunds WHERE order_id=?")
      .bind(id)
      .first();
    if (!r?.provider_id)
      fail(
        "No acknowledged refund exists. Reconcile with the provider before retrying.",
        409,
      );
    return json(await reconcileRefund(env, r));
  }
  if (action === "test-refund" && method === "POST") {
    if (!owner) fail("Owner review required.", 403);
    ready(env);
    const c = await db
      .prepare(
        "SELECT * FROM support_cases WHERE id=? AND order_id=? AND status IN ('accepted','resolved')",
      )
      .bind(body.caseId, id)
      .first();
    if (!c) fail("A reviewed support case is required.");
    const p = await db
      .prepare(
        "SELECT * FROM payment_attempts WHERE order_id=? AND status='paid'",
      )
      .bind(id)
      .first();
    if (!p) fail("A verified test payment is required.", 409);
    const existing = await db
      .prepare("SELECT id,status FROM payment_refunds WHERE order_id=?")
      .bind(id)
      .first();
    if (existing) return json({ refund: existing, reused: true });
    const refundId = crypto.randomUUID(),
      ref = "zingo-refund-" + refundId;
    await db
      .prepare(
        "INSERT INTO payment_refunds(id,order_id,case_id,amount,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      )
      .bind(
        refundId,
        id,
        c.id,
        p.amount,
        "initializing",
        Date.now(),
        Date.now(),
      )
      .run();
    const data = await provider(env, "/refund", {
      transaction: p.reference,
      reference: ref,
      amount: p.amount,
      customer_note: "ZINGO test refund",
      merchant_note: "Reviewed test case " + c.id,
    });
    if (!/^[0-9]+$/.test(String(data.id)))
      fail("Unknown refund response. Reconcile before retrying.", 502);
    await db
      .prepare(
        "UPDATE payment_refunds SET provider_id=?,status='pending',updated_at=? WHERE id=?",
      )
      .bind(String(data.id), Date.now(), refundId)
      .run();
    await audit(db, id, "test_refund_requested", user.id);
    return json(
      {
        refund: { id: refundId, status: "pending" },
        notice:
          "Test refund requested, not confirmed. A signed, verified provider update must confirm completion.",
      },
      201,
    );
  }
  fail("Method not allowed.", 405);
}
