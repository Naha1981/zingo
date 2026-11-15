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
- This test branch adds email verification and password recovery behind a required sender binding. Without the binding, access fails closed. Do not reuse passwords or add sensitive personal information.
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

## 15 November test branch: all five fixes

Not pushed or deployed. Branch `staging/15nov-auth-onboarding-totals` starts at `3ddb440`. The original AppDeploy host is not changed by this source. Its provider-managed legal URLs require a separate approved provider setting change; the new `/terms`, `/privacy` and `/help` content applies to this Pages source only. These are restricted-preview notices, not production legal signoff.

### Deployment gates (do not deploy this automatically)

1. Apply `cloudflare/migrations/0002_safety.sql` only under separate approved database/deployment authority. Existing accounts have no verified-email record, so existing sessions will be refused until verification. Owner status remains a controlled database grant, never email-based or a public role choice. Do not silently mark existing users verified.
2. Configure an approved email sender binding named `MAILER` with RPC method `send({to,subject,url,expiresAt})`. The binding must deliver the link to that exact address, fail on delivery rejection, never log token URLs, and must not echo the link to the caller. No such sender is provisioned here. Tokens are hashed in the database, expire in 10 minutes (verification/owner) or 15 minutes (reset), and are consumed once by a confirmation POST. Test transport is an in-memory outbox only. No external email was sent. The sender service and DNS/account setup remain an explicit release gate; free-tier quota and deliverability must be checked before choosing one.
3. Owner login requires password plus a single-use email confirmation every new session; owner privilege expires after 30 minutes. This is email step-up, not TOTP, passkeys or hardware MFA. Verify actual sender access, session revocation and recovery in an isolated hosted test before exposing the branch. Audit records contain event type/time/account ID only, not tokens/passwords. Set retention and housekeeping before public launch.
4. Partner setup records service area, contact details, restaurant opening hours/menu review plan and driver vehicle type. It does not collect identity documents or bank details, prove eligibility, edit an operational menu, or verify a real business. Approval requires the owner to record all relevant checks; secure real-world document review and operational menu tooling are not implemented by this patch. Existing approved partner records are not automatically re-approved or rewritten.
5. Completed-today totals use `Africa/Johannesburg` completion date. New completed orders get `deliveredAt`. Historic orders without a trustworthy completion timestamp are excluded, not guessed to have completed today.
6. Fixes 3/4 add a test-only payment adapter and support/cancellation/receipt/refund tooling as described below. Actual provider configuration, sandbox execution, real recipients/fees, production policies and real delivery/GPS validation remain gates. No production settings, data or code were changed.

### Repeatable tests

- `npm test`: inherited backend order/GPS checks (42).
- `npm run test:safety`: isolated SQLite auth/onboarding/privacy/date checks (37).
- `npm run test:services`: test-only payment/support/provider fixtures (47). All provider calls replaced by an in-memory fixture, never a Paystack network call.
- `npm run build`: strict TypeScript and production bundle.
- `ZINGO_PLAYWRIGHT_MODULE=/path/to/existing/playwright npm run test:browser`: 32 browser checks with an isolated in-memory database/mail outbox. Uses an existing Chromium at `/usr/bin/google-chrome`. No package installation or real email/payment required. Four separate browser contexts exercise customer, restaurant, driver and owner. The server is bound only to loopback, never a public deployment.

The fixture passwords, addresses and accounts in tests are synthetic test-only data and are never written to the hosted app. Owner fixtures are promoted only inside the isolated test database.

### Fixes 3 and 4: test-only provider adapter and support

Migration `0003_test_payments_support.sql` is additive and must only be applied under separate deployment authority. It adds test payment attempts, hashed event dedupe, support cases, refunds and order history. Advanced-mode Pages packaging includes `dist/_worker.js/index.js` and `payment-test.js`; no deployment performed.

- Default is unconfigured: no external checkout, no refund and no real payment route. To exercise a separately approved Paystack sandbox, configure `PAYSTACK_TEST_ENABLED=true`, secret `PAYSTACK_TEST_SECRET` starting `sk_test_`, and an independently approved `PAYSTACK_TEST_SPLIT_CODE` starting `SPL_`. Never use live keys. The patch rejects them. This does not validate split recipients, authority, fees, KYC, settlement or custody. No recipients were invented or configured.
- Server amounts use ZAR subunits from the saved order, server reference, configured split, and only HTTPS `checkout.paystack.com`. Provider verification checks reference/amount/currency/test domain before marking paid. Restaurant acceptance blocks an initialized but unverified attempt. Initialization persists before provider calls; timeout retries reuse the row instead of requesting another charge. Ambiguous initialization/refund failures need separate provider reconciliation. No automatic retry that might duplicate money movement.
- Test webhook `/api/payments/paystack-test/webhook` checks raw signatures before parsing and re-fetches transaction/refund status. `PAYSTACK_TEST_WEBHOOK_SECRET` accepts a `whsec_` test secret for modern timestamped `Paystack-Signature`, HMAC SHA-512 and 300-second tolerance. Legacy `x-paystack-signature` is accepted only with no modern secret. Identical verified event bodies dedupe; state updates and one-refund-per-order constraints are idempotent. Actual endpoint delivery remains untested.
- Customers can open one fictional help/cancellation/dispute case of each kind per order and read their own cases/receipts. A request alone does not stop preparation or move money. Owner decisions require a note. Accepted pre-pickup cancellation is saved atomically with its case; pickup/delivered cancellations need separate resolution. Production deadlines/fees/terms still require owner/legal approval.
- Owner full test refunds require a reviewed matching case and verified test payment. Provider acknowledgement stays pending until provider verification or a signed and provider-verified event confirms `processed`. No automatic dispute adjudication, chargeback recovery, partial refunds or real payouts.
- Printable test receipts show item amounts and current payment/refund state. They are not tax invoices or payment proof. Card/bank/identity data is not collected by these forms.
- Email sender, Paystack credentials, webhook, approved split, actual sandbox checkout/refund, deliverability, real recipients and policy signoff remain separate release gates. These changes are source and fixture proof, not hosted readiness. The hosted preview remains unchanged.

Provider references consulted 15 November 2026:

- https://paystack.com/docs/payments/webhooks/
- https://paystack.com/docs/api/transaction/
- https://paystack.com/docs/api/refund/
