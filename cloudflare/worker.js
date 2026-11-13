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
async function handler(req, env) {
  const url = new URL(req.url),
    path = url.pathname,
    method = req.method,
    db = env.DB;
  if (!path.startsWith("/api/")) return env.ASSETS.fetch(req);
  if (path === "/api/_healthcheck")
    return json({ ok: true, service: "zingo-preview", payments: "disabled" });
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
    const token = random();
    await db
      .prepare(
        "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",
      )
      .bind(await sha(token), user.id, Date.now() + 86400000)
      .run();
    await db.batch([
      db.prepare("DELETE FROM sessions WHERE expires_at<?").bind(Date.now()),
      db.prepare("DELETE FROM rate_limits WHERE expires_at<?").bind(Date.now()),
    ]);
    return json({ user: { userId: user.id, email: user.email } }, 200, {
      "set-cookie": cookie(token),
    });
  }
  const token = (req.headers.get("cookie") || "").match(
    /(?:^|;\s*)zingo_session=([a-f0-9]{64})(?:;|$)/,
  )?.[1];
  const tokenHash = token ? await sha(token) : "";
  const user = token
    ? await db
        .prepare(
          "SELECT u.id,u.email,u.is_admin FROM sessions s JOIN users u ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?",
        )
        .bind(tokenHash, Date.now())
        .first()
    : null;
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
    if (role === "driver" && (!vehicleType || !vehicleRegistration))
      fail("Vehicle details are required.");
    const p = {
      id: user.id,
      email: user.email,
      role,
      status: role === "customer" ? "active" : "pending",
      fullName,
      phone,
      ...(role === "restaurant"
        ? { businessName, businessAddress, cuisine: clean(body.cuisine, 100) }
        : {}),
      ...(role === "driver" ? { vehicleType, vehicleRegistration } : {}),
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
      const data = {
        ...JSON.parse(p.data),
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
        } else if (
          !(
            row.status === "picked_up" &&
            body.status === "delivered" &&
            row.driver_id === user.id
          )
        )
          fail("Delivery unavailable.", 409);
      } else fail("This account cannot update this order.", 403);
      data.status = body.status;
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
