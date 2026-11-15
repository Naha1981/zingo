import { useRef, useState } from "react";
import { api } from "./client";
type Case = {
  id: string;
  order_id: string;
  kind: string;
  reason: string;
  status: string;
  response?: string;
};
export default function OrderServices({
  id,
  owner = false,
}: {
  id: string;
  owner?: boolean;
}) {
  const [receipt, setReceipt] = useState<any>(null),
    [cases, setCases] = useState<Case[]>([]),
    [kind, setKind] = useState("help"),
    [reason, setReason] = useState(""),
    [note, setNote] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [configured, setConfigured] = useState(false),
    [checkout, setCheckout] = useState("");
  const printable = useRef<HTMLDivElement>(null);
  const load = async () => {
    try {
      const [r, c, p] = await Promise.all([
        api.get("/api/orders/" + id + "/receipt"),
        api.get("/api/support-cases"),
        api.get("/api/payment-readiness"),
      ]);
      setReceipt(r.data.receipt);
      setCases((c.data.cases || []).filter((v: Case) => v.order_id === id));
      setConfigured(p.data.testConfigured);
    } catch (e: any) {
      setNotice(e?.response?.data?.error || "Could not load receipt.");
    }
  };
  const action = async (path: string, body: any = {}) => {
    setBusy(true);
    setNotice("");
    try {
      const r = await api.post("/api/orders/" + id + "/" + path, body);
      setNotice(r.data.notice || "Test request saved.");
      if (r.data.payment?.authorization_url)
        setCheckout(r.data.payment.authorization_url);
      await load();
    } catch (e: any) {
      setNotice(
        e?.response?.data?.error ||
          "Request not confirmed. Refresh before retrying.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <details
      className="order-services"
      onToggle={(e) => {
        if (e.currentTarget.open) load();
      }}
    >
      <summary>Receipt, test payment & support</summary>
      <p className="fine-print">
        Restricted test only. No real payment, refund or delivery. Never enter
        card, bank or identity details here.
      </p>
      {receipt && (
        <div ref={printable} className="receipt-body">
          <h4>Test receipt · {id.slice(-6).toUpperCase()}</h4>
          <p>
            {receipt.restaurant} · {receipt.status}
          </p>
          <p>
            {receipt.items.map((v: any) => `${v.qty} × ${v.name}`).join(", ")}
          </p>
          <p>
            Food R{receipt.foodSubtotal.toFixed(2)} + delivery R
            {receipt.deliveryFee.toFixed(2)} = R{receipt.total.toFixed(2)}
          </p>
          <p>
            Payment: {receipt.payment.status}. Refund:{" "}
            {receipt.refund?.status || "none"}.
          </p>
          <p>{receipt.notice}</p>
        </div>
      )}
      <button
        className="refresh-button"
        disabled={!receipt}
        onClick={() => {
          if (!printable.current) return;
          document.getElementById("zingo-print-receipt")?.remove();
          const copy = printable.current.cloneNode(true) as HTMLDivElement;
          copy.id = "zingo-print-receipt";
          document.body.appendChild(copy);
          const cleanup = () => copy.remove();
          window.addEventListener("afterprint", cleanup, { once: true });
          window.setTimeout(cleanup, 60000);
          window.print();
        }}
      >
        Print test receipt
      </button>
      <button className="refresh-button" disabled={busy} onClick={load}>
        Refresh receipt
      </button>
      {!configured && (
        <p role="status">
          Paystack test checkout is unavailable until test credentials and an
          approved split configuration are connected. No real payment is
          enabled.
        </p>
      )}
      {!owner && configured && (
        <>
          <button
            className="refresh-button"
            disabled={busy}
            onClick={() => action("test-checkout")}
          >
            Prepare Paystack test checkout
          </button>
          {checkout && (
            <a href={checkout} target="_blank" rel="noopener noreferrer">
              Open Paystack test checkout
            </a>
          )}
          <button
            className="refresh-button"
            disabled={busy}
            onClick={() => action("verify-test-payment")}
          >
            Verify test payment
          </button>
        </>
      )}
      {!owner && (
        <form
          className="zg-form"
          onSubmit={(e) => {
            e.preventDefault();
            action("support", { type: kind, reason });
          }}
        >
          <label>
            Request type
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="help">Help</option>
              <option value="cancellation">Request cancellation</option>
              <option value="dispute">Raise dispute</option>
            </select>
          </label>
          <label>
            Reason
            <textarea
              minLength={5}
              maxLength={1000}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Fictional details only"
            />
          </label>
          <p>
            Submitting a request does not stop preparation or refund a payment.
            The owner must review it. Production policies are not set in this
            preview.
          </p>
          <button className="refresh-button" disabled={busy}>
            Submit test request
          </button>
        </form>
      )}
      {cases.map((c) => (
        <section key={c.id} className="support-case">
          <strong>
            {c.kind} · {c.status}
          </strong>
          <p>{c.reason}</p>
          {c.response && <p>Owner response: {c.response}</p>}
          {owner && (
            <>
              <label>
                Review note
                <textarea
                  aria-label={"Review note " + c.kind}
                  minLength={5}
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
              {c.status === "open" && (
                <div className="zg-account-links">
                  {["accepted", "declined", "resolved"].map((decision) => (
                    <button
                      className="refresh-button"
                      key={decision}
                      disabled={busy || note.trim().length < 5}
                      onClick={() =>
                        action("case-decision", {
                          caseId: c.id,
                          decision,
                          note,
                        })
                      }
                    >
                      {decision} request
                    </button>
                  ))}
                </div>
              )}
              {configured && ["accepted", "resolved"].includes(c.status) && (
                <>
                  <button
                    className="refresh-button"
                    disabled={busy}
                    onClick={() => action("test-refund", { caseId: c.id })}
                  >
                    Request full test refund
                  </button>
                  <button
                    className="refresh-button"
                    disabled={busy}
                    onClick={() => action("verify-test-refund")}
                  >
                    Check test refund status
                  </button>
                </>
              )}
            </>
          )}
        </section>
      ))}
      {notice && <p role="status">{notice}</p>}
    </details>
  );
}
