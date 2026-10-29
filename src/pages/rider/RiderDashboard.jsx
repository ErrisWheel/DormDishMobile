import { useEffect, useMemo, useRef, useState } from 'react';
import { Bike, Camera, CheckCircle2, Clock3, MapPin, Navigation, PackageCheck, Power, RefreshCw, Store, UploadCloud } from 'lucide-react';
import { apiRequest, formatDate, money, resolveImageUrl } from '../../lib/api.js';
import { deliveryDirectionsUrl, deliveryDestinationUrl, storeMapUrl } from '../../lib/maps.js';
import { LiveRiderMap } from '../../components/LiveRiderMap.jsx';
import { MediaImage } from '../../components/MediaImage.jsx';
import { orderStatusLabel } from '../../lib/order-status.js';

// Rider jobs
function fileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('The photo could not be read.'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
    });
}

export function RiderDashboard({ onToast }) {
    const [jobs, setJobs] = useState({ available: [], active: [], history: [] });
    const [isOnline, setIsOnline] = useState(false);
    const [drafts, setDrafts] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [savingId, setSavingId] = useState('');
    const [savingAvailability, setSavingAvailability] = useState(false);
    const [proofBusy, setProofBusy] = useState('');
    const [proofOrderId, setProofOrderId] = useState('');
    const cameraPhotoRef = useRef(null);
    const activeOrderIds = useMemo(() => jobs.active.filter((order) => order.status === 'Out for Delivery').map((order) => order.id), [jobs.active]);
    const activeOrderKey = activeOrderIds.join('|');

    async function refresh(silent = false) {
        if (!silent) setLoading(true);
        try {
            const result = await apiRequest('/rider/jobs');
            setJobs({ available: result.available || [], active: result.active || [], history: result.history || [] });
            setIsOnline(Boolean(result.isOnline));
            setError('');
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            if (!silent) setLoading(false);
        }
    }

    useEffect(() => { void refresh(); }, []);
    useEffect(() => {
        const interval = setInterval(() => void refresh(true), activeOrderKey ? 5000 : 10000);
        return () => clearInterval(interval);
    }, [activeOrderKey]);

    // GPS
    useEffect(() => {
        if (!activeOrderIds.length) return undefined;
        if (!('geolocation' in navigator)) {
            setError('This device does not provide GPS through the browser. Use a phone with location enabled.');
            return undefined;
        }
        const watchers = activeOrderIds.map((orderId) => navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude, accuracy } = position.coords;
                apiRequest(`/orders/${encodeURIComponent(orderId)}/location`, {
                    method: 'POST', body: { latitude, longitude, accuracyM: accuracy }
                }).catch((requestError) => setError(`GPS update failed: ${requestError.message}`));
            },
            (locationError) => setError(`GPS permission/update failed: ${locationError.message}. Allow location access and keep DormDish open while delivering.`),
            { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
        ));
        return () => watchers.forEach((watcherId) => navigator.geolocation.clearWatch(watcherId));
    }, [activeOrderKey]);

    // Availability
    async function toggleAvailability() {
        setSavingAvailability(true);
        setError('');
        try {
            const result = await apiRequest('/rider/availability', { method: 'PATCH', body: { isOnline: !isOnline } });
            setIsOnline(Boolean(result.isOnline));
            onToast(result.isOnline ? 'You are online. Available pickups are now visible.' : 'You are offline. You will not receive new pickup offers.');
            await refresh(true);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSavingAvailability(false);
        }
    }

    // Pickups
    async function acceptPickup(order) {
        setSavingId(order.id);
        setError('');
        try {
            await apiRequest(`/orders/${encodeURIComponent(order.id)}/accept-rider`, { method: 'POST', body: {} });
            onToast('Pickup accepted. Go to the store and confirm pickup after collecting the order.');
            await refresh(true);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSavingId('');
        }
    }

    async function declinePickup(order) {
        setSavingId(order.id);
        setError('');
        try {
            await apiRequest(`/orders/${encodeURIComponent(order.id)}/decline-rider`, { method: 'POST', body: {} });
            await refresh(true);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSavingId('');
        }
    }

    function updateDraft(orderId, key, value) {
        setDrafts((current) => ({
            ...current,
            [orderId]: {
                note: current[orderId]?.note || '',
                locationLabel: current[orderId]?.locationLabel || '',
                etaMinutes: current[orderId]?.etaMinutes ?? '',
                [key]: value
            }
        }));
    }

    async function startDelivery(order) {
        setSavingId(order.id);
        setError('');
        try {
            await apiRequest(`/orders/${encodeURIComponent(order.id)}/progress`, {
                method: 'PATCH', body: { status: 'Out for Delivery', note: 'Rider picked up the order. Live GPS tracking started.' }
            });
            onToast('Pickup confirmed. Allow GPS access to share your live location with the customer.');
            await refresh(true);
        } catch (requestError) { setError(requestError.message); }
        finally { setSavingId(''); }
    }

    async function saveProgress(order) {
        const draft = drafts[order.id] || { note: '', locationLabel: '', etaMinutes: '' };
        setSavingId(order.id);
        setError('');
        try {
            await apiRequest(`/orders/${encodeURIComponent(order.id)}/progress`, {
                method: 'PATCH',
                body: {
                    status: 'Out for Delivery', note: draft.note,
                    locationLabel: draft.locationLabel,
                    etaMinutes: draft.etaMinutes === '' ? null : Number(draft.etaMinutes)
                }
            });
            onToast('Delivery update saved.');
            await refresh(true);
            setDrafts((current) => ({ ...current, [order.id]: { ...draft, note: '' } }));
        } catch (requestError) { setError(requestError.message); }
        finally { setSavingId(''); }
    }

    // Delivery proof
    async function confirmDelivery(file) {
        const orderId = proofOrderId;
        if (!file || !orderId) return;
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) {
            setError('Choose or capture a JPG, PNG, WEBP, or AVIF photo.'); return;
        }
        if (file.size > 5 * 1024 * 1024) { setError('The delivery proof photo must be smaller than 5 MB.'); return; }
        setProofBusy(orderId);
        setError('');
        try {
            const data = await fileAsDataUrl(file);
            await apiRequest(`/orders/${encodeURIComponent(orderId)}/delivery-proof`, {
                method: 'POST', body: { filename: file.name || 'delivery-proof.jpg', mimeType: file.type, data }
            });
            onToast('Delivery confirmed with photo proof.');
            await refresh(true);
        } catch (requestError) { setError(requestError.message); }
        finally {
            setProofBusy('');
            setProofOrderId('');
            if (cameraPhotoRef.current) cameraPhotoRef.current.value = '';
        }
    }

    return (
        <div className="page-stack">
            <div className="dashboard-section-heading">
                <div><span className="eyebrow">RIDER WORKSPACE</span><h1>My deliveries</h1><p>Go online to claim pickup jobs, share GPS, and confirm deliveries with a photo.</p></div>
                <div className="image-upload-actions">
                    <button className={isOnline ? 'secondary-button' : 'primary-button'} onClick={toggleAvailability} disabled={savingAvailability}>
                        <Power size={15} /> {savingAvailability ? 'Saving…' : isOnline ? 'Go offline' : 'Go online'}
                    </button>
                    <button className="secondary-button" onClick={() => refresh(false)}><RefreshCw size={15} /> Refresh</button>
                </div>
            </div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="stats-grid">
                <div className="stat-card"><span>Available pickups</span><strong>{jobs.available.length}</strong><small>{isOnline ? 'Ready to claim' : 'Go online to accept a pickup'}</small></div>
                <div className="stat-card"><span>Active deliveries</span><strong>{jobs.active.length}</strong><small>Jobs claimed by you</small></div>
                <div className="stat-card"><span>Delivered</span><strong>{jobs.history.filter((order) => order.status === 'Delivered').length}</strong><small>Completed with photo proof</small></div>
            </div>

            {loading && <p className="muted-copy">Loading rider jobs…</p>}

            {jobs.available.length > 0 && <section className="section-block">
                <div className="dashboard-section-heading"><div><h2>Available pickups</h2><p>Accept a ready order to claim it. Store staff cannot assign it to you.</p></div></div>
                <div className="order-list">{jobs.available.map((order) => <article className="role-order-card rider-order-card" key={order.id}>
                    <div className="role-order-header"><div><span className="order-number">{order.id}</span><h3>{order.customer_name}</h3><p>{order.store_name} · {formatDate(order.created_at)}</p></div><span className="status-pill status-ready-for-pickup">Ready for Pickup</span></div>
                    <div className="rider-delivery-summary"><div><span>Deliver to</span><strong>{order.delivery_address}</strong></div><div><span>Order total</span><strong>{money(order.total)}</strong></div><div><span>ETA</span><strong>{order.eta_at ? formatDate(order.eta_at) : 'Not set'}</strong></div></div>
                    <div className="rider-order-items">{order.items.map((item) => <span key={item.id}>{item.quantity} × {item.product_name}</span>)}</div>
                    <div className="rider-map-links"><a className="map-link" href={deliveryDirectionsUrl(order)} target="_blank" rel="noreferrer"><Navigation size={16} /> View route & distance</a><a className="map-link" href={storeMapUrl(order)} target="_blank" rel="noreferrer"><Store size={16} /> Open store location</a><a className="map-link" href={deliveryDestinationUrl(order.delivery_address)} target="_blank" rel="noreferrer"><MapPin size={16} /> Open destination</a></div>
                    <div className="tracking-editor-actions"><button className="primary-button" disabled={!isOnline || savingId === order.id} onClick={() => acceptPickup(order)}><Bike size={16} /> {savingId === order.id ? 'Accepting…' : isOnline ? 'Accept pickup' : 'Go online to accept'}</button><button className="secondary-button" disabled={savingId === order.id} onClick={() => declinePickup(order)}>Skip this pickup</button></div>
                </article>)}</div>
            </section>}

            <section className="section-block">
                <div className="dashboard-section-heading"><div><h2>My active deliveries</h2><p>Only orders claimed by your rider account appear here.</p></div></div>
                {!loading && jobs.active.length === 0 && <div className="dashboard-empty"><Bike size={29} /><h3>No active deliveries</h3><p>{jobs.available.length ? 'Claim an available pickup above.' : 'New pickup jobs appear after the store marks an order Ready for Pickup.'}</p></div>}
                {jobs.active.length > 0 && <div className="order-list">{jobs.active.map((order) => {
                    const draft = drafts[order.id] || { note: '', locationLabel: '', etaMinutes: '' };
                    const canStart = order.status === 'Ready for Pickup';
                    const active = order.status === 'Out for Delivery';
                    return <article className="role-order-card rider-order-card" key={order.id}>
                        <div className="role-order-header"><div><span className="order-number">{order.id}</span><h3>{order.customer_name}</h3><p>{order.store_name} · {formatDate(order.created_at)}</p></div><span className={`status-pill status-${order.status.toLowerCase().replaceAll(' ', '-')}`}>{orderStatusLabel(order.status)}</span></div>
                        <div className="rider-delivery-summary"><div><span>Deliver to</span><strong>{order.delivery_address}</strong></div><div><span>Order total</span><strong>{money(order.total)}</strong></div><div><span>ETA</span><strong>{order.eta_at ? formatDate(order.eta_at) : 'Not set'}</strong></div></div>
                        <div className="rider-order-items">{order.items.map((item) => <span key={item.id}>{item.quantity} × {item.product_name}</span>)}</div>
                        <div className="rider-map-links"><a className="map-link" href={deliveryDirectionsUrl(order)} target="_blank" rel="noreferrer"><Navigation size={16} /> View route & distance</a><a className="map-link" href={storeMapUrl(order)} target="_blank" rel="noreferrer"><Store size={16} /> Open store location</a><a className="map-link" href={deliveryDestinationUrl(order.delivery_address)} target="_blank" rel="noreferrer"><MapPin size={16} /> Open destination</a></div>
                        {active && <LiveRiderMap orderId={order.id} status={order.status} role="rider" />}
                        {canStart && <div className="tracking-editor"><div className="tracking-editor-heading"><strong><Bike size={17} /> Confirm pickup</strong><span>Starts live GPS tracking</span></div><p>Tap after you physically collect the order. Your device will ask for location permission so the customer can see the same rider map.</p><button className="primary-button" disabled={savingId === order.id} onClick={() => startDelivery(order)}><Navigation size={16} /> {savingId === order.id ? 'Starting…' : 'Confirm pickup & start GPS'}</button></div>}
                        {active && <div className="tracking-editor"><div className="tracking-editor-heading"><strong><MapPin size={17} /> Live delivery updates</strong><span>{order.tracking?.[0] ? `Last update ${formatDate(order.tracking[0].created_at)}` : 'Waiting for GPS fix'}</span></div><div className="form-grid"><label>ETA from now (minutes)<input type="number" min="0" max="240" value={draft.etaMinutes} onChange={(event) => updateDraft(order.id, 'etaMinutes', event.target.value)} placeholder="Optional" /></label><label>Location note<input value={draft.locationLabel} onChange={(event) => updateDraft(order.id, 'locationLabel', event.target.value)} placeholder="e.g. Near the main gate" /></label><label className="form-span-two">Update note<input value={draft.note} onChange={(event) => updateDraft(order.id, 'note', event.target.value)} placeholder="e.g. Reaching the dorm soon" /></label></div><button className="secondary-button" disabled={savingId === order.id} onClick={() => saveProgress(order)}><CheckCircle2 size={16} /> {savingId === order.id ? 'Saving…' : 'Save delivery note / ETA'}</button><div className="delivery-proof-actions"><strong>Confirm delivered</strong><p>Take a photo of the order at the customer’s handoff point or choose an existing photo. Delivery status changes only after this photo reaches the server.</p><div className="image-upload-actions"><button type="button" className="primary-button" disabled={proofBusy === order.id} onClick={() => { setProofOrderId(order.id); cameraPhotoRef.current?.click(); }}><Camera size={15} /> {proofBusy === order.id ? 'Uploading…' : 'Take delivery proof photo'}</button><span className="image-drop-hint"><UploadCloud size={14} /> Camera capture · max 5 MB</span></div></div></div>}
                    </article>;
                })}</div>}
            </section>

            {jobs.history.length > 0 && <section className="section-block"><div className="dashboard-section-heading"><div><h2>Delivery history</h2><p>Recently completed and cancelled jobs.</p></div></div><div className="order-list">{jobs.history.map((order) => <article className="role-order-card rider-order-card" key={order.id}>
                <div className="role-order-header"><div><span className="order-number">{order.id}</span><h3>{order.customer_name}</h3><p>{order.store_name} · {formatDate(order.updated_at || order.created_at)}</p></div><span className={`status-pill status-${order.status.toLowerCase().replaceAll(' ', '-')}`}>{orderStatusLabel(order.status)}</span></div>
                {order.status === 'Delivered' ? <div className="rider-completed-note"><PackageCheck size={18} /><span>Delivery completed through the rider’s photo-proof flow.</span>{order.delivery_proof_url && <a href={resolveImageUrl(order.delivery_proof_url)} target="_blank" rel="noreferrer"><MediaImage src={order.delivery_proof_url} alt="Delivery proof" className="delivery-proof-media" fallbackText="View proof photo" fallbackSrc="" /></a>}</div> : <p className="muted-copy">This order was cancelled.</p>}
            </article>)}</div></section>}
            <input ref={cameraPhotoRef} className="visually-hidden-file-input" type="file" accept="image/*" capture="environment" onChange={(event) => void confirmDelivery(event.target.files?.[0])} />
        </div>
    );
}
