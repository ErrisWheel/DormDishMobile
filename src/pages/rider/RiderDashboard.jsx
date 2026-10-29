import { useEffect, useMemo, useRef, useState } from 'react';
import { Bike, Camera, CheckCircle2, Clock3, ImagePlus, MapPin, Navigation, PackageCheck, RefreshCw, Store, UploadCloud } from 'lucide-react';
import { apiRequest, formatDate, money } from '../../lib/api.js';
import { deliveryDirectionsUrl, deliveryDestinationUrl, storeMapUrl } from '../../lib/maps.js';
import { LiveRiderMap } from '../../components/LiveRiderMap.jsx';

function fileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('The photo could not be read.'));
        reader.onload = () => resolve(String(reader.result || ''));
        reader.readAsDataURL(file);
    });
}

export function RiderDashboard({ onToast }) {
    const [deliveries, setDeliveries] = useState([]);
    const [drafts, setDrafts] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [savingId, setSavingId] = useState('');
    const [proofBusy, setProofBusy] = useState('');
    const [proofOrderId, setProofOrderId] = useState('');
    const cameraPhotoRef = useRef(null);
    const activeOrderIds = useMemo(() => deliveries.filter((order) => order.status === 'Out for Delivery').map((order) => order.id), [deliveries]);
    const activeOrderKey = activeOrderIds.join('|');

    async function refresh(silent = false) {
        if (!silent) setLoading(true);
        try {
            const result = await apiRequest('/orders');
            setDeliveries(result.orders);
            setError('');
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            if (!silent) setLoading(false);
        }
    }

    useEffect(() => {
        refresh();
        const interval = setInterval(() => refresh(true), activeOrderKey ? 5000 : 15000);
        return () => clearInterval(interval);
    }, [activeOrderKey]);

    // The phone's Geolocation API supplies actual device GPS coordinates while the rider has an active delivery.
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
                    method: 'POST',
                    body: { latitude, longitude, accuracyM: accuracy }
                }).catch((requestError) => setError(`GPS update failed: ${requestError.message}`));
            },
            (locationError) => setError(`GPS permission/update failed: ${locationError.message}. Allow location access and keep DormDish open while delivering.`),
            { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 }
        ));
        return () => watchers.forEach((watcherId) => navigator.geolocation.clearWatch(watcherId));
    }, [activeOrderKey]);

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

    async function startDelivery(order) {
        setSavingId(order.id); setError('');
        try {
            await apiRequest(`/orders/${encodeURIComponent(order.id)}/progress`, {
                method: 'PATCH',
                body: { status: 'Out for Delivery', note: 'Rider picked up the order. Live GPS tracking started.' }
            });
            onToast('Pickup confirmed. Allow GPS access to share your live location with the customer.');
            await refresh();
        } catch (requestError) { setError(requestError.message); }
        finally { setSavingId(''); }
    }

    async function saveProgress(order) {
        const draft = drafts[order.id] || { note: '', locationLabel: '', etaMinutes: '' };
        setSavingId(order.id); setError('');
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
            await refresh();
            setDrafts((current) => ({ ...current, [order.id]: { ...draft, note: '' } }));
        } catch (requestError) { setError(requestError.message); }
        finally { setSavingId(''); }
    }

    async function confirmDelivery(file) {
        const orderId = proofOrderId;
        if (!file || !orderId) return;
        if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.type)) {
            setError('Choose or capture a JPG, PNG, WEBP, or AVIF photo.'); return;
        }
        if (file.size > 5 * 1024 * 1024) { setError('The delivery proof photo must be smaller than 5 MB.'); return; }
        setProofBusy(orderId); setError('');
        try {
            const data = await fileAsDataUrl(file);
            await apiRequest(`/orders/${encodeURIComponent(orderId)}/delivery-proof`, {
                method: 'POST', body: { filename: file.name || 'delivery-proof.jpg', mimeType: file.type, data }
            });
            onToast('Delivery confirmed with photo proof.');
            await refresh();
        } catch (requestError) { setError(requestError.message); }
        finally {
            setProofBusy(''); setProofOrderId('');
            if (cameraPhotoRef.current) cameraPhotoRef.current.value = '';
        }
    }

    return (
        <div className="page-stack">
            <div className="dashboard-section-heading"><div><span className="eyebrow">RIDER WORKSPACE</span><h1>My deliveries</h1><p>Confirm pickup, share your phone’s live GPS, and confirm delivery with a photo.</p></div><button className="secondary-button" onClick={() => refresh(false)}><RefreshCw size={15} /> Refresh</button></div>
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="stats-grid"><div className="stat-card"><span>Assigned deliveries</span><strong>{deliveries.length}</strong><small>Your delivery queue</small></div><div className="stat-card"><span>In progress</span><strong>{deliveries.filter((order) => order.status === 'Out for Delivery').length}</strong><small>GPS sharing when allowed</small></div><div className="stat-card"><span>Delivered</span><strong>{deliveries.filter((order) => order.status === 'Delivered').length}</strong><small>Photo-confirmed assignments</small></div></div>
            {loading ? <p className="muted-copy">Loading deliveries…</p> : deliveries.length ? <div className="order-list">{deliveries.map((order) => {
                const draft = drafts[order.id] || { note: '', locationLabel: '', etaMinutes: '' };
                const canStart = order.status === 'Ready for Pickup';
                const active = order.status === 'Out for Delivery';
                return <article className="role-order-card rider-order-card" key={order.id}>
                    <div className="role-order-header"><div><span className="order-number">{order.id}</span><h3>{order.customer_name}</h3><p>{order.store_name} · {formatDate(order.created_at)}</p></div><span className={`status-pill status-${order.status.toLowerCase().replaceAll(' ', '-')}`}>{order.status}</span></div>
                    <div className="rider-delivery-summary"><div><span>Deliver to</span><strong>{order.delivery_address}</strong></div><div><span>Order total</span><strong>{money(order.total)}</strong></div><div><span>ETA</span><strong>{order.eta_at ? formatDate(order.eta_at) : 'Not set'}</strong></div></div>
                    <div className="rider-order-items">{order.items.map((item) => <span key={item.id}>{item.quantity} × {item.product_name}</span>)}</div>
                    <div className="rider-map-links"><a className="map-link" href={deliveryDirectionsUrl(order)} target="_blank" rel="noreferrer"><Navigation size={16} /> View route & distance</a><a className="map-link" href={storeMapUrl(order)} target="_blank" rel="noreferrer"><Store size={16} /> Open store location</a><a className="map-link" href={deliveryDestinationUrl(order.delivery_address)} target="_blank" rel="noreferrer"><MapPin size={16} /> Open destination</a></div>
                    {active && <LiveRiderMap orderId={order.id} status={order.status} role="rider" />}
                    {canStart && <div className="tracking-editor"><div className="tracking-editor-heading"><strong><Bike size={17} /> Confirm pickup</strong><span>Starts live GPS tracking</span></div><p>Tap after you physically collect the order. Your device will ask for location permission so the customer can see the same rider map.</p><button className="primary-button" disabled={savingId === order.id} onClick={() => startDelivery(order)}><Navigation size={16} /> {savingId === order.id ? 'Starting…' : 'Confirm pickup & start GPS'}</button></div>}
                    {active && <div className="tracking-editor"><div className="tracking-editor-heading"><strong><MapPin size={17} /> Live delivery updates</strong><span>{order.tracking?.[0] ? `Last update ${formatDate(order.tracking[0].created_at)}` : 'Waiting for GPS fix'}</span></div><div className="form-grid"><label>ETA from now (minutes)<input type="number" min="0" max="240" value={draft.etaMinutes} onChange={(event) => updateDraft(order.id, 'etaMinutes', event.target.value, order)} placeholder="Optional" /></label><label>Location note<input value={draft.locationLabel} onChange={(event) => updateDraft(order.id, 'locationLabel', event.target.value, order)} placeholder="e.g. Near the main gate" /></label><label className="form-span-two">Update note<input value={draft.note} onChange={(event) => updateDraft(order.id, 'note', event.target.value, order)} placeholder="e.g. Reaching the dorm soon" /></label></div><button className="secondary-button" disabled={savingId === order.id} onClick={() => saveProgress(order)}><CheckCircle2 size={16} /> {savingId === order.id ? 'Saving…' : 'Save delivery note / ETA'}</button><div className="delivery-proof-actions"><strong>Confirm delivered</strong><p>Take a photo of the order at the customer’s handoff point or choose an existing photo. Delivery status changes only after this photo reaches the server.</p><div className="image-upload-actions"><button type="button" className="primary-button" disabled={proofBusy === order.id} onClick={() => { setProofOrderId(order.id); cameraPhotoRef.current?.click(); }}><Camera size={15} /> {proofBusy === order.id ? 'Uploading…' : 'Take delivery proof photo'}</button><span className="image-drop-hint"><UploadCloud size={14} /> Camera capture · max 5 MB</span></div></div></div>}
                    {order.status === 'Delivered' && <div className="rider-completed-note"><PackageCheck size={18} /><span>Delivery completed. The order was marked delivered through the rider’s photo-proof flow.</span>{order.delivery_proof_url && <a href={order.delivery_proof_url} target="_blank" rel="noreferrer">View proof photo</a>}</div>}
                    {!active && !canStart && order.status !== 'Delivered' && <div className="rider-completed-note"><Clock3 size={18} /><span>{order.status === 'Cancelled' ? 'This order was cancelled.' : 'Waiting for the store to prepare this order and mark it Ready for Pickup.'}</span></div>}
                </article>;
            })}</div> : <div className="dashboard-empty"><Bike size={29} /><h3>No assigned deliveries</h3><p>Your store manager assigns deliveries when orders are ready for pickup.</p></div>}
            <input ref={cameraPhotoRef} className="visually-hidden-file-input" type="file" accept="image/*" capture="environment" onChange={(event) => void confirmDelivery(event.target.files?.[0])} />
        </div>
    );
}
