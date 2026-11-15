import { useCallback, useEffect, useState } from "react";
import { api } from "./client";
import { Check, RefreshCw, X } from "lucide-react";

type Application = {
  id: string;
  role: "restaurant" | "driver";
  fullName: string;
  email: string;
  phone?: string;
  businessName?: string;
  businessAddress?: string;
  cuisine?: string;
  vehicleType?: string;
  vehicleRegistration?: string;
  createdAt: number;
  setup?: {
    serviceArea?: string;
    operatingHours?: string;
    contactEmail?: string;
    menuPlan?: string;
  };
};

export default function AdminApplications() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [notice, setNotice] = useState("");
  const [checks, setChecks] = useState<Record<string, string[]>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get("/api/admin/applications");
      setApplications(result.data.applications || []);
      setNotice("");
    } catch {
      setNotice("Could not load applications.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const decide = async (id: string, decision: "approved" | "rejected") => {
    setBusyId(id);
    try {
      await api.put("/api/admin/applications/" + id, {
        decision,
        checks: checks[id] || [],
      });
      setApplications((current) => current.filter((item) => item.id !== id));
    } catch {
      setNotice("Could not update this application. Refresh and try again.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <section className="workspace-panel" style={{ marginBottom: 22 }}>
      <div className="panel-title">
        <div>
          <h2>Restaurant & driver applications</h2>
          <p>Review new partner accounts before they can operate.</p>
        </div>
        <button className="refresh-button" onClick={refresh} disabled={loading}>
          <RefreshCw size={15} /> Refresh
        </button>
      </div>
      {notice && <p className="fine-print">{notice}</p>}
      {loading ? (
        <p className="fine-print">Loading applications…</p>
      ) : applications.length === 0 ? (
        <p className="fine-print">No applications waiting for review.</p>
      ) : (
        <div className="order-list">
          {applications.map((item) => (
            <article className="order-card" key={item.id}>
              <div className="order-card-top">
                <div>
                  <span className="order-id">
                    {item.role.toUpperCase()} APPLICATION
                  </span>
                  <h3>
                    {item.role === "restaurant"
                      ? item.businessName
                      : item.fullName}
                  </h3>
                </div>
                <span className="order-status status-placed">Pending</span>
              </div>
              <div className="order-items">
                <span>
                  {item.fullName} · {item.email}
                </span>
                <span>{item.phone || "No phone supplied"}</span>
                {item.role === "restaurant" ? (
                  <>
                    <span>{item.businessAddress}</span>
                    <span>{item.cuisine || "Cuisine not specified"}</span>
                  </>
                ) : (
                  <span>
                    {item.vehicleType} · {item.vehicleRegistration}
                  </span>
                )}
              </div>
              <p>
                Area: {item.setup?.serviceArea || "Not supplied"}. Hours:{" "}
                {item.setup?.operatingHours || "Not supplied"}
              </p>
              <p>
                {item.setup?.contactEmail} {item.setup?.menuPlan}
              </p>
              <fieldset>
                <legend>Partner checks completed outside this form</legend>
                {(item.role === "driver"
                  ? ["identity", "vehicle", "contact", "service-area"]
                  : ["business", "menu", "contact", "service-area"]
                ).map((key) => (
                  <label className="zg-check" key={key}>
                    <input
                      type="checkbox"
                      checked={(checks[item.id] || []).includes(key)}
                      onChange={(e) =>
                        setChecks({
                          ...checks,
                          [item.id]: e.target.checked
                            ? [...(checks[item.id] || []), key]
                            : (checks[item.id] || []).filter((k) => k !== key),
                        })
                      }
                    />
                    {key}
                  </label>
                ))}
                <small>
                  No automated identity or document verification is claimed.
                  Approval records these reviewed checks.
                </small>
              </fieldset>
              <div className="order-card-bottom">
                <span>
                  Submitted {new Date(item.createdAt).toLocaleDateString()}
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="small-action"
                    disabled={
                      busyId === item.id || (checks[item.id] || []).length !== 4
                    }
                    onClick={() => decide(item.id, "approved")}
                  >
                    <Check size={14} /> Approve
                  </button>
                  <button
                    className="small-action"
                    disabled={busyId === item.id}
                    onClick={() => decide(item.id, "rejected")}
                  >
                    <X size={14} /> Reject
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
