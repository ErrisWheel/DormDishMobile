import { useState } from 'react';
import { Bike, CheckCircle2, Clock3, ExternalLink, MapPin, Navigation, PackageCheck, Star, Store } from 'lucide-react';
import { apiRequest, formatDate, money } from '../../lib/api.js';
import { deliveryDirectionsUrl, deliveryDestinationUrl, storeMapUrl } from '../../lib/maps.js';
import { LiveRiderMap } from '../../components/LiveRiderMap.jsx';
import { MediaImage } from '../../components/MediaImage.jsx';
import { orderStatusLabel } from '../../lib/order-status.js';

const progressStatuses = ['Pending', 'Confirmed', 'Preparing', 'Ready for Pickup', 'Out for Delivery', 'Delivered'];

function etaLabel(order) {
    if (order.status === 'Delivered') return 'Delivered';
    if (order.status === 'Cancelled') return 'Cancelled';
    if (!order.eta_at) return 'Not set yet';

    const remaining = Math.ceil((new Date(order.eta_at).getTime() - Date.now()) / 60000);
    if (remaining <= 0) return 'Expected soon';
    return `${remaining} min remaining`;
}

// Orders
export function CustomerOrdersPage({ orders, onRefresh, onBrowse, onToast }) {
    const [ratingForms, setRatingForms] = useState({});
    const [savingRating, setSavingRating] = useState('');

    async function submitRating(orderId) {
        const form = ratingForms[orderId] || { score: 5, review: '' };
        setSavingRating(orderId);

        try {
            await apiRequest(`/orders/${encodeURIComponent(orderId)}/ratings`, {
                method: 'POST',
                body: form
            });
            onToast('Thanks for rating the store.');
            await onRefresh();
        } catch (error) {
            onToast(error.message);
        } finally {
            setSavingRating('');
        }
    }

    return (
        <div className="page-stack">
            <div className="dashboard-section-heading">
                <div><span className="eyebrow">ORDER ACTIVITY</span><h1>My orders</h1><p>Track order status, estimated arrival, and delivery updates.</p></div>
                <button className="secondary-button" onClick={onRefresh}><Clock3 size={16} /> Refresh</button>
            </div>

            {orders.length ? (
                <div className="order-list">
                    {orders.map((order) => {
                        const currentProgress = progressStatuses.indexOf(order.status);
                        const ratingForm = ratingForms[order.id] || { score: 5, review: '' };

                        return (
                            <article className="role-order-card" key={order.id}>
                                <div className="role-order-header">
                                    <div><span className="order-number">{order.id}</span><h3>{order.store_name}</h3><p>Placed {formatDate(order.created_at)}</p></div>
                                    <span className={`status-pill status-${order.status.toLowerCase().replaceAll(' ', '-')}`}>{orderStatusLabel(order.status)}</span>
                                </div>

                                {order.group_order_id && <p className="muted-copy">Shared group order with classmates. Coordinate repayment with the group host.</p>}

                                <div className="role-order-items">
                                    {order.items.map((item) => (
                                        <div key={item.id}>
                                            <span>
                                                {item.quantity} × {item.product_name}
                                                {order.group_order_id && item.ordered_by_name ? <small style={{ display: 'block', color: 'var(--muted)' }}>Added by {item.ordered_by_name}</small> : null}
                                            </span>
                                            <strong>{money(item.line_total)}</strong>
                                        </div>
                                    ))}
                                </div>

                                {Number(order.discount_total) > 0 && (
                                    <div className="role-order-items">
                                        <div><span>Subtotal</span><strong>{money(order.subtotal)}</strong></div>
                                        {Number(order.student_discount) > 0 && <div><span>Student discount</span><strong>−{money(order.student_discount)}</strong></div>}
                                        {Number(order.group_discount) > 0 && <div><span>Group discount</span><strong>−{money(order.group_discount)}</strong></div>}
                                        <div><span>Delivery fee</span><strong>{money(order.delivery_fee)}</strong></div>
                                    </div>
                                )}

                                <div className="eta-panel">
                                    <div className="eta-icon"><Clock3 size={20} /></div>
                                    <div className="eta-copy">
                                        <span>Estimated arrival</span>
                                        <strong>{etaLabel(order)}</strong>
                                        <small>{order.eta_at && order.status !== 'Delivered' ? `Estimated for ${formatDate(order.eta_at)}` : order.status === 'Delivered' ? `Updated ${formatDate(order.updated_at)}` : 'The store will set an ETA after confirming your order.'}</small>
                                    </div>
                                    <div className="eta-total"><span>Total</span><strong>{money(order.total)}</strong></div>
                                </div>

                                {order.status !== 'Cancelled' && (
                                    <div className="order-progress">
                                        {progressStatuses.filter((status) => status !== 'Delivered' || order.status === 'Delivered').map((status, index) => {
                                            const complete = currentProgress >= index;
                                            return (
                                                <div className={`progress-step ${complete ? 'complete' : ''} ${status === order.status ? 'current' : ''}`} key={status}>
                                                    <span>{complete ? <CheckCircle2 size={16} /> : <i />}</span>
                                                    <small>{orderStatusLabel(status)}</small>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                <div className="tracking-feed">
                                    <div className="tracking-feed-title"><Bike size={17} /><strong>Delivery updates</strong></div>
                                    {order.tracking?.length ? order.tracking.slice(0, 4).map((update) => (
                                        <div className="tracking-event" key={update.id}>
                                            <span className="tracking-event-dot" />
                                            <div><strong>{orderStatusLabel(update.status)}</strong><p>{update.note}{update.location_label ? ` · ${update.location_label}` : ''}</p><small>{formatDate(update.created_at)}{update.updated_by_name ? ` · ${update.updated_by_name}` : ''}</small></div>
                                        </div>
                                    )) : <p className="muted-copy">Tracking updates will appear here.</p>}
                                </div>

                                <section className="order-route-card">
                                    <div className="order-route-heading">
                                        <div><span className="eyebrow">DELIVERY ROUTE</span><h4>Store to your address</h4><p>Google Maps can show driving distance and estimated travel time for this route.</p></div>
                                        <Navigation size={21} />
                                    </div>
                                    <div className="route-stops order-route-stops">
                                        <div className="route-stop"><span className="route-stop-marker route-stop-store"><Store size={14} /></span><div><small>PICKUP</small><strong>{order.store_name}</strong><span>{order.location_name || 'Store location'}</span></div></div>
                                        <div className="route-connector"><span>TO</span></div>
                                        <div className="route-stop"><span className="route-stop-marker route-stop-home"><MapPin size={14} /></span><div><small>DELIVER TO</small><strong>Your address</strong><span>{order.delivery_address}</span></div></div>
                                    </div>
                                    <div className="order-route-actions">
                                        <a className="primary-button" href={deliveryDirectionsUrl(order)} target="_blank" rel="noreferrer"><Navigation size={15} /> View route & distance <ExternalLink size={14} /></a>
                                        <a className="route-secondary-action" href={storeMapUrl(order)} target="_blank" rel="noreferrer"><Store size={14} /> Store pin</a>
                                        <a className="route-secondary-action" href={deliveryDestinationUrl(order.delivery_address)} target="_blank" rel="noreferrer"><MapPin size={14} /> Destination pin</a>
                                    </div>
                                </section>

                                {['Out for Delivery', 'Delivered'].includes(order.status) && <LiveRiderMap orderId={order.id} status={order.status} role="customer" />}

                                {order.status === 'Delivered' && order.delivery_proof_url && <div className="delivery-proof-customer"><strong>Rider delivery photo</strong><MediaImage src={order.delivery_proof_url} alt="Rider delivery confirmation" className="delivery-proof-media" fallbackText="Photo unavailable" fallbackSrc="" /></div>}

                                {order.status === 'Delivered' && order.can_rate !== false && !order.rating && (
                                    <div className="rating-form">
                                        <div><strong>How was this store?</strong><p>Ratings help recommend better campus stores.</p></div>
                                        <div className="rating-controls">
                                            <label>Rating
                                                <select value={ratingForm.score} onChange={(event) => setRatingForms((current) => ({ ...current, [order.id]: { ...ratingForm, score: Number(event.target.value) } }))}>
                                                    <option value={5}>5 stars</option><option value={4}>4 stars</option><option value={3}>3 stars</option><option value={2}>2 stars</option><option value={1}>1 star</option>
                                                </select>
                                            </label>
                                            <label>Review
                                                <input value={ratingForm.review} onChange={(event) => setRatingForms((current) => ({ ...current, [order.id]: { ...ratingForm, review: event.target.value } }))} placeholder="Leave a short review" />
                                            </label>
                                            <button className="primary-button" disabled={savingRating === order.id} onClick={() => submitRating(order.id)}>
                                                <Star size={16} /> {savingRating === order.id ? 'Saving…' : 'Submit rating'}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {order.rating && <div className="submitted-rating"><Star size={16} fill="currentColor" /> You rated this store {order.rating.score}/5{order.rating.review ? `: “${order.rating.review}”` : '.'}</div>}
                            </article>
                        );
                    })}
                </div>
            ) : (
                <div className="dashboard-empty"><PackageCheck size={30} /><h3>No orders yet</h3><p>Your placed orders and delivery estimates will appear here.</p><button className="primary-button" onClick={onBrowse}>Browse stores</button></div>
            )}
        </div>
    );
}