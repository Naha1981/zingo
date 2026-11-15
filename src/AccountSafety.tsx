import { useEffect, useState } from "react";
import { api } from "./client";
export default function AccountSafety() {
  const [events, setEvents] = useState<
      { action: string; created_at: number }[]
    >([]),
    [notice, setNotice] = useState("");
  useEffect(() => {
    api
      .get("/api/auth/security")
      .then((r) => setEvents(r.data.events || []))
      .catch(() => setNotice("Access history could not be loaded."));
  }, []);
  return (
    <section className="workspace-panel">
      <h2>Owner account safety</h2>
      <p>
        Password plus email confirmation. Owner access expires after 30 minutes.
        No public administrator signup.
      </p>
      <button
        className="refresh-button"
        onClick={async () => {
          if (!confirm("Sign this owner account out on every device?")) return;
          try {
            await api.post("/api/auth/revoke-all", {});
            location.reload();
          } catch {
            setNotice("Could not revoke sessions. Try again.");
          }
        }}
      >
        Sign out all my sessions
      </button>
      {notice && <p role="status">{notice}</p>}
      <details>
        <summary>Recent access events for this account</summary>
        <ul>
          {events.map((e, i) => (
            <li key={i}>
              {e.action.split("_").join(" ")} ·{" "}
              {new Date(e.created_at).toLocaleString("en-ZA", {
                timeZone: "Africa/Johannesburg",
              })}{" "}
              SAST
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
