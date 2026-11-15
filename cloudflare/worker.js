import { paymentWebhook, serviceRoutes } from "./payment-test.js";
const enc = new TextEncoder();
const hex = (b) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha = async (s) =>
  hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const random = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      ...extra,
    },
  });
const fail = (message, status = 400) => {
  throw { message, status };
};
const clean = (v, n = 200) =>
  String(v ?? "")
    .trim()
    .slice(0, n);
const pin = (p) =>
  p &&
  typeof p.lat === "number" &&
  Number.isFinite(p.lat) &&
  Math.abs(p.lat) <= 90 &&
  typeof p.lng === "number" &&
  Number.isFinite(p.lng) &&
  Math.abs(p.lng) <= 180;
const prices = {
  "Double Smash Burger": 89,
  "Margherita Pizza": 105,
  "Crispy Chicken Bowl": 96,
  "Loaded Chips": 48,
  "Classic Cheeseburger": 76,
  "Pepperoni Pizza": 119,
};
const round = (n) => Math.round(n * 100) / 100;
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return hex(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: enc.encode(salt),
        iterations: 100000,
      },
      key,
      256,
    ),
  );
}
function equal(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const profileOf = (r) =>
  r
    ? { ...JSON.parse(r.data), id: r.id, role: r.role, status: r.status }
    : null;
const orderOf = (r) =>
  r
    ? {
        ...JSON.parse(r.data),
        id: r.id,
        status: r.status,
        ...(r.driver_id ? { driverId: r.driver_id } : {}),
      }
    : null;
const cookie = (token, age = 86400) =>
  `zingo_session=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
async function limit(db, req, subject, max = 8) {
  const key = await sha(
    subject +
      ":" +
      (req.headers.get("CF-Connecting-IP") || "unknown") +
      ":" +
      Math.floor(Date.now() / 900000),
  );
  const r = await db
    .prepare(
      "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
    )
    .bind(key, Date.now() + 900000)
    .first();
  if (r.count > max) fail("Too many attempts. Wait 15 minutes.", 429);
}
async function audit(db, userId, action) {
  await db
    .prepare(
      "INSERT INTO access_audit(id,user_id,action,created_at) VALUES(?,?,?,?)",
    )
    .bind(crypto.randomUUID(), userId, action, Date.now())
    .run();
}
async function mailToken(env, user, purpose, origin) {
  // A verified sender binding is required. Never return tokens in an API response.
  if (!env.MAILER?.send)
    fail(
      "Email service is not configured. Account access remains restricted.",
      503,
    );
  const token = random(),
    expires = Date.now() + (purpose === "recover" ? 900000 : 600000);
  await env.DB.prepare("DELETE FROM auth_tokens WHERE user_id=? AND purpose=?")
    .bind(user.id, purpose)
    .run();
  const hash = await sha(token);
  await env.DB.prepare(
    "INSERT INTO auth_tokens(token_hash,user_id,purpose,expires_at) VALUES(?,?,?,?)",
  )
    .bind(hash, user.id, purpose, expires)
    .run();
  try {
    await env.MAILER.send({
      to: user.email,
      subject:
        purpose === "recover"
          ? "Reset your ZINGO password"
          : purpose === "owner"
            ? "Confirm your ZINGO owner sign-in"
            : "Verify your ZINGO email",
      url: origin + "/#auth=" + purpose + "&token=" + token,
      expiresAt: expires,
    });
  } catch {
    await env.DB.prepare("DELETE FROM auth_tokens WHERE token_hash=?")
      .bind(hash)
      .run();
    fail("Email could not be sent. Please try again later.", 503);
  }
}
async function takeToken(db, token, purpose) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token))
    fail("This link is invalid or expired.", 400);
  const row = await db
    .prepare(
      "UPDATE auth_tokens SET used_at=? WHERE token_hash=? AND purpose=? AND used_at IS NULL AND expires_at>? RETURNING user_id",
    )
    .bind(Date.now(), await sha(token), purpose, Date.now())
    .first();
  if (!row) fail("This link is invalid or expired.", 400);
  return row.user_id;
}
async function issueSession(db, userId, owner = false) {
  const token = random(),
    hash = await sha(token);
  await db
    .prepare(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
    )
    .bind(hash, userId, Date.now() + 86400000)
    .run();
  if (owner)
    await db
      .prepare(
        "INSERT INTO owner_sessions(token_hash,verified_until) VALUES(?,?)",
      )
      .bind(hash, Date.now() + 1800000)
      .run();
  return cookie(token);
}
async function handler(req, env) {
  const url = new URL(req.url),
    path = url.pathname,
    method = req.method,
    db = env.DB;
  if (!path.startsWith("/api/")) return env.ASSETS.fetch(req);
  if (path === "/api/_healthcheck")
    return json({ ok: true, service: "zingo-preview", payments: "disabled" });
  if (path === "/api/payments/paystack-test/webhook" && method === "POST")
    return paymentWebhook(req, env);
  if (!["GET", "HEAD"].includes(method)) {
    if (req.headers.get("origin") !== url.origin)
      fail("This request must come from ZINGO.", 403);
    if (!(req.headers.get("content-type") || "").startsWith("application/json"))
      fail("JSON required", 415);
    if (Number(req.headers.get("content-length") || 0) > 20000)
      fail("Request too large", 413);
  }
  let body = {};
  if (!["GET", "HEAD"].includes(method)) {
    const raw = await req.text();
    if (raw.length > 20000) fail("Request too large", 413);
    try {
      body = JSON.parse(raw);
      if (!body || typeof body !== "object" || Array.isArray(body))
        fail("Invalid request");
    } catch {
      fail("Invalid request");
    }
  }
  if (
    ["/api/auth/request-verification", "/api/auth/recover"].includes(path) &&
    method === "POST"
  ) {
    await limit(db, req, "email-ip", 12);
    const email = clean(body.email, 254).toLowerCase();
    await limit(db, req, "email:" + email, 4);
    if (!env.MAILER?.send)
      fail(
        "Email service is not configured. Account access remains restricted.",
        503,
      );
    const u = await db
      .prepare("SELECT * FROM users WHERE email=?")
      .bind(email)
      .first();
    if (u)
      await mailToken(
        env,
        u,
        path.endsWith("recover") ? "recover" : "verify",
        url.origin,
      );
    return json({
      ok: true,
      message:
        "If this account exists, an email has been sent. Check your inbox.",
    });
  }
  if (path === "/api/auth/complete" && method === "POST") {
    await limit(db, req, "complete", 20);
    const purpose = body.purpose;
    if (!["verify", "recover", "owner"].includes(purpose))
      fail("Invalid link.");
    if (
      purpose === "recover" &&
      (typeof body.password !== "string" ||
        body.password.length < 12 ||
        body.password.length > 128)
    )
      fail("Use a password of 12 to 128 characters.");
    const id = await takeToken(db, body.token, purpose);
    const u = await db
      .prepare("SELECT * FROM users WHERE id=?")
      .bind(id)
      .first();
    if (!u) fail("Invalid link.");
    if (purpose === "recover") {
      const salt = random(),
        hash = await passwordHash(body.password, salt);
      await db.batch([
        db
          .prepare("UPDATE users SET salt=?,password_hash=? WHERE id=?")
          .bind(salt, hash, id),
        db
          .prepare(
            "DELETE FROM owner_sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE user_id=?)",
          )
          .bind(id),
        db.prepare("DELETE FROM sessions WHERE user_id=?").bind(id),
        db.prepare("DELETE FROM auth_tokens WHERE user_id=?").bind(id),
      ]);
    }
    await db
      .prepare(
        "INSERT INTO email_checks(user_id,verified_at) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET verified_at=excluded.verified_at",
      )
      .bind(id, Date.now())
      .run();
    await audit(db, id, purpose + "_complete");
    if (purpose === "owner") {
      if (!u.is_admin) fail("Owner access required.", 403);
      return json({ ok: true }, 200, {
        "set-cookie": await issueSession(db, id, true),
      });
    }
    return json({
      ok: true,
      message:
        purpose === "recover"
          ? "Password changed. All previous sessions are signed out. Sign in again."
          : "Email verified. Sign in to continue.",
    });
  }
  if (path === "/api/auth/register" || path === "/api/auth/login") {
    if (method !== "POST") fail("Method not allowed", 405);
    const email = clean(body.email, 254).toLowerCase(),
      password = body.password;
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      typeof password !== "string" ||
      password.length < 12 ||
      password.length > 128
    )
      fail("Use a valid email and a password of 12 to 128 characters.");
    const rateKey = await sha(
      "auth:" +
        req.headers.get("CF-Connecting-IP") +
        ":" +
        Math.floor(Date.now() / 900000),
    );
    const rate = await db
      .prepare(
        "INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
      )
      .bind(rateKey, Date.now() + 900000)
      .first();
    if (rate.count > 30) fail("Too many attempts. Wait 15 minutes.", 429);
    let user = await db
      .prepare("SELECT * FROM users WHERE email=?")
      .bind(email)
      .first();
    if (path.endsWith("/register")) {
      if (user) fail("This email cannot be registered. Try signing in.", 409);
      const id = crypto.randomUUID(),
        salt = random(),
        hash = await passwordHash(password, salt);
      try {
        await db
          .prepare(
            "INSERT INTO users(id,email,password_hash,salt,created_at) VALUES(?,?,?,?,?)",
          )
          .bind(id, email, hash, salt, Date.now())
          .run();
      } catch {
        fail("This email cannot be registered.", 409);
      }
      user = { id, email };
    } else {
      const salt = user?.salt || "zingo-dummy-salt-for-timing";
      const hash = await passwordHash(password, salt);
      if (!user || !equal(hash, user.password_hash))
        fail("Email or password is incorrect.", 401);
    }
    const verified = await db
      .prepare("SELECT verified_at FROM email_checks WHERE user_id=?")
      .bind(user.id)
      .first();
    if (!verified) {
      if (env.MAILER?.send) await mailToken(env, user, "verify", url.origin);
      return json({
        user: null,
        verificationRequired: true,
        message: env.MAILER?.send
          ? "Check your email to verify your account before signing in."
          : "Account saved. Email delivery is not configured; access remains restricted.",
      });
    }
    if (user.is_admin) {
      await mailToken(env, user, "owner", url.origin);
      await audit(db, user.id, "owner_challenge");
      return json({
        user: null,
        ownerChallenge: true,
        message:
          "Password accepted. Open the owner confirmation link sent to your verified email. It expires in 10 minutes.",
      });
    }
    await audit(db, user.id, "sign_in");
    return json({ user: { userId: user.id, email: user.email } }, 200, {
      "set-cookie": await issueSession(db, user.id),
    });
  }

  const token = (req.headers.get("cookie") || "").match(
    /(?:^|;\s*)zingo_session=([a-f0-9]{64})(?:;|$)/,
  )?.[1];
  const tokenHash = token ? await sha(token) : "";
  let user = token
    ? await db
        .prepare(
          "SELECT u.id,u.email,u.is_admin FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?",
        )
        .bind(tokenHash, Date.now())
        .first()
    : null;
  if (user) {
    const verified = await db
      .prepare("SELECT verified_at FROM email_checks WHERE user_id=?")
      .bind(user.id)
      .first();
    const owner = user.is_admin
      ? await db
          .prepare(
            "SELECT verified_until FROM owner_sessions WHERE token_hash=? AND verified_until>?",
          )
          .bind(tokenHash, Date.now())
          .first()
      : true;
    if (!verified || !owner) user = null;
  }
  if (path === "/api/auth/me")
    return json({ user: user ? { userId: user.id, email: user.email } : null });
  if (!user) fail("Sign in first.", 401);
  if (path === "/api/auth/logout" && method === "POST") {
    await db
      .prepare("DELETE FROM sessions WHERE token_hash=?")
      .bind(tokenHash)
      .run();
    return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  }
  if (path === "/api/auth/security" && method === "GET") {
    const r = await db
      .prepare(
        "SELECT action,created_at FROM access_audit WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
      )
      .bind(user.id)
      .all();
    return json({ events: r.results });
  }
  if (path === "/api/auth/revoke-all" && method === "POST") {
    await db.batch([
      db
        .prepare(
          "DELETE FROM owner_sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE user_id=?)",
        )
        .bind(user.id),
      db.prepare("DELETE FROM sessions WHERE user_id=?").bind(user.id),
    ]);
    await audit(db, user.id, "revoke_all");
    return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  }
  const pr = await db
      .prepare("SELECT * FROM profiles WHERE id=?")
      .bind(user.id)
      .first(),
    profile = profileOf(pr);
  if (path === "/api/profile" && method === "GET")
    return json({
      profile: user.is_admin
        ? {
            id: user.id,
            email: user.email,
            fullName: "NahaLabs Administrator",
            role: "admin",
            status: "approved",
          }
        : profile,
    });
  if (
    method === "POST" &&
    /\/(test-checkout|verify-test-payment|support|case-decision|test-refund|verify-test-refund)$/.test(
      path,
    )
  )
    await limit(db, req, "order-service:" + user.id, 40);
  const serviceResult = await serviceRoutes(req, env, {
    path,
    method,
    body,
    user,
    profile,
  });
  if (serviceResult) return serviceResult;
  if (path === "/api/onboarding" && method === "POST") {
    if (profile || user.is_admin) fail("This account already has a role.", 409);
    const role = body.role,
      fullName = clean(body.fullName, 100),
      phone = clean(body.phone, 30);
    if (!["customer", "restaurant", "driver"].includes(role) || !fullName)
      fail("Choose a role and enter your full name.");
    if (role !== "customer" && !phone) fail("Contact phone is required.");
    const businessName = clean(body.businessName, 120),
      businessAddress = clean(body.businessAddress, 240),
      vehicleType = clean(body.vehicleType, 60),
      vehicleRegistration = clean(body.vehicleRegistration, 30);
    if (role === "restaurant" && (!businessName || !businessAddress))
      fail("Restaurant name and address are required.");
    if (
      role === "driver" &&
      (!["Car", "Motorcycle", "Scooter", "Bicycle"].includes(vehicleType) ||
        (vehicleType !== "Bicycle" && !vehicleRegistration))
    )
      fail("Vehicle details are required.");
    const setup = {
      serviceArea: clean(body.serviceArea, 160),
      operatingHours: clean(body.operatingHours, 300),
      contactEmail: clean(body.contactEmail, 254),
      menuPlan: clean(body.menuPlan, 1200),
      eligibilityConfirmed: body.eligibilityConfirmed === true,
    };
    if (
      role !== "customer" &&
      (!/^\+?[0-9 ()-]{10,20}$/.test(phone) ||
        !setup.serviceArea ||
        !setup.eligibilityConfirmed)
    )
      fail(
        "Enter a contact phone, service area and confirm the partner requirements.",
      );
    if (
      role === "restaurant" &&
      (!setup.operatingHours ||
        !setup.menuPlan ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(setup.contactEmail))
    )
      fail("Enter opening hours, contact email and your menu setup plan.");
    const p = {
      id: user.id,
      email: user.email,
      role,
      status: role === "customer" ? "active" : "pending",
      fullName,
      phone,
      ...(role !== "customer" ? { setup, reviewChecks: [] } : {}),
      ...(role === "restaurant"
        ? { businessName, businessAddress, cuisine: clean(body.cuisine, 100) }
        : {}),
      ...(role === "driver"
        ? {
            vehicleType,
            vehicleRegistration:
              vehicleType === "Bicycle" ? "" : vehicleRegistration,
          }
        : {}),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    try {
      await db
        .prepare(
          "INSERT INTO profiles(id,role,status,business_name,data) VALUES(?,?,?,?,?)",
        )
        .bind(
          user.id,
          role,
          p.status,
          role === "restaurant" ? businessName.toLowerCase() : null,
          JSON.stringify(p),
        )
        .run();
    } catch {
      fail("This account or restaurant name is already registered.", 409);
    }
    return json({ profile: p }, 201);
  }
  if (path.startsWith("/api/admin/")) {
    if (!user.is_admin) fail("Administrator access required.", 403);
    if (path === "/api/admin/applications" && method === "GET") {
      const r = await db
        .prepare(
          "SELECT * FROM profiles WHERE status='pending' AND role IN ('restaurant','driver') LIMIT 100",
        )
        .all();
      return json({ applications: r.results.map(profileOf) });
    }
    const m = path.match(/^\/api\/admin\/applications\/([^/]+)$/);
    if (m && method === "PUT") {
      if (!["approved", "rejected"].includes(body.decision))
        fail("Choose approve or reject.");
      const p = await db
        .prepare(
          "SELECT * FROM profiles WHERE id=? AND status='pending' AND role IN ('restaurant','driver')",
        )
        .bind(m[1])
        .first();
      if (!p) fail("Pending application not found.", 404);
      const applicant = JSON.parse(p.data);
      if (
        body.decision === "approved" &&
        (!applicant.setup?.eligibilityConfirmed ||
          !applicant.setup?.serviceArea)
      )
        fail(
          "Partner setup is incomplete. Request an updated application before approval.",
        );
      const required =
        p.role === "driver"
          ? ["identity", "vehicle", "contact", "service-area"]
          : ["business", "menu", "contact", "service-area"];
      if (
        body.decision === "approved" &&
        !required.every(
          (k) => Array.isArray(body.checks) && body.checks.includes(k),
        )
      )
        fail("Record every required partner check before approval.");
      const data = {
        ...JSON.parse(p.data),
        reviewChecks: body.decision === "approved" ? required : [],
        status: body.decision,
        approvedBy: user.email,
        updatedAt: Date.now(),
      };
      const r = await db
        .prepare(
          "UPDATE profiles SET status=?,data=? WHERE id=? AND status='pending'",
        )
        .bind(body.decision, JSON.stringify(data), m[1])
        .run();
      if (!r.meta.changes) fail("Application changed.", 409);
      return json({ ok: true });
    }
    fail("Not found.", 404);
  }
  if (
    !user.is_admin &&
    (!profile || !["active", "approved"].includes(profile.status))
  )
    fail("Complete onboarding and await approval.", 403);
  if (path === "/api/restaurants" && method === "GET") {
    const r = await db
      .prepare(
        "SELECT * FROM profiles WHERE role='restaurant' AND status='approved' LIMIT 100",
      )
      .all();
    return json({
      restaurants: r.results.map((p) => {
        const d = profileOf(p);
        return {
          id: p.id,
          name: d.businessName,
          cuisine: d.cuisine || "Preview restaurant",
        };
      }),
    });
  }
  if (path === "/api/orders" && method === "GET") {
    let stmt;
    if (user.is_admin)
      stmt = db.prepare(
        "SELECT * FROM orders ORDER BY created_at DESC LIMIT 100",
      );
    else if (profile.role === "customer")
      stmt = db
        .prepare(
          "SELECT * FROM orders WHERE customer_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .bind(user.id);
    else if (profile.role === "restaurant")
      stmt = db
        .prepare(
          "SELECT * FROM orders WHERE restaurant_id=? ORDER BY created_at DESC LIMIT 100",
        )
        .bind(user.id);
    else
      stmt = db
        .prepare(
          "SELECT * FROM orders WHERE driver_id=? OR (status='ready' AND driver_id IS NULL) ORDER BY created_at DESC LIMIT 100",
        )
        .bind(user.id);
    const r = await stmt.all();
    return json({
      orders: r.results.map((r) => {
        const o = orderOf(r);
        if (profile?.role === "driver" && r.driver_id !== user.id) {
          delete o.destination;
          delete o.customerId;
          o.address = "Accept this delivery to view the drop-off address";
          o.customerName = "Customer";
        }
        return o;
      }),
    });
  }
  if (path === "/api/orders" && method === "POST") {
    if (profile?.role !== "customer" || profile.status !== "active")
      fail("Active customer access required.", 403);
    if (
      !Array.isArray(body.items) ||
      !body.items.length ||
      body.items.length > 30 ||
      !clean(body.address, 250)
    )
      fail("Basket and delivery address are required.");
    if (body.destination && !pin(body.destination))
      fail("Invalid destination pin.");
    const rest = await db
      .prepare(
        "SELECT * FROM profiles WHERE id=? AND role='restaurant' AND status='approved'",
      )
      .bind(clean(body.restaurantId, 80))
      .first();
    if (!rest) fail("Choose an approved preview restaurant.");
    const items = body.items.map((i) => {
      if (
        !prices[i.name] ||
        !Number.isInteger(i.qty) ||
        i.qty < 1 ||
        i.qty > 20
      )
        fail("Invalid menu item.");
      return { name: i.name, qty: i.qty, price: prices[i.name] };
    });
    const food = round(items.reduce((s, i) => s + i.qty * i.price, 0)),
      delivery = 35;
    const order = {
      id: crypto.randomUUID(),
      customerId: user.id,
      customerName: profile.fullName,
      restaurant: profileOf(rest).businessName,
      restaurantId: rest.id,
      items,
      foodSubtotal: food,
      deliveryFee: delivery,
      total: round(food + delivery),
      restaurantPayout: round(food * 0.92),
      driverPayout: 32,
      nahaLabsRevenue: round(food * 0.08 + 3),
      address: clean(body.address, 250),
      ...(body.destination ? { destination: body.destination } : {}),
      status: "placed",
      createdAt: Date.now(),
    };
    await db
      .prepare(
        "INSERT INTO orders(id,customer_id,restaurant_id,status,created_at,data) VALUES(?,?,?,?,?,?)",
      )
      .bind(
        order.id,
        user.id,
        rest.id,
        "placed",
        order.createdAt,
        JSON.stringify(order),
      )
      .run();
    return json({ order }, 201);
  }
  const match = path.match(/^\/api\/orders\/([^/]+)(\/location)?$/);
  if (match) {
    const id = match[1],
      row = await db
        .prepare("SELECT * FROM orders WHERE id=?")
        .bind(id)
        .first();
    if (!row) fail("Order not found.", 404);
    const o = orderOf(row);
    if (match[2]) {
      const allowed =
        row.status === "picked_up" &&
        (row.customer_id === user.id ||
          row.driver_id === user.id ||
          (profile?.role === "restaurant" &&
            profile.status === "approved" &&
            row.restaurant_id === user.id));
      if (!allowed) fail("Tracking is not available to this account.", 403);
      if (method === "GET") {
        const l = await db
          .prepare("SELECT * FROM locations WHERE order_id=? AND updated_at>?")
          .bind(id, Date.now() - 30000)
          .first();
        return json({
          location: l
            ? {
                lat: l.lat,
                lng: l.lng,
                accuracy: l.accuracy,
                updatedAt: l.updated_at,
                sharing: true,
              }
            : null,
        });
      }
      if (method === "PUT") {
        if (
          profile?.role !== "driver" ||
          profile.status !== "approved" ||
          row.driver_id !== user.id
        )
          fail("Only the assigned approved driver can share.", 403);
        if (body.sharing === false) {
          await db
            .prepare("DELETE FROM locations WHERE order_id=?")
            .bind(id)
            .run();
          return json({ ok: true });
        }
        const now = Date.now();
        if (
          !pin(body) ||
          !Number.isFinite(body.accuracy) ||
          body.accuracy < 0 ||
          body.accuracy > 250 ||
          !Number.isFinite(body.capturedAt) ||
          body.capturedAt < now - 30000 ||
          body.capturedAt > now + 5000
        )
          fail("A fresh accurate GPS fix is required.");
        // One conditional SQL statement prevents writes after delivery completion and throttles updates.
        const r = await db
          .prepare(
            "INSERT INTO locations(order_id,lat,lng,accuracy,updated_at) SELECT id,?,?,?,? FROM orders WHERE id=? AND status='picked_up' AND driver_id=? ON CONFLICT(order_id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,accuracy=excluded.accuracy,updated_at=excluded.updated_at WHERE locations.updated_at<?",
          )
          .bind(body.lat, body.lng, body.accuracy, now, id, user.id, now - 8000)
          .run();
        if (!r.meta.changes)
          fail("Delivery changed or GPS update arrived too soon.", 409);
        return json({ ok: true });
      }
    } else if (method === "PUT") {
      let driver = row.driver_id,
        data = { ...o };
      if (
        profile?.role === "restaurant" &&
        profile.status === "approved" &&
        row.restaurant_id === user.id
      ) {
        if (
          { placed: "accepted", accepted: "preparing", preparing: "ready" }[
            row.status
          ] !== body.status
        )
          fail("Invalid restaurant transition.", 409);
      } else if (profile?.role === "driver" && profile.status === "approved") {
        if (
          row.status === "ready" &&
          body.status === "picked_up" &&
          !row.driver_id
        ) {
          driver = user.id;
          data.driverName = profile.fullName;
        } else if (!(
          row.status === "picked_up" &&
          body.status === "delivered" &&
          row.driver_id === user.id
        ))
          fail("Delivery unavailable.", 409);
      } else fail("This account cannot update this order.", 403);
      if (body.status === "accepted") {
        const payment = await db
          .prepare("SELECT status FROM payment_attempts WHERE order_id=?")
          .bind(id)
          .first();
        if (payment && payment.status !== "paid")
          fail("Test payment is not verified. Do not prepare the order.", 409);
      }
      data.status = body.status;
      if (body.status === "delivered") data.deliveredAt = Date.now();
      if (driver) data.driverId = driver;
      const r = await db
        .prepare(
          "UPDATE orders SET status=?,driver_id=?,data=? WHERE id=? AND status=? AND driver_id IS ?",
        )
        .bind(
          body.status,
          driver,
          JSON.stringify(data),
          id,
          row.status,
          row.driver_id,
        )
        .run();
      if (!r.meta.changes) fail("Order changed. Refresh.", 409);
      if (body.status === "delivered")
        await db
          .prepare("DELETE FROM locations WHERE order_id=?")
          .bind(id)
          .run();
      return json({ order: data });
    }
  }
  fail("Not found.", 404);
}
export default {
  async fetch(req, env) {
    try {
      const r = await handler(req, env);
      const h = new Headers(r.headers);
      h.set("X-Content-Type-Options", "nosniff");
      h.set("Referrer-Policy", "strict-origin-when-cross-origin");
      h.set("Permissions-Policy", "geolocation=(self),camera=(),microphone=()");
      h.set("X-Frame-Options", "DENY");
      return new Response(r.body, { status: r.status, headers: h });
    } catch (e) {
      return json(
        {
          error: e.status
            ? e.message
            : "Service unavailable. Please try again.",
        },
        e.status || 500,
      );
    }
  },
};
