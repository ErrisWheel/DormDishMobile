import { useEffect, useState } from 'react';
import { LocateFixed, MapPin, RefreshCw } from 'lucide-react';
import { apiRequest, formatDate } from '../lib/api.js';

// Rider map

function mapEmbedUrl(location) {
    if (!location) return '';
    const lat = Number(location.latitude);
    const lon = Number(location.longitude);
    const delta = 0.004;
    const bounds = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bounds)}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lon}`)}`;
}

export function LiveRiderMap({ orderId, status, role = 'customer' }) {
    const [location, setLocation] = useState(null);
    const [error, setError] = useState('');
    const active = status === 'Out for Delivery';

    useEffect(() => {
        let alive = true;
        async function refresh() {
            try {
                const result = await apiRequest(`/orders/${encodeURIComponent(orderId)}/location`);
                if (alive) { setLocation(result.location || null); setError(''); }
            } catch (requestError) {
                if (alive) setError(requestError.message);
            }
        }
        refresh();
        const timer = active ? setInterval(refresh, 4000) : null;
        return () => { alive = false; if (timer) clearInterval(timer); };
    }, [orderId, active]);

    const embed = mapEmbedUrl(location);
    return (
        <section className="live-rider-map" aria-live="polite">
            <div className="live-rider-map-heading">
                <div><span className="eyebrow">LIVE RIDER GPS</span><h4>{active ? 'Rider location' : 'Last rider location'}</h4></div>
                <span className={`live-gps-pill ${location ? 'is-live' : ''}`}><LocateFixed size={14} /> {location ? (active ? 'GPS received' : 'Last known') : 'Waiting for GPS'}</span>
            </div>
            {location ? <>
                <iframe title={`Live rider map for order ${orderId}`} src={embed} loading="lazy" referrerPolicy="no-referrer" allowFullScreen />
                <div className="live-rider-map-meta"><MapPin size={15} /><span>{Number(location.latitude).toFixed(5)}, {Number(location.longitude).toFixed(5)}{location.accuracy_m != null ? ` · ±${Math.round(Number(location.accuracy_m))} m` : ''}</span><small>Updated {formatDate(location.recorded_at)}</small></div>
                <a className="route-secondary-action" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${location.latitude},${location.longitude}`)}`} target="_blank" rel="noreferrer">Open rider pin in Google Maps</a>
            </> : <div className="live-rider-map-empty"><RefreshCw size={18} /><p>{error || (role === 'rider' ? 'Allow location access and keep this screen open during the delivery. The customer sees this same saved rider position.' : 'The rider’s live position will appear here after they start the delivery and allow GPS access.')}</p></div>}
        </section>
    );
}
