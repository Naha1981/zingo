import { useCallback, useEffect, useState } from 'react';
import { api } from '@appdeploy/client';
import { Check, RefreshCw, X } from 'lucide-react';

type Application = {
  id: string;
  role: 'restaurant' | 'driver';
  fullName: string;
  email: string;
  phone?: string;
  businessName?: string;
  businessAddress?: string;
  cuisine?: string;
  vehicleType?: string;
  vehicleRegistration?: string;
  createdAt: number;
};

export default function AdminApplications() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.get('/api/admin/applications');
      setApplications(result.data.applications || []);
      setNotice('');
    } catch {
      setNotice('Could not load applications.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    setBusyId(id);
    try {
      await api.put('/api/admin/applications/' + id, { decision });
      setApplications(current => current.filter(item => item.id !== id));
    } catch {
      setNotice('Could not update this application. Refresh and try again.');
    } finally {
      setBusyId('');
    }
  };

  return <section className="workspace-panel" style={{ marginBottom: 22 }}>
    <div className="panel-title">
      <div><h2>Restaurant & driver applications</h2><p>Review new partner accounts before they can operate.</p></div>
      <button className="refresh-button" onClick={refresh} disabled={loading}><RefreshCw size={15} /> Refresh</button>
    </div>
    {notice && <p className="fine-print">{notice}</p>}
    {loading ? <p className="fine-print">Loading applications…</p> : applications.length === 0
      ? <p className="fine-print">No applications waiting for review.</p>
      : <div className="order-list">{applications.map(item => <article className="order-card" key={item.id}>
        <div className="order-card-top"><div><span className="order-id">{item.role.toUpperCase()} APPLICATION</span><h3>{item.role === 'restaurant' ? item.businessName : item.fullName}</h3></div><span className="order-status status-placed">Pending</span></div>
        <div className="order-items"><span>{item.fullName} · {item.email}</span><span>{item.phone || 'No phone supplied'}</span>
          {item.role === 'restaurant' ? <><span>{item.businessAddress}</span><span>{item.cuisine || 'Cuisine not specified'}</span></> : <span>{item.vehicleType} · {item.vehicleRegistration}</span>}
        </div>
        <div className="order-card-bottom"><span>Submitted {new Date(item.createdAt).toLocaleDateString()}</span><div style={{ display:'flex', gap:8 }}><button className="small-action" disabled={busyId===item.id} onClick={() => decide(item.id,'approved')}><Check size={14}/> Approve</button><button className="small-action" disabled={busyId===item.id} onClick={() => decide(item.id,'rejected')}><X size={14}/> Reject</button></div></div>
      </article>)}</div>}
  </section>;
}
