import { useEffect, useMemo, useState } from 'react';
import { Bike, CheckCircle2, Clock3, ExternalLink, MapPin, Navigation, PackageCheck, RefreshCw, Store, ToggleLeft, ToggleRight, Wallet, Zap } from 'lucide-react';
import { apiRequest, formatDate, money } from '../../lib/api.js';
import { deliveryDirectionsUrl, deliveryDestinationUrl, storeMapUrl } from '../../lib/maps.js';

function StatusPill({ status }) {
    return <span className={`status-pill status-${status.toLowerCase().replaceAll(' ', '-')}`}>{status}</span>;
}

function JobRouteLinks({ order }) {
    return <div className="rider-map-links">
        <a className="map-link" href={deliveryDirectionsUrl(order)} target="_blank" rel="noreferrer"><Navigation size={16} /> View route & distance <ExternalLink size={13} /></a>
        <a className="map-link" href={storeMapUrl(order)} target="_blank" rel="noreferrer"><Store size={16} /> Open store location</a>
        <a className="map-link" href={deliveryDestinationUrl(order.delivery_address)} target="_blank" rel="noreferrer"><MapPin size={16} /> Open destination</a>
    </div>;
}

function JobSummary({ order }) {
    return <>
        <div className="rider-delivery-summary">
            <div><span>Pickup</span><strong>{order.store_name}</strong>{order.location_name && <small>{order.location_name}</small>}</div>
            <div><span>Deliver to</span><strong>{order.delivery_address}</strong></div>
            <div><span>Order total</span><strong>{money(order.total)}</strong></div>
            <div><span>ETA</span><strong>{order.eta_at ? formatDate(order.eta_at) : 'Not set'}</strong></div>
        </div>
        {order.order_notes && <p className="rider-customer-note"><strong>Delivery instructions:</strong> {order.order_notes}</p>}
        <div className="rider-order-items">{order.items.map((item) => <span key={item.id}>{item.quantity} × {item.product_name}</span>)}</div>
        <JobRouteLinks order={order} />
    </>;
}

export function RiderDashboard({ onToast }) {
    const [availableJobs, setAvailableJobs] = useState([]);
    const [activeDeliveries, setActiveDeliveries] = useState([]);
    const [history, setHistory] = useState([]);
    const [isOnline, setIsOnline] = useState(false);
    const [drafts, setDrafts] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [savingId, setSavingId] = useState('');

    async function refresh(silent = false) {
        if (!silent) setLoading(true);
        try {
            const result = await apiRequest('/rider/jobs');
            setAvailableJobs(result.available || []);
            setActiveDeliveries(result.active || []);
            setHistory(result.history || []);
            setIsOnline(Boolean(result.isOnline));
            setError('');
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            if (!silent) setLoading(false);
        }
    }

    useEffect(() => {
        refresh();
        const interval = setInterval(() => refresh(true), 15000);
        return () => clearInterval(interval);
    }, []);

    async function toggleAvailability() {
        const next = !isOnline;
        setSavingId('availability');
        setError('');
        try {
            const result = await apiRequest('/rider/availability', { method: 'PATCH', body: { isOnline: next } });
            setIsOnline(Boolean(result.isOnline));
            onToast(next ? 'You are online and can receive delivery offers.' : 'You are offline. You will not receive new offers.');
            await refresh(true);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSavingId('');
        }
    }

    async function respondToOffer(order, action) {
        setSavingId(order.id);
        setError('');
        try {
            if (action === 'accept') {
                await apiRequest(`/orders/${encodeURIComponent(order.id)}/accept-rider`, { method: 'POST', body: {} });
                onToast('Delivery accepted. Head to the store for pickup.');
            } else {
                await apiRequest(`/orders/${encodeURIComponent(order.id)}/decline-rider`, { method: 'POST', body: {} });
                onToast('Delivery offer skipped.');
            }
            await refresh(true);
        } catch (requestError) {
            setError(requestError.message);
            await refresh(true);
        } finally {
            setSavingId('');
        }
    }

    function updateDraft(orderId, key, value, order) {
        setDrafts((current) => ({
            ...current,
            [orderId]: {
                status: current[orderId]?.status || (order.status === 'Ready for Pickup' ? 'Out for Delivery' : 'Delivered'),
                note: current[orderId]?.note || '',
                locationLabel: current[orderId]?.locationLabel || '',
                etaMinutes: current[orderId]?.etaMinutes ?? '',
                [key]: value
            }
        }));
    }

    async function saveDelivery(order) {
        const draft = drafts[order.id] || { status: order.status === 'Ready for Pickup' ? 'Out for Delivery' : 'Delivered', note: '', locationLabel: '', etaMinutes: '' };
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
            onToast(draft.status === 'Out for Delivery' ? 'Pickup confirmed. Delivery is now on the way.' : 'Delivery marked as completed.');
            setDrafts((current) => ({ ...current, [order.id]: { ...draft, note: '' } }));
            await refresh(true);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSavingId('');
        }
    }

    const completed = useMemo(() => history.filter((order) => order.status === 'Delivered'), [history]);
    const estimatedFees = completed.reduce((sum, order) => sum + Number(order.delivery_fee || 0), 0);

    return (
        <div className="page-stack rider-dashboard">
            <div className="dashboard-section-heading">
                <div><span className="eyebrow">RIDER WORKSPACE</span><h1>Delivery partner</h1><p>Manage availability, accept jobs, navigate to pickup, and confirm handoff.</p></div>
                <button className="secondary-button" onClick={() => refresh(false)} disabled={loading}><RefreshCw size={15} /> Refresh</button>
            </div>

            <section className={`rider-presence-panel ${isOnline ? 'is-online' : 'is-offline'}`}>
                <div className="rider-presence-copy"><span className="rider-presence-dot" /><div><strong>{isOnline ? 'You are online' : 'You are offline'}</strong><p>{isOnline ? 'You can receive delivery offers from your assigned store.' : 'Go online when you are ready to accept delivery offers.'}</p></div></div>
                <button className={isOnline ? 'secondary-button' : 'primary-button'} onClick={toggleAvailability} disabled={savingId === 'availability'}>
                    {isOnline ? <ToggleRight size={19} /> : <ToggleLeft size={19} />}{savingId === 'availability' ? 'Updating…' : isOnline ? 'Go offline' : 'Go online'}
                </button>
            </section>

            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="stats-grid rider-stats-grid">
                <div className="stat-card"><span>Available offers</span><strong>{isOnline ? availableJobs.length : '—'}</strong><small>{isOnline ? 'Ready for pickup' : 'Go online to receive offers'}</small></div>
                <div className="stat-card"><span>Active deliveries</span><strong>{activeDeliveries.length}</strong><small>Accepted jobs to complete</small></div>
                <div className="stat-card"><span>Completed</span><strong>{completed.length}</strong><small>Delivered jobs in recent history</small></div>
                <div className="stat-card"><span>Estimated delivery fees</span><strong>{money(estimatedFees)}</strong><small>Historical order fees, not guaranteed rider pay</small></div>
            </div>

            {loading ? <p className="muted-copy">Loading delivery jobs…</p> : <>
                <section className="section-block rider-jobs-section">
                    <div className="dashboard-section-heading"><div><h2><Zap size={20} /> Available jobs</h2><p>Offers are only available for orders at your assigned store that are ready for pickup.</p></div></div>
                    {!isOnline ? <div className="dashboard-empty"><Bike size={28} /><h3>You are offline</h3><p>Go online to see and accept available deliveries.</p></div> : availableJobs.length ? <div className="order-list">
                        {availableJobs.map((order) => <article className="role-order-card rider-offer-card" key={order.id}>
                            <div className="role-order-header"><div><span className="order-number">{order.id}</span><h3>{order.customer_name}</h3><p>{formatDate(order.created_at)}</p></div><StatusPill status={order.status} /></div>
                            <JobSummary order={order} />
                            <div className="rider-offer-actions"><button className="primary-button" disabled={savingId === order.id} onClick={() => respondToOffer(order, 'accept')}><CheckCircle2 size={17} /> {savingId === order.id ? 'Updating…' : 'Accept delivery'}</button><button className="secondary-button" disabled={savingId === order.id} onClick={() => respondToOffer(order, 'decline')}>Skip offer</button></div>
                        </article>)}
                    </div> : <div className="dashboard-empty"><PackageCheck size={28} /><h3>No offers right now</h3><p>New jobs appear when your store marks customer orders ready for pickup.</p></div>}
                </section>

                <section className="section-block rider-jobs-section">
                    <div className="dashboard-section-heading"><div><h2><Bike size={20} /> My active deliveries</h2><p>Confirm pickup, start the route, and mark the handoff complete.</p></div></div>
                    {activeDeliveries.length ? <div className="order-list">{activeDeliveries.map((order) => {
                        const draft = drafts[order.id] || { status: order.status === 'Ready for Pickup' ? 'Out for Delivery' : 'Delivered', note: '', locationLabel: '', etaMinutes: '' };
                        const nextStatus = order.status === 'Ready for Pickup' ? 'Out for Delivery' : 'Delivered';
                        return <article className="role-order-card rider-order-card" key={order.id}>
                            <div className="role-order-header"><div><span className="order-number">{order.id}</span><h3>{order.customer_name}</h3><p>{order.store_name} · {formatDate(order.created_at)}</p></div><StatusPill status={order.status} /></div>
                            <JobSummary order={order} />
                            <div className="tracking-editor"><div className="tracking-editor-heading"><strong><Clock3 size={17} /> Delivery update</strong><span>{order.tracking?.[0] ? `Last update ${formatDate(order.tracking[0].created_at)}` : 'No updates yet'}</span></div>
                                <div className="form-grid"><label>ETA from now (minutes)<input type="number" min="0" max="240" value={draft.etaMinutes} onChange={(event) => updateDraft(order.id, 'etaMinutes', event.target.value, order)} placeholder="Optional" /></label><label>Location label<input value={draft.locationLabel} onChange={(event) => updateDraft(order.id, 'locationLabel', event.target.value, order)} placeholder="e.g. Near the main gate" /></label><label className="form-span-two">Update note<input value={draft.note} onChange={(event) => updateDraft(order.id, 'note', event.target.value, order)} placeholder={nextStatus === 'Delivered' ? 'e.g. Handed to customer' : 'e.g. Leaving the store'} /></label></div>
                                <button className="primary-button" disabled={savingId === order.id} onClick={() => saveDelivery(order)}><CheckCircle2 size={16} /> {savingId === order.id ? 'Saving…' : nextStatus === 'Out for Delivery' ? 'Confirm pickup & start delivery' : 'Mark as delivered'}</button>
                            </div>
                        </article>;
                    })}</div> : <div className="dashboard-empty"><Bike size={28} /><h3>No active deliveries</h3><p>Accept an available job to start a delivery.</p></div>}
                </section>

                <section className="section-block rider-jobs-section">
                    <div className="dashboard-section-heading"><div><h2><Wallet size={20} /> Recent delivery history</h2><p>Delivery fees are shown for reference and do not represent a confirmed rider payout.</p></div></div>
                    {history.length ? <div className="order-list">{history.slice(0, 10).map((order) => <article className="role-order-card rider-history-card" key={order.id}><div className="role-order-header"><div><span className="order-number">{order.id}</span><h3>{order.customer_name}</h3><p>{order.store_name} · {formatDate(order.updated_at)}</p></div><StatusPill status={order.status} /></div><div className="rider-delivery-summary"><div><span>Delivery address</span><strong>{order.delivery_address}</strong></div><div><span>Order total</span><strong>{money(order.total)}</strong></div><div><span>Delivery fee</span><strong>{money(order.delivery_fee)}</strong></div></div></article>)}</div> : <div className="dashboard-empty"><Clock3 size={26} /><h3>No completed jobs yet</h3><p>Your delivery history will appear here.</p></div>}
                </section>
            </>}
        </div>
    );
}
