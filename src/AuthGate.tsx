import { useEffect, useState } from "react";
import { auth, api } from "./client";
import {
  Bike,
  CheckCircle2,
  Clock3,
  LogIn,
  Store,
  UserRound,
  ShieldCheck,
} from "lucide-react";
import App from "./App";
import "./AuthGate.css";

type Role = "customer" | "restaurant" | "driver" | "admin";
type Profile = {
  role: Role;
  status: "active" | "pending" | "approved" | "rejected";
  fullName: string;
  email?: string;
  businessName?: string;
};

const roleChoices = [
  {
    id: "customer",
    title: "Customer",
    detail: "Discover restaurants and order food.",
    icon: UserRound,
  },
  {
    id: "restaurant",
    title: "Restaurant",
    detail: "Receive orders and manage your restaurant.",
    icon: Store,
  },
  {
    id: "driver",
    title: "Driver",
    detail: "Accept delivery work and earn per delivery.",
    icon: Bike,
  },
] as const;

export default function AuthGate() {
  const [user, setUser] =
    useState<Awaited<ReturnType<typeof auth.getUser>>>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<"customer" | "restaurant" | "driver" | null>(
    null,
  );
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [businessAddress, setBusinessAddress] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [vehicleType, setVehicleType] = useState("Motorcycle");
  const [vehicleRegistration, setVehicleRegistration] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [createAccount, setCreateAccount] = useState(false);
  const [authMode, setAuthMode] = useState("");
  const [setup, setSetup] = useState({
    serviceArea: "",
    operatingHours: "",
    contactEmail: "",
    menuPlan: "",
    eligibilityConfirmed: false,
  });
  const [authHash, setAuthHash] = useState(location.hash);
  useEffect(() => {
    const changed = () => setAuthHash(location.hash);
    addEventListener("hashchange", changed);
    return () => removeEventListener("hashchange", changed);
  }, []);
  const linkParams = new URLSearchParams(authHash.slice(1));
  const linkPurpose = linkParams.get("auth");
  const linkToken = linkParams.get("token");
  const accountAction = async (action: string) => {
    setBusy(true);
    setMessage("");
    try {
      const r = await api.post(
        action === "complete"
          ? "/api/auth/complete"
          : action === "recover"
            ? "/api/auth/recover"
            : "/api/auth/request-verification",
        action === "complete"
          ? { purpose: linkPurpose, token: linkToken, password }
          : { email },
      );
      setMessage(r.data.message || "Owner sign-in confirmed.");
      if (action === "complete") {
        history.replaceState(null, "", location.pathname);
        setAuthHash("");
        setCreateAccount(false);
        setAuthMode("");
        setPassword("");
        await loadProfile();
      }
    } catch (e: any) {
      setMessage(e?.response?.data?.error || "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const loadProfile = async () => {
    const current = await auth.getUser();
    setUser(current);
    if (current) {
      const result = await api.get("/api/profile");
      setProfile(result.data.profile || null);
    } else {
      setProfile(null);
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const current = await auth.getUser();
        if (!mounted) return;
        setUser(current);
        if (current) {
          const result = await api.get("/api/profile");
          if (mounted) setProfile(result.data.profile || null);
        }
      } catch {
        if (mounted)
          setMessage(
            "We could not restore your account. Please reload or sign in again.",
          );
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const result: any = await auth.login(email, password, createAccount);
      if (!result.user)
        setMessage(result.message || "Check your inbox to continue.");
      setPassword("");
      await loadProfile();
    } catch (err: any) {
      setMessage(
        err?.response?.data?.error || "Sign-in failed. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await auth.signOut();
    setUser(null);
    setProfile(null);
    setRole(null);
    setFullName("");
    setPhone("");
    setBusinessName("");
    setBusinessAddress("");
    setCuisine("");
    setVehicleRegistration("");
    setPassword("");
    setEmail("");
    setCreateAccount(false);
    setMessage("");
  };

  const submitOnboarding = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!role) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await api.post("/api/onboarding", {
        role,
        fullName,
        phone,
        businessName,
        businessAddress,
        cuisine,
        vehicleType,
        vehicleRegistration,
        ...setup,
      });
      setProfile(result.data.profile);
    } catch (err: any) {
      setMessage(
        err?.response?.data?.error ||
          "We could not save your application. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (linkPurpose && linkToken)
    return (
      <div className="zg-screen">
        <section className="zg-card">
          <img className="brand-logo" src="/zingo-logo.png" alt="ZINGO" />
          <h1>
            {linkPurpose === "recover"
              ? "Set a new password"
              : linkPurpose === "owner"
                ? "Confirm owner sign-in"
                : "Verify your email"}
          </h1>
          <p>
            Only continue if you requested this link. Links expire and work
            once.
          </p>
          {linkPurpose === "recover" && (
            <label>
              New password
              <input
                aria-label="New password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          )}
          {message && <p role="status">{message}</p>}
          <button
            className="zg-primary"
            disabled={busy}
            onClick={() => accountAction("complete")}
          >
            Confirm
          </button>
          <a href="/">Back to sign in</a>
        </section>
      </div>
    );
  if (loading)
    return (
      <div className="zg-screen">
        <div className="zg-card">
          <div className="zg-logo">
            <img className="brand-logo" src="/zingo-logo.png" alt="ZINGO" />
          </div>
          <p>Preparing your account…</p>
        </div>
      </div>
    );

  if (!user)
    return (
      <div className="zg-screen">
        <section className="zg-card zg-login">
          <div className="zg-logo">
            <img className="brand-logo" src="/zingo-logo.png" alt="ZINGO" />
          </div>
          <p className="zg-kicker">LOCAL FOOD. BETTER EARNINGS.</p>
          <h1>
            One marketplace.
            <br />
            Your place in it.
          </h1>
          <p className="zg-copy">
            Test the ZINGO preview as a customer, restaurant or driver. No real
            food orders or payments.
          </p>
          {message && <div className="zg-alert">{message}</div>}
          {authMode ? (
            <form
              className="zg-form"
              onSubmit={(e) => {
                e.preventDefault();
                accountAction(authMode);
              }}
            >
              <h2>
                {authMode === "recover" ? "Reset password" : "Verify email"}
              </h2>
              <label>
                Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <button className="zg-primary" disabled={busy}>
                Send email link
              </button>
              <button
                type="button"
                className="zg-text-button"
                onClick={() => setAuthMode("")}
              >
                Back to sign in
              </button>
            </form>
          ) : (
            <>
              <form className="zg-form" onSubmit={signIn}>
                <label>
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    minLength={12}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete={
                      createAccount ? "new-password" : "current-password"
                    }
                  />
                </label>
                <small>
                  Use 12 or more characters. Do not reuse another account's
                  password.
                </small>
                <button className="zg-primary" disabled={busy}>
                  <LogIn size={17} />{" "}
                  {busy
                    ? "Please wait…"
                    : createAccount
                      ? "Create preview account"
                      : "Sign in"}
                </button>
              </form>
              <button
                className="zg-text-button"
                onClick={() => {
                  setCreateAccount(!createAccount);
                  setMessage("");
                }}
              >
                {createAccount
                  ? "Already registered? Sign in"
                  : "New here? Create an account"}
              </button>
              <div className="zg-account-links">
                <button
                  className="zg-text-button"
                  onClick={() => setAuthMode("recover")}
                >
                  Forgot password?
                </button>
                <button
                  className="zg-text-button"
                  onClick={() => setAuthMode("verify")}
                >
                  Resend verification
                </button>
              </div>
            </>
          )}
          <p className="zg-legal">
            Test copy only. Use fictional details. Email verification is
            required for access; delivery must be configured before release.
            Owner access requires a password and a single-use email link,
            expires after 30 minutes and cannot be selected at signup. No real
            orders or payments.
          </p>
          <nav className="zg-account-links">
            <a href="/terms">Preview terms</a>
            <a href="/privacy">Privacy</a>
            <a href="/help">Help</a>
          </nav>
        </section>
      </div>
    );

  if (!profile)
    return (
      <div className="zg-screen">
        <section className="zg-card zg-onboard">
          <div className="zg-logo">
            <img className="brand-logo" src="/zingo-logo.png" alt="ZINGO" />
          </div>
          <p className="zg-kicker">ACCOUNT SETUP</p>
          <h1>How will you use ZINGO?</h1>
          <p className="zg-copy">
            Choose the account type you are registering. Your account is
            assigned to this role.
          </p>
          <div className="zg-role-grid">
            {roleChoices.map((choice) => {
              const Icon = choice.icon;
              return (
                <button
                  key={choice.id}
                  type="button"
                  className={
                    role === choice.id ? "zg-role selected" : "zg-role"
                  }
                  onClick={() => setRole(choice.id)}
                >
                  <Icon size={22} />
                  <strong>{choice.title}</strong>
                  <span>{choice.detail}</span>
                </button>
              );
            })}
          </div>
          {role && (
            <form onSubmit={submitOnboarding} className="zg-form">
              <label>
                Full name
                <input
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  autoComplete="name"
                />
              </label>
              {role !== "customer" && (
                <label>
                  Contact phone
                  <input
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+27…"
                    autoComplete="tel"
                  />
                </label>
              )}
              {role === "restaurant" && (
                <>
                  <label>
                    Restaurant / business name
                    <input
                      required
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                    />
                  </label>
                  <label>
                    Restaurant address
                    <input
                      required
                      value={businessAddress}
                      onChange={(e) => setBusinessAddress(e.target.value)}
                    />
                  </label>
                  <label>
                    Cuisine / food type
                    <input
                      value={cuisine}
                      onChange={(e) => setCuisine(e.target.value)}
                      placeholder="e.g. Pizza, burgers, African cuisine"
                    />
                  </label>
                </>
              )}
              {role !== "customer" && (
                <>
                  <label>
                    Service area
                    <input
                      required
                      value={setup.serviceArea}
                      onChange={(e) =>
                        setSetup({ ...setup, serviceArea: e.target.value })
                      }
                      placeholder="Suburbs served"
                    />
                  </label>
                  {role === "restaurant" && (
                    <>
                      <label>
                        Opening hours
                        <input
                          required
                          value={setup.operatingHours}
                          onChange={(e) =>
                            setSetup({
                              ...setup,
                              operatingHours: e.target.value,
                            })
                          }
                          placeholder="Days, opening and closing times"
                        />
                      </label>
                      <label>
                        Business contact email
                        <input
                          type="email"
                          required
                          value={setup.contactEmail}
                          onChange={(e) =>
                            setSetup({ ...setup, contactEmail: e.target.value })
                          }
                        />
                      </label>
                      <label>
                        Menu setup plan
                        <textarea
                          required
                          value={setup.menuPlan}
                          onChange={(e) =>
                            setSetup({ ...setup, menuPlan: e.target.value })
                          }
                          placeholder="Dishes, prices, allergens and availability to review with NahaLabs"
                        />
                      </label>
                    </>
                  )}
                  <label className="zg-check">
                    <input
                      type="checkbox"
                      checked={setup.eligibilityConfirmed}
                      onChange={(e) =>
                        setSetup({
                          ...setup,
                          eligibilityConfirmed: e.target.checked,
                        })
                      }
                      required
                    />
                    {role === "restaurant"
                      ? "I can provide business, food safety and menu details for review before activation."
                      : "I am eligible to deliver and can provide identity and vehicle details through an approved secure review process."}
                  </label>
                  <p className="zg-legal">
                    Do not put ID numbers, documents or bank details here. This
                    form does not verify your identity. NahaLabs must complete
                    the partner checks separately before approval.
                  </p>
                </>
              )}
              {role === "driver" && (
                <>
                  <label>
                    Vehicle type
                    <select
                      value={vehicleType}
                      onChange={(e) => setVehicleType(e.target.value)}
                    >
                      <option>Motorcycle</option>
                      <option>Car</option>
                      <option>Bicycle</option>
                      <option>Scooter</option>
                    </select>
                  </label>
                  {vehicleType !== "Bicycle" && (
                    <label>
                      Vehicle registration
                      <input
                        required
                        value={vehicleRegistration}
                        onChange={(e) => setVehicleRegistration(e.target.value)}
                      />
                    </label>
                  )}
                </>
              )}
              <button className="zg-primary" disabled={busy}>
                {busy ? "Saving…" : "Create my " + role + " account"}
              </button>
            </form>
          )}
          {message && <div className="zg-alert">{message}</div>}
          <button className="zg-text-button" onClick={signOut}>
            Sign out
          </button>
        </section>
      </div>
    );

  if (profile.status === "pending")
    return (
      <div className="zg-screen">
        <section className="zg-card zg-pending">
          <div className="zg-logo">
            <img className="brand-logo" src="/zingo-logo.png" alt="ZINGO" />
          </div>
          <Clock3 size={38} />
          <p className="zg-kicker">APPLICATION RECEIVED</p>
          <h1>We are reviewing your {profile.role} account.</h1>
          <p className="zg-copy">
            ZINGO will activate your workspace after NahaLabs approves your
            application. Return later and check the review status.
          </p>
          <div className="zg-status">
            <CheckCircle2 size={17} /> Submitted · Awaiting review
          </div>
          <button className="zg-primary" onClick={loadProfile}>
            Check review status
          </button>
          <button className="zg-text-button" onClick={signOut}>
            Sign out
          </button>
        </section>
      </div>
    );

  if (profile.status === "rejected")
    return (
      <div className="zg-screen">
        <section className="zg-card">
          <ShieldCheck size={34} />
          <h1>Application not approved</h1>
          <p className="zg-copy">
            Please contact ZINGO support if you believe this decision needs
            review.
          </p>
          <button className="zg-primary" onClick={signOut}>
            Sign out
          </button>
        </section>
      </div>
    );

  return <App role={profile.role} onSignOut={signOut} />;
}
