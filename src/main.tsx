import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Legal from "./Legal";
import AuthGate from "./AuthGate";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {["/terms", "/privacy", "/help"].includes(location.pathname) ? (
      <Legal />
    ) : (
      <AuthGate />
    )}
  </StrictMode>,
);
