# ZINGO preview

Separate functional preview: https://zingo-preview.pages.dev/

The existing AppDeploy application is not replaced. Existing AppDeploy accounts and order data are not imported. This preview uses Cloudflare Pages Functions and D1, with its own account registration, sessions, role setup, approvals and test orders. The supplied ZINGO logo is included.

## Run and verify

Node 22 or later is needed for the SQLite-backed test suite.

```sh
npm ci
npm test
npm run build
```

The build type-checks the client, creates `dist/`, and packages the Pages advanced-mode function and API route rules. The backend in use is `cloudflare/worker.js`; `backend/` is retained legacy AppDeploy source and is not deployed by this build.

Cloudflare resources for this preview are recorded in `wrangler.json`. The schema is `cloudflare/schema.sql`. Deploy using an authorized Cloudflare Pages credential supplied through the environment, never committed:

```sh
CLOUDFLARE_ACCOUNT_ID=655bd72036df93c103f655230cf9ade7 npx wrangler@4.156.2 pages deploy dist --project-name zingo-preview --branch main
```

This preview was created on the verified Workers Free plan. Limits are shared with the owner's other applications. Free-plan exhaustion can stop requests or database operations; no paid plan was enabled. Check the current account plan before changing deployment settings.

## Account and order rules

- Registration uses email/password and an HttpOnly, Secure, SameSite=Strict session cookie. Passwords are salted PBKDF2 hashes, not plaintext.
- This is a preview: email verification and password recovery are not implemented. Do not reuse passwords or add sensitive personal information.
- Customers become active after onboarding. Restaurant and driver applications need approval.
- An email address never grants administrator access. The server-side administrator flag is assigned only after a trusted, controlled owner signup. There is no public bootstrap or self-approval endpoint.
- Orders bind to the approved restaurant's stable account ID, not its displayed name. Server menu prices determine totals. Role and state transitions are checked in the API.
- Menus, prices, allocations and test earnings are illustrative. No card details are collected, payment provider connected, money transferred, email sent or delivery dispatched.
- Status refreshes every 10 seconds while the app is visible. There is no websocket claim.

## GPS and navigation

- The customer can add a delivery pin from device GPS or explicit coordinates. An address alone is never converted into a guessed pin.
- Only the assigned, approved driver can upload GPS, and only after pickup. Other drivers do not receive the delivery address or pin before claiming a ready order.
- The customer, assigned driver and approved order-owning restaurant may read that order's active location. GPS is stored separately from general order lists.
- Uploads need a recent fix (30 seconds or less) with accuracy of 250 metres or better; rapid updates are throttled. The client normally sends at most one update per 10 seconds.
- A fix older than 30 seconds is not shown. Stop sharing and delivery completion remove the saved fix. Closing a browser may prevent its stop request; the stale guard still hides the marker. This is not a promise of 30-second database erasure for abandoned sessions.
- The map uses Leaflet and OpenStreetMap standard tiles with attribution. No bulk/offline tile download is used. Public tiles have no uptime guarantee.
- Road navigation opens Google Maps with the confirmed delivery pin, using the documented no-key Maps URL format. This shares the pin with Google. No OSRM public demo service is used by default. An optional compatible routing endpoint can be configured with `VITE_ROUTING_URL`; it must have appropriate usage rights.
- Browsers can suspend GPS when backgrounded, locked, or while Google Maps is open. Keep ZINGO visible for updates. This is not a native background-location service.

## Verification recorded 13 November 2026

- Build and strict client type-check pass.
- The backend suite checks signup, role setup, pending approvals, access boundaries, server prices, order progression, GPS freshness/accuracy, throttling, stale hiding, stop, completion and completion-time upload denial.
- Hosted mobile-browser signup/login, customer order, owner approval, restaurant progression, driver pickup and completion pass.
- Hosted GPS permission-denied handling passes: no driver position is fabricated.
- The Google Maps link opened the test destination and returned road routes.
- Fresh GPS from a physical driver's phone, background tracking, spoken turn-by-turn and a real road delivery have NOT been verified. Do not describe them as passed.

## Rollback

Use the existing AppDeploy application while this preview is being reviewed. Nothing in this deployment changes its code, domain, credentials or data. A Pages deployment can also be rolled back independently in its deployment history. GitHub publication is a separate approval step.
