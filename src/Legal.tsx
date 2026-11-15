export default function Legal() {
  const kind = location.pathname;
  return (
    <main className="zg-screen">
      <article className="zg-card zg-legal-page">
        <img className="brand-logo" src="/zingo-logo.png" alt="ZINGO" />
        <h1>
          {kind === "/terms"
            ? "ZINGO preview terms"
            : kind === "/privacy"
              ? "Preview privacy notice"
              : "Preview help"}
        </h1>
        {kind === "/terms" ? (
          <>
            <p>
              This is a restricted NahaLabs test preview, not a live delivery
              marketplace. Use fictional account, restaurant, driver and
              delivery details only.
            </p>
            <p>
              Menus, ratings, prices and earnings are illustrative. No real
              order, payment, payout or delivery is arranged. Do not enter card,
              bank or identity document details.
            </p>
            <p>
              These preview rules do not replace reviewed terms for a real
              service. A public launch needs a confirmed operator, service
              terms, refund process and support channel.
            </p>
          </>
        ) : kind === "/privacy" ? (
          <>
            <p>
              The preview stores account email, password hashes, verification
              status, role setup, test orders and access-event records. Partner
              applications are shown to the owner. Order access is limited by
              account role.
            </p>
            <p>
              Optional delivery pins and driver GPS are shared with the assigned
              order participants. Google Maps receives the delivery pin when you
              open navigation. Do not use a real person's details in this test.
            </p>
            <p>
              Production retention periods, privacy contact and deletion/export
              handling need owner review before launch. Email links are
              short-lived and single-use. Password recovery revokes previous
              sessions.
            </p>
          </>
        ) : (
          <>
            <p>
              For this restricted test, return issues to the NahaLabs person who
              invited you. Do not use the preview for a real order or emergency.
            </p>
            <p>
              Use Resend verification or Forgot password on the sign-in page. If
              email delivery is not configured, access stays blocked. There is
              no paid workaround.
            </p>
            <p>
              Restaurant and driver accounts stay pending until reviewed. Never
              send passwords, bank details or identity documents through an
              ordinary message.
            </p>
          </>
        )}
        <a href="/">Back to ZINGO</a>
      </article>
    </main>
  );
}
