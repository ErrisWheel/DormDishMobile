import { ArrowRight, Check, CheckCircle2, Clock3, ExternalLink, MapPin, Navigation, PackageCheck, ShieldCheck, Store } from 'lucide-react';
import { formatDate, money } from '../../lib/api.js';
import { deliveryDirectionsUrl, storeMapUrl } from '../../lib/maps.js';
import { orderStatusLabel } from '../../lib/order-status.js';

function arrivalLabel(order) {
    if (order.status === 'Delivered') return 'Delivered';
    if (order.eta_at) return formatDate(order.eta_at);
    return 'Pending store confirmation';
}

export function CustomerOrderConfirmationPage({ order, onTrack, onContinue }) {
    const routeUrl = deliveryDirectionsUrl(order);
    const storeUrl = storeMapUrl(order);

    return (
        <div className="page-stack confirmation-page">
            <section className="confirmation-hero">
                <div className="confirmation-check"><Check size={32} strokeWidth={2.8} /></div>
                <span className="eyebrow">ORDER RECEIVED</span>
                <h1>Your order is in good hands.</h1>
                <p>We have saved your order. The store will confirm it and update your preparation status and ETA.</p>
                <div className="confirmation-reference"><span>ORDER REFERENCE</span><strong>{order.id}</strong><button onClick={() => navigator.clipboard?.writeText(order.id)} aria-label="Copy order reference">Copy ID</button></div>
            </section>

            <div className="confirmation-grid">
                <section className="dashboard-panel confirmation-summary-panel">
                    <div className="panel-heading"><div><span className="eyebrow">ORDER SUMMARY</span><h2>Order details</h2><p>Placed {formatDate(order.created_at)}</p></div><span className="status-pill status-pending">{orderStatusLabel(order.status)}</span></div>
                    <div className="confirmation-store-line"><div className="confirmation-store-icon"><Store size={20} /></div><div><strong>{order.store_name}</strong><span>{order.location_name || 'Campus store'}</span></div></div>
                    <div className="confirmation-items">
                        {(order.items || []).map((item) => (
                            <div key={item.id}>
                                <span>{item.quantity} × {item.product_name}{order.group_order_id && item.ordered_by_name ? <small style={{ display: 'block', color: 'var(--muted)' }}>Added by {item.ordered_by_name}</small> : null}</span>
                                <strong>{money(item.line_total)}</strong>
                            </div>
                        ))}
                    </div>
                    <div className="confirmation-items">
                        <div><span>Subtotal</span><strong>{money(order.subtotal)}</strong></div>
                        {Number(order.student_discount) > 0 && <div><span>Student discount</span><strong>−{money(order.student_discount)}</strong></div>}
                        {Number(order.group_discount) > 0 && <div><span>Group discount</span><strong>−{money(order.group_discount)}</strong></div>}
                        <div><span>Delivery fee</span><strong>{money(order.delivery_fee)}</strong></div>
                    </div>
                    {order.group_order_id && <p className="muted-copy">This is a combined group order. Coordinate repayment with the other students who joined.</p>}
                    <div className="confirmation-total-row"><span>Total, including delivery</span><strong>{money(order.total)}</strong></div>
                    <div className="confirmation-details-grid">
                        <div><span>Payment method</span><strong>{order.payment_method}</strong></div>
                        <div><span>Estimated arrival</span><strong>{arrivalLabel(order)}</strong><small>{order.eta_at ? 'An estimate, not a guarantee' : 'ETA will appear when the store updates it'}</small></div>
                    </div>
                </section>

                <section className="dashboard-panel confirmation-route-panel">
                    <div className="panel-heading"><div><span className="eyebrow">DELIVERY ROUTE</span><h2>From store to you</h2><p>View the driving route, distance, and travel time in Google Maps.</p></div><Navigation size={22} /></div>
                    <div className="route-stops">
                        <div className="route-stop"><span className="route-stop-marker route-stop-store"><Store size={15} /></span><div><small>PICKUP</small><strong>{order.store_name}</strong><span>{order.location_name || 'Store location'}</span></div></div>
                        <div className="route-connector"><span>ROUTE</span></div>
                        <div className="route-stop"><span className="route-stop-marker route-stop-home"><MapPin size={15} /></span><div><small>DELIVER TO</small><strong>Your delivery address</strong><span>{order.delivery_address}</span></div></div>
                    </div>
                    <a className="primary-button route-primary-action" href={routeUrl} target="_blank" rel="noreferrer"><Navigation size={17} /> View route & distance <ExternalLink size={15} /></a>
                    <a className="route-secondary-action" href={storeUrl} target="_blank" rel="noreferrer"><MapPin size={15} /> Open store pin in Google Maps</a>
                    <div className="route-note"><ShieldCheck size={16} /><span>Distance and driving time are calculated by Google Maps for your destination. DormDish does not use live GPS tracking.</span></div>
                </section>
            </div>

            <section className="confirmation-next-steps">
                <div className="confirmation-next-icon"><Clock3 size={19} /></div>
                <div><strong>What happens next?</strong><p>The store confirms your order, prepares your meal, and updates the ETA. You can follow every saved status update from your orders page.</p></div>
                <div className="confirmation-next-badge"><CheckCircle2 size={16} /> Saved to your account</div>
            </section>
            <div className="confirmation-actions">
                <button className="primary-button" onClick={onTrack}><PackageCheck size={17} /> Track this order <ArrowRight size={16} /></button>
                <button className="secondary-button" onClick={onContinue}>Continue browsing</button>
            </div>
        </div>
    );
}