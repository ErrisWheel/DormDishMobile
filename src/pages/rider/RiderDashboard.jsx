import { useEffect, useState } from 'react';
import { Bike, CheckCircle2, Clock3, ExternalLink, MapPin, Navigation, PackageCheck, RefreshCw, Store } from 'lucide-react';
import { apiRequest, formatDate, money } from '../../lib/api.js';
import { deliveryDirectionsUrl, deliveryDestinationUrl, storeMapUrl } from '../../lib/maps.js';

export function RiderDashboard({ onToast }) {
    const [deliveries, setDeliveries] = useState([]);
    const [drafts, setDrafts] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [savingId, setSavingId] = useState('');

    async function refresh(silent = false) {
        if (!silent) {
            setLoading(true);
        }
        try {
            const result = await apiRequest('/orders');
            setDeliveries(result.orders);
            setError('');
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    }

    useEffect(() => {
        refresh();
        const interval = setInterval(() => refresh(true), 20000);
        return () => clearInterval(interval);
    }, []);

    function updateDraft(orderId, key, value, order) {
        setDrafts((current) => ({
            ...current,
            [orderId]: {
                status: current[orderId]?.status || order.status,
                note: current[orderId]?.note || '',
                locationLabel: current[orderId]?.locationLabel || '',
                etaMinutes: current[orderId]?.etaMinutes ?? '',
                [key]: value
            }
        }));
    }

    async function saveDelivery(order) {
        const draft = drafts[order.id] || { status: order.status, note: '', locationLabel: '', etaMinutes: '' };
        setSavingId(order.id);
        setError('');

        try {
            await apiRequest(`/orders/${encodeURIComponent(order.id)}/progress`, {
                method: 'PATCH',
                body: {
                    status: draft.status,
                    note: draft.note,
                    locationLabel: draft.locationLabel,
                    etaMinutes: draft.etaMinutes === '' ? null : Number(draft.etaMinutes)
                }
            });
            onToast('Delivery progress saved.');
            await refresh();
            setDrafts((current) => ({ ...current, [order.id]: { ...draft, note: '' } }));
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSavingId('');
        }
    }

    return (
        <div className="page-stack">
            <div className="dashboard-section-heading"><div><span className="eyebrow">RIDER WORKSPACE</span><h1>My deliveries</h1><p>Only deliveries assigned to your rider account and store are shown.</p></div><button className="secondary-button" onClick={() => refresh(false)}><RefreshCw size={15} /> Refresh</button></div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="stats-grid"><div className="stat-card"><span>Assigned deliveries</span><strong>{deliveries.length}</strong><small>Your delivery queue</small></div><div className="stat-card"><span>In progress</span><strong>{deliveries.filter((order) => order.status === 'Out for Delivery').length}</strong><small>Currently on the way</small></div><div className="stat-card"><span>Delivered</span><strong>{deliveries.filter((order) => order.status === 'Delivered').length}</strong><small>Completed assignments</small></div></div>
            {loading ? <p className="muted-copy">Loading deliveries…</p> : deliveries.length ? <div className="order-list">{deliveries.map((order) => {
                const draft = drafts[order.id] || { status: order.status, note: '', locationLabel: '', etaMinutes: '' };
                const canUpdate = order.status === 'Out for Delivery';
                return <article className="role-order-card rider-order-card" key={order.id}><div className="role-order-header"><div><span className="order-number">{order.id}</span><h3>{order.customer_name}</h3><p>{order.store_name} · {formatDate(order.created_at)}</p></div><span className={`status-pill status-${order.status.toLowerCase().replaceAll(' ', '-')}`}>{order.status}</span></div><div className="rider-delivery-summary"><div><span>Deliver to</span><strong>{order.delivery_address}</strong></div><div><span>Order total</span><strong>{money(order.total)}</strong></div><div><span>ETA</span><strong>{order.eta_at ? formatDate(order.eta_at) : 'Not set'}</strong></div></div><div className="rider-order-items">{order.items.map((item) => <span key={item.id}>{item.quantity} × {item.product_name}</span>)}</div><div className="rider-map-links"><a className="map-link" href={deliveryDirectionsUrl(order)} target="_blank" rel="noreferrer"><Navigation size={16} /> View route & distance <ExternalLink size={13} /></a><a className="map-link" href={storeMapUrl(order)} target="_blank" rel="noreferrer"><Store size={16} /> Open store location</a><a className="map-link" href={deliveryDestinationUrl(order.delivery_address)} target="_blank" rel="noreferrer"><MapPin size={16} /> Open destination</a></div>{canUpdate ? <div className="tracking-editor"><div className="tracking-editor-heading"><strong><Bike size={17} /> Simulated tracking update</strong><span>{order.tracking?.[0] ? `Last update ${formatDate(order.tracking[0].created_at)}` : 'No updates yet'}</span></div><div className="form-grid"><label>Status<select value={draft.status} onChange={(event) => updateDraft(order.id, 'status', event.target.value, order)}><option value="Out for Delivery">Out for Delivery</option><option value="Delivered">Delivered</option></select></label><label>ETA from now (minutes)<input type="number" min="0" max="240" value={draft.etaMinutes} onChange={(event) => updateDraft(order.id, 'etaMinutes', event.target.value, order)} placeholder="Optional" /></label><label>Location label<input value={draft.locationLabel} onChange={(event) => updateDraft(order.id, 'locationLabel', event.target.value, order)} placeholder="e.g. Near the main gate" /></label><label>Update note<input value={draft.note} onChange={(event) => updateDraft(order.id, 'note', event.target.value, order)} placeholder="e.g. Reaching campus soon" /></label></div><button className="primary-button" disabled={savingId === order.id} onClick={() => saveDelivery(order)}><CheckCircle2 size={16} /> {savingId === order.id ? 'Saving…' : 'Save delivery progress'}</button></div> : <div className="rider-completed-note"><PackageCheck size={18} /><span>{order.status === 'Delivered' ? 'Delivery completed.' : order.status === 'Cancelled' ? 'This order was cancelled.' : 'Waiting for the Store Manager to mark the order Out for Delivery.'}</span></div>}</article>;
            })}</div> : <div className="dashboard-empty"><Bike size={29} /><h3>No assigned deliveries</h3><p>Your store manager will assign deliveries when orders are ready.</p></div>}
        </div>
    );
}
