import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import assert from "node:assert/strict";
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
const origin = "https://test.invalid";
let n = 0;
async function call(method, path, body, cookie) {
  const r = await worker.fetch(
    new Request(origin + path, {
      method,
      headers: {
        origin,
        "content-type": "application/json",
        "CF-Connecting-IP": "127.0.0.1",
        ...(cookie ? { cookie } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
    env,
  );
  const j = await r.json();
  return {
    status: r.status,
    body: j,
    cookie: r.headers.get("set-cookie")?.split(";")[0],
  };
}
function check(condition, label) {
  assert.ok(condition, label);
  console.log("PASS", ++n, label);
}
async function signup(name, role) {
  const r = await call("POST", "/api/auth/register", {
    email: name + "@test.invalid",
    password: "Fixture-only-NotARealLogin-123!",
  });
  check(r.status === 200, "signup " + name);
  const p = await call(
    "POST",
    "/api/onboarding",
    {
      role,
      fullName: "Fictional " + name,
      phone: "000-TEST",
      businessName: name,
      businessAddress: "Fictional test address",
      vehicleType: "Car",
      vehicleRegistration: "TEST-NOT-REAL",
    },
    r.cookie,
  );
  check(p.status === 201, "onboarding " + role);
  return { cookie: r.cookie, id: r.body.user.userId };
}
check(
  (await call("GET", "/api/orders")).status === 401,
  "anonymous orders denied",
);
check(
  (
    await call("POST", "/api/auth/register", {
      email: "x@test.invalid",
      password: "short",
    })
  ).status === 400,
  "weak password denied",
);
const customer = await signup("customer", "customer"),
  restaurant = await signup("restaurant", "restaurant"),
  driver = await signup("driver", "driver"),
  stranger = await signup("stranger", "customer"),
  otherDriver = await signup("driver2", "driver");
check(
  (await call("GET", "/api/orders", undefined, driver.cookie)).status === 403,
  "pending driver denied",
);
check(
  (await call("GET", "/api/admin/applications", undefined, customer.cookie))
    .status === 403,
  "customer cannot become admin by email",
);
sql
  .prepare("UPDATE profiles SET status='approved' WHERE id IN (?,?,?)")
  .run(restaurant.id, driver.id, otherDriver.id);
check(
  (
    await call(
      "POST",
      "/api/onboarding",
      { role: "admin", fullName: "Bad" },
      customer.cookie,
    )
  ).status === 409,
  "role immutable",
);
const invalid = await call(
  "POST",
  "/api/orders",
  {
    items: [{ name: "Double Smash Burger", qty: 1 }],
    restaurantId: "fake",
    address: "Test",
  },
  customer.cookie,
);
check(invalid.status === 400, "unapproved restaurant denied");
const posted = await call(
  "POST",
  "/api/orders",
  {
    items: [{ name: "Double Smash Burger", qty: 1, price: 1 }],
    restaurantId: restaurant.id,
    address: "Test address",
    destination: { lat: -26.2, lng: 28.04 },
    foodSubtotal: 1,
    total: 1,
  },
  customer.cookie,
);
check(posted.status === 201, "customer order saved");
const id = posted.body.order.id;
check(posted.body.order.total === 124, "server prices ignore tampering");
check(
  (await call("GET", "/api/orders", undefined, stranger.cookie)).body.orders
    .length === 0,
  "other customer cannot read order",
);
check(
  (await call("PUT", "/api/orders/" + id, { status: "ready" }, customer.cookie))
    .status === 403,
  "customer status update denied",
);
for (const status of ["accepted", "preparing", "ready"])
  check(
    (await call("PUT", "/api/orders/" + id, { status }, restaurant.cookie))
      .status === 200,
    "restaurant transition " + status,
  );
const available = (await call("GET", "/api/orders", undefined, driver.cookie))
  .body.orders[0];
check(
  !available.destination &&
    !available.customerId &&
    available.address.startsWith("Accept"),
  "unassigned driver sees redacted order",
);
check(
  (
    await call(
      "PUT",
      "/api/orders/" + id + "/location",
      { lat: -26.2, lng: 28.04, accuracy: 10, capturedAt: Date.now() },
      driver.cookie,
    )
  ).status === 403,
  "GPS before pickup denied",
);
check(
  (
    await call(
      "PUT",
      "/api/orders/" + id,
      { status: "picked_up" },
      driver.cookie,
    )
  ).status === 200,
  "driver pickup",
);
check(
  (
    await call(
      "PUT",
      "/api/orders/" + id,
      { status: "picked_up" },
      otherDriver.cookie,
    )
  ).status === 409,
  "second driver cannot claim",
);
check(
  (
    await call(
      "GET",
      "/api/orders/" + id + "/location",
      undefined,
      stranger.cookie,
    )
  ).status === 403,
  "other customer GPS denied",
);
check(
  (
    await call(
      "GET",
      "/api/orders/" + id + "/location",
      undefined,
      otherDriver.cookie,
    )
  ).status === 403,
  "unassigned driver GPS denied",
);
check(
  (
    await call(
      "PUT",
      "/api/orders/" + id + "/location",
      { lat: -26.2, lng: 28.04, accuracy: 500, capturedAt: Date.now() },
      driver.cookie,
    )
  ).status === 400,
  "inaccurate GPS denied",
);
check(
  (
    await call(
      "PUT",
      "/api/orders/" + id + "/location",
      { lat: -26.2, lng: 28.04, accuracy: 10, capturedAt: Date.now() - 60000 },
      driver.cookie,
    )
  ).status === 400,
  "stale GPS upload denied",
);
check(
  (
    await call(
      "PUT",
      "/api/orders/" + id + "/location",
      { lat: -26.2, lng: 28.04, accuracy: 10, capturedAt: Date.now() },
      driver.cookie,
    )
  ).status === 200,
  "fresh assigned GPS accepted",
);
check(
  (
    await call(
      "GET",
      "/api/orders/" + id + "/location",
      undefined,
      customer.cookie,
    )
  ).body.location?.lat === -26.2,
  "customer gets fresh driver fix",
);
check(
  (
    await call(
      "PUT",
      "/api/orders/" + id + "/location",
      { lat: -26.2, lng: 28.04, accuracy: 10, capturedAt: Date.now() },
      driver.cookie,
    )
  ).status === 409,
  "rapid GPS throttled",
);
sql.prepare("UPDATE locations SET updated_at=?").run(Date.now() - 31000);
check(
  (
    await call(
      "GET",
      "/api/orders/" + id + "/location",
      undefined,
      customer.cookie,
    )
  ).body.location === null,
  "stale fix hidden",
);
check(
  (
    await call(
      "PUT",
      "/api/orders/" + id + "/location",
      { sharing: false },
      driver.cookie,
    )
  ).status === 200,
  "stop sharing",
);
check(
  sql.prepare("SELECT count(*) AS n FROM locations").get().n === 0,
  "stop removes fix",
);
check(
  (
    await call(
      "PUT",
      "/api/orders/" + id + "/location",
      { lat: -26.2, lng: 28.04, accuracy: 10, capturedAt: Date.now() },
      driver.cookie,
    )
  ).status === 200,
  "restart sharing",
);
check(
  (
    await call(
      "PUT",
      "/api/orders/" + id,
      { status: "delivered" },
      driver.cookie,
    )
  ).status === 200,
  "delivery completion",
);
check(
  sql.prepare("SELECT count(*) AS n FROM locations").get().n === 0,
  "completion removes GPS",
);
check(
  (
    await call(
      "PUT",
      "/api/orders/" + id + "/location",
      { lat: -26.2, lng: 28.04, accuracy: 10, capturedAt: Date.now() },
      driver.cookie,
    )
  ).status === 403,
  "completed order cannot upload GPS",
);
check(
  (
    await call(
      "GET",
      "/api/orders/" + id + "/location",
      undefined,
      customer.cookie,
    )
  ).status === 403,
  "completed order location unavailable",
);
console.log(n + " checks passed");
