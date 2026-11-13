import { useEffect, useState } from 'react';
import { auth, api } from '@appdeploy/client';
import { Bike, CheckCircle2, Clock3, LogIn, Store, UserRound, Utensils, ShieldCheck } from 'lucide-react';
import App from './App';
import './AuthGate.css';

type Role = 'customer' | 'restaurant' | 'driver' | 'admin';
type Profile = {
  role: Role;
  status: 'active' | 'pending' | 'approved' | 'rejected';
  fullName: string;
  email?: string;
  businessName?: string;
};

const roleChoices = [
  { id: 'customer', title: 'Customer', detail: 'Discover restaurants and order food.', icon: UserRound },
  { id: 'restaurant', title: 'Restaurant', detail: 'Receive orders and manage your restaurant.', icon: Store },
  { id: 'driver', title: 'Driver', detail: 'Accept delivery work and earn per delivery.', icon: Bike },
] as const;

export default function AuthGate() {
  const [user, setUser] = useState<Awaited<ReturnType<typeof auth.getUser>>>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [role, setRole] = useState<'customer' | 'restaurant' | 'driver' | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [cuisine, setCuisine] = useState('');
  const [vehicleType, setVehicleType] = useState('Motorcycle');
  const [vehicleRegistration, setVehicleRegistration] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const loadProfile = async () => {
    const current = await auth.getUser();
    setUser(current);
    if (current) {
      const result = await api.get('/api/profile');
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
          const result = await api.get('/api/profile');
          if (mounted) setProfile(result.data.profile || null);
        }
      } catch {
        if (mounted) setMessage('We could not restore your account. Please reload or sign in again.');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  const signIn = async () => {
    setBusy(true);
    setMessage('');
    try {
      await auth.signInWithRedirect();
    } catch {
      setMessage('Sign-in could not start. Check browser storage and try again.');
      setBusy(false);
    }
  };

  const signOut = async () => {
    await auth.signOut();
    setUser(null);
    setProfile(null);
    setRole(null);
    setMessage('');
  };

  const submitOnboarding = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!role) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await api.post('/api/onboarding', {
        role, fullName, phone, businessName, businessAddress, cuisine,
        vehicleType, vehicleRegistration,
      });
      setProfile(result.data.profile);
    } catch (err: any) {
      setMessage(err?.response?.data?.error || 'We could not save your application. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="zg-screen"><div className="zg-card"><div className="zg-logo"><img className="brand-logo" src="/zingo-logo.png" alt="ZINGO" /></div><p>Preparing your account…</p></div></div>;

  if (!user) return (
    <div className="zg-screen">
      <section className="zg-card zg-login">
        <div className="zg-logo"><img className="brand-logo" src="/zingo-logo.png" alt="ZINGO" /></div>
        <p className="zg-kicker">LOCAL FOOD. BETTER EARNINGS.</p>
        <h1>One marketplace.<br />Your place in it.</h1>
        <p className="zg-copy">Sign in to order food, run your restaurant or deliver with ZINGO.</p>
        {message && <div className="zg-alert">{message}</div>}
        <button className="zg-primary" disabled={busy} onClick={signIn}><LogIn size={17} /> Continue with secure sign-in</button>
        <p className="zg-legal">By continuing, you agree to ZINGO's terms and privacy policy. Add the final legal links before public launch.</p>
      </section>
    </div>
  );

  if (!profile) return (
    <div className="zg-screen">
      <section className="zg-card zg-onboard">
        <div className="zg-logo"><img className="brand-logo" src="/zingo-logo.png" alt="ZINGO" /></div>
        <p className="zg-kicker">ACCOUNT SETUP</p>
        <h1>How will you use ZINGO?</h1>
        <p className="zg-copy">Choose the account type you are registering. Your account is assigned to this role.</p>
        <div className="zg-role-grid">
          {roleChoices.map(choice => {
            const Icon = choice.icon;
            return <button key={choice.id} type="button" className={role === choice.id ? 'zg-role selected' : 'zg-role'} onClick={() => setRole(choice.id)}>
              <Icon size={22} /><strong>{choice.title}</strong><span>{choice.detail}</span>
            </button>;
          })}
        </div>
        {role && <form onSubmit={submitOnboarding} className="zg-form">
          <label>Full name<input required value={fullName} onChange={e => setFullName(e.target.value)} autoComplete="name" /></label>
          {role !== 'customer' && <label>Contact phone<input required value={phone} onChange={e => setPhone(e.target.value)} placeholder="+27…" autoComplete="tel" /></label>}
          {role === 'restaurant' && <>
            <label>Restaurant / business name<input required value={businessName} onChange={e => setBusinessName(e.target.value)} /></label>
            <label>Restaurant address<input required value={businessAddress} onChange={e => setBusinessAddress(e.target.value)} /></label>
            <label>Cuisine / food type<input value={cuisine} onChange={e => setCuisine(e.target.value)} placeholder="e.g. Pizza, burgers, African cuisine" /></label>
          </>}
          {role === 'driver' && <>
            <label>Vehicle type<select value={vehicleType} onChange={e => setVehicleType(e.target.value)}><option>Motorcycle</option><option>Car</option><option>Bicycle</option><option>Scooter</option></select></label>
            <label>Vehicle registration<input required value={vehicleRegistration} onChange={e => setVehicleRegistration(e.target.value)} /></label>
          </>}
          <button className="zg-primary" disabled={busy}>{busy ? 'Saving…' : 'Create my ' + role + ' account'}</button>
        </form>}
        {message && <div className="zg-alert">{message}</div>}
        <button className="zg-text-button" onClick={signOut}>Sign out</button>
      </section>
    </div>
  );

  if (profile.status === 'pending') return (
    <div className="zg-screen">
      <section className="zg-card zg-pending">
        <Clock3 size={38} />
        <p className="zg-kicker">APPLICATION RECEIVED</p>
        <h1>We are reviewing your {profile.role} account.</h1>
        <p className="zg-copy">ZINGO will activate your workspace after NahaLabs approves your application. You can sign out and return later.</p>
        <div className="zg-status"><CheckCircle2 size={17} /> Submitted · Awaiting review</div>
        <button className="zg-primary" onClick={signOut}>Sign out</button>
      </section>
    </div>
  );

  if (profile.status === 'rejected') return (
    <div className="zg-screen"><section className="zg-card"><ShieldCheck size={34} /><h1>Application not approved</h1><p className="zg-copy">Please contact ZINGO support if you believe this decision needs review.</p><button className="zg-primary" onClick={signOut}>Sign out</button></section></div>
  );

  return <App role={profile.role} onSignOut={signOut} />;
}
