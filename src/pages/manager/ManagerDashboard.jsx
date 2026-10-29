import { useEffect, useMemo, useState } from 'react';
import { Bike, Check, Clock3, Edit3, Package, Plus, RefreshCw, Star, Trash2, TrendingUp, X } from 'lucide-react';
import { apiRequest, formatDate, money } from '../../lib/api.js';
import { ImageUploadField } from '../../components/ImageUploadField.jsx';
import { MediaImage } from '../../components/MediaImage.jsx';

const allowedNext = {
    Pending: ['Confirmed', 'Cancelled'],
    Confirmed: ['Preparing', 'Cancelled'],
    Preparing: ['Ready for Pickup', 'Cancelled'],
    // Pickup
    'Ready for Pickup': ['Cancelled'],
    // Delivery
    'Out for Delivery': ['Cancelled'],
    Delivered: [],
    Cancelled: []
};

const emptyProduct = {
    name: '',
    description: '',
    category: 'Rice Meals',
    price: '',
    oldPrice: '',
    promoPrice: '',
    promoLabel: 'Student special',
    promoStartsAt: '',
    promoEndsAt: '',
    isPromoted: false,
    imageUrl: '/images/hero-food.png',
    stock: '10',
    isAvailable: true
};

function toDateTimeLocal(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

// Orders
function ManagerOrderCard({ order, onUpdate }) {
    const [status, setStatus] = useState(order.status);
    const [etaMinutes, setEtaMinutes] = useState(order.eta_minutes ?? '');
    const [note, setNote] = useState('');
    const [locationLabel, setLocationLabel] = useState(order.tracking?.[0]?.location_label || '');
    const [saving, setSaving] = useState(false);
    const options = useMemo(() => [...new Set([order.status, ...(allowedNext[order.status] || [])])], [order.status]);

    useEffect(() => {
        setStatus(order.status);
        setEtaMinutes(order.eta_minutes ?? '');
        setLocationLabel(order.tracking?.[0]?.location_label || '');
    }, [order.status, order.eta_minutes, order.tracking?.[0]?.id]);

    async function saveProgress() {
        setSaving(true);
        try {
            await onUpdate(order.id, {
                status,
                etaMinutes: etaMinutes === '' ? null : Number(etaMinutes),
                note,
                locationLabel
            });
            setNote('');
        } catch {
        } finally {
            setSaving(false);
        }
    }

    return (
        <article className="role-order-card manager-order-card" key={order.id}>
            <div className="role-order-header">
                <div>
                    <span className="order-number">{order.id}</span>
                    <h3>{order.customer_name}</h3>
                    <p>{order.store_name} · {formatDate(order.created_at)}</p>
                </div>
                <span className={`status-pill status-${order.status.toLowerCase().replaceAll(' ', '-')}`}>{order.status}</span>
            </div>
            <div className="role-order-items">
                {order.items.map((item) => (
                    <div key={item.id}>
                        <span>{item.quantity} × {item.product_name}</span>
                        <strong>{money(item.line_total)}</strong>
                    </div>
                ))}
            </div>
            {order.order_notes && <p className="muted-copy"><strong>Customer note:</strong> {order.order_notes}</p>}
            <div className="manager-order-facts">
                <span><strong>{money(order.total)}</strong> total</span>
                <span><Clock3 size={15} /> {order.eta_at ? formatDate(order.eta_at) : 'ETA not set'}</span>
                <span><Bike size={15} /> {order.rider_name || 'No rider assigned'}</span>
            </div>
            <div className="tracking-editor">
                <div className="tracking-editor-heading">
                    <strong>Delivery status & customer updates</strong>
                    <span>Latest: {order.tracking?.[0] ? formatDate(order.tracking[0].created_at) : 'No update yet'}</span>
                </div>
                <div className="form-grid">
                    <label>Status
                        <select value={status} onChange={(event) => setStatus(event.target.value)}>
                            {options.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                    </label>
                    <label>ETA from now (minutes)
                        <input type="number" min="0" max="240" value={etaMinutes} onChange={(event) => setEtaMinutes(event.target.value)} placeholder="e.g. 20" />
                    </label>
                    <label>Tracking location
                        <input value={locationLabel} onChange={(event) => setLocationLabel(event.target.value)} placeholder="e.g. Leaving store" />
                    </label>
                    <label>Update note
                        <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="What should the customer see?" />
                    </label>
                </div>
                <div className="tracking-editor-actions">
                    <button className="primary-button" disabled={saving} onClick={saveProgress}>
                        <Check size={16} /> {saving ? 'Saving…' : 'Save tracking update'}
                    </button>
                    {order.status === 'Ready for Pickup' && !order.rider_id && <span className="muted-copy">Riders claim this pickup from their own dashboard.</span>}
                </div>
            </div>
            {order.tracking?.length > 0 && (
                <div className="manager-latest-update">
                    <Clock3 size={14} />
                    <span>{order.tracking[0].note}{order.tracking[0].location_label ? ` · ${order.tracking[0].location_label}` : ''}</span>
                </div>
            )}
        </article>
    );
}

// Manager dashboard
export function ManagerDashboard({ user, page, onToast }) {
    const [products, setProducts] = useState([]);
    const [orders, setOrders] = useState([]);
    const [ratings, setRatings] = useState([]);
    const [ratingSummary, setRatingSummary] = useState({ rating: null, rating_count: 0 });
    const [productForm, setProductForm] = useState(emptyProduct);
    const [editingId, setEditingId] = useState(null);
    const [loading, setLoading] = useState(true);
    const [savingProduct, setSavingProduct] = useState(false);
    const [error, setError] = useState('');

    async function refresh(silent = false) {
        if (!silent) setLoading(true);

        try {
            const [productResult, orderResult, ratingResult] = await Promise.all([
                apiRequest(`/products?storeId=${user.store_id}`),
                apiRequest('/orders'),
                apiRequest('/manager/ratings')
            ]);

            setProducts(productResult.products);
            setOrders(orderResult.orders);
            setRatings(ratingResult.ratings);
            setRatingSummary(ratingResult.summary);
            setError('');
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            if (!silent) setLoading(false);
        }
    }

    useEffect(() => {
        refresh();
        const interval = setInterval(() => refresh(true), 20000);
        return () => clearInterval(interval);
    }, [user.store_id]);

    function updateForm(key, value) {
        setProductForm((current) => ({ ...current, [key]: value }));
    }

    function editProduct(product) {
        setEditingId(product.id);
        setProductForm({
            name: product.name,
            description: product.description || '',
            category: product.category || 'Meals',
            price: String(product.regular_price ?? product.price),
            oldPrice: product.promo_active || product.old_price === null ? '' : String(product.old_price),
            promoPrice: product.promo_price === null || product.promo_price === undefined ? '' : String(product.promo_price),
            promoLabel: product.promo_label || 'Student special',
            promoStartsAt: toDateTimeLocal(product.promo_starts_at),
            promoEndsAt: toDateTimeLocal(product.promo_ends_at),
            isPromoted: Boolean(product.is_promoted),
            imageUrl: product.image_url || '/images/hero-food.png',
            stock: String(product.stock),
            isAvailable: Boolean(product.is_available)
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function saveProduct(event) {
        event.preventDefault();
        setSavingProduct(true);
        setError('');

        try {
            const body = {
                ...productForm,
                price: Number(productForm.price),
                oldPrice: productForm.oldPrice === '' ? null : Number(productForm.oldPrice),
                promoPrice: productForm.isPromoted && productForm.promoPrice !== '' ? Number(productForm.promoPrice) : null,
                promoLabel: productForm.isPromoted ? productForm.promoLabel : '',
                promoStartsAt: productForm.isPromoted && productForm.promoStartsAt ? new Date(productForm.promoStartsAt).toISOString() : null,
                promoEndsAt: productForm.isPromoted && productForm.promoEndsAt ? new Date(productForm.promoEndsAt).toISOString() : null,
                isPromoted: Boolean(productForm.isPromoted),
                stock: Number(productForm.stock)
            };

            await apiRequest(editingId ? `/products/${editingId}` : '/products', {
                method: editingId ? 'PUT' : 'POST',
                body
            });

            setProductForm(emptyProduct);
            setEditingId(null);
            onToast(editingId ? 'Product updated.' : 'Product added.');
            await refresh();
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setSavingProduct(false);
        }
    }

    async function deleteProduct(product) {
        if (!window.confirm(`Remove ${product.name}?`)) return;

        try {
            await apiRequest(`/products/${product.id}`, { method: 'DELETE' });
            onToast('Product removed.');
            await refresh();
        } catch (requestError) {
            setError(requestError.message);
        }
    }

    async function updateOrder(orderId, body) {
        try {
            await apiRequest(`/orders/${encodeURIComponent(orderId)}/progress`, {
                method: 'PATCH',
                body: {
                    status: body.status,
                    etaMinutes: body.etaMinutes,
                    note: body.note,
                    locationLabel: body.locationLabel
                }
            });
            onToast('Order tracking updated.');
            await refresh();
        } catch (requestError) {
            onToast(requestError.message);
            throw requestError;
        }
    }


    const today = new Date().toDateString();
    const deliveredToday = orders.filter((order) =>
        order.status === 'Delivered' &&
        new Date(order.updated_at || order.created_at).toDateString() === today
    );
    const todayRevenue = deliveredToday.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const bestSellers = Object.values(orders
        .filter((order) => order.status !== 'Cancelled')
        .flatMap((order) => order.items || [])
        .reduce((summary, item) => {
            const key = item.product_name;
            if (!summary[key]) summary[key] = { name: key, quantity: 0, sales: 0 };
            summary[key].quantity += Number(item.quantity || 0);
            summary[key].sales += Number(item.line_total || 0);
            return summary;
        }, {}))
        .sort((left, right) => right.quantity - left.quantity)
        .slice(0, 5);

    return (
        <div className="page-stack">
            <div className="dashboard-section-heading">
                <div>
                    <span className="eyebrow">STORE WORKSPACE</span>
                    <h1>{page === 'manager-products' ? 'Manage products' : page === 'manager-ratings' ? 'Store ratings' : 'Store dashboard'}</h1>
                    <p>Manage only the products, orders, and tracking for your assigned store.</p>
                </div>
                <button className="secondary-button" onClick={refresh}><RefreshCw size={15} /> Refresh</button>
            </div>

            {error && <div className="form-error" role="alert">{error}</div>}

            <div className="stats-grid">
                <div className="stat-card"><span>Products</span><strong>{products.length}</strong><small>In your store catalog</small></div>
                <div className="stat-card"><span>Active orders</span><strong>{orders.filter((order) => !['Delivered', 'Cancelled'].includes(order.status)).length}</strong><small>Awaiting completion</small></div>
                <div className="stat-card"><span>Store rating</span><strong>{ratingSummary.rating ? Number(ratingSummary.rating).toFixed(1) : 'New'}</strong><small>{ratingSummary.rating_count} reviews</small></div>
                <div className="stat-card"><span>Pickups waiting</span><strong>{orders.filter((order) => order.status === 'Ready for Pickup' && !order.rider_id).length}</strong><small>Riders claim pickups themselves</small></div>
            </div>

            {page === 'manager-dashboard' && (
                <section className="dashboard-panel">
                    <div className="panel-heading"><div><h2>Sales overview</h2><p>Based on delivered orders and existing order records. Data refreshes automatically.</p></div><TrendingUp size={20} /></div>
                    <div className="stats-grid">
                        <div className="stat-card"><span>Sales today</span><strong>{money(todayRevenue)}</strong><small>{deliveredToday.length} delivered orders today</small></div>
                        <div className="stat-card"><span>Completed sales</span><strong>{money(orders.filter((order) => order.status === 'Delivered').reduce((sum, order) => sum + Number(order.total || 0), 0))}</strong><small>All delivered orders in order history</small></div>
                        <div className="stat-card"><span>Orders today</span><strong>{orders.filter((order) => new Date(order.created_at).toDateString() === today).length}</strong><small>Orders created today across all statuses</small></div>
                    </div>
                    <div className="panel-heading"><div><h3>Best-selling meals</h3><p>Ranked by quantity ordered, excluding cancelled orders.</p></div></div>
                    {bestSellers.length ? (
                        <div className="admin-table-wrap">
                            <table className="admin-table">
                                <thead><tr><th>Meal</th><th>Quantity sold</th><th>Order value</th></tr></thead>
                                <tbody>{bestSellers.map((item) => <tr key={item.name}><td>{item.name}</td><td>{item.quantity}</td><td>{money(item.sales)}</td></tr>)}</tbody>
                            </table>
                        </div>
                    ) : <p className="muted-copy">Sales details will appear after customers place orders.</p>}
                </section>
            )}

            {page === 'manager-products' && (
                <section className="dashboard-panel">
                    <div className="panel-heading">
                        <div><h2>{editingId ? 'Edit product' : 'Add a product'}</h2><p>Manage prices and optional timed promotions for your store.</p></div>
                        {editingId && <button className="icon-button" onClick={() => { setEditingId(null); setProductForm(emptyProduct); }} aria-label="Cancel editing"><X size={18} /></button>}
                    </div>
                    <form className="product-editor-form" onSubmit={saveProduct}>
                        <div className="form-grid">
                            <label>Product name<input value={productForm.name} onChange={(event) => updateForm('name', event.target.value)} required /></label>
                            <label>Category<input value={productForm.category} onChange={(event) => updateForm('category', event.target.value)} required /></label>
                            <label>Regular price (₱)<input type="number" min="0" step="0.01" value={productForm.price} onChange={(event) => updateForm('price', event.target.value)} required /></label>
                            <label>Old price (₱)<input type="number" min="0" step="0.01" value={productForm.oldPrice} onChange={(event) => updateForm('oldPrice', event.target.value)} /></label>
                            <label>Stock quantity<input type="number" min="0" step="1" value={productForm.stock} onChange={(event) => updateForm('stock', event.target.value)} required /></label>
                            <div className="form-span-two"><ImageUploadField kind="product" label="Product photo" value={productForm.imageUrl} onChange={(imageUrl) => updateForm('imageUrl', imageUrl)} /></div>
                            <label className="form-span-two">Description<textarea value={productForm.description} onChange={(event) => updateForm('description', event.target.value)} rows="2" /></label>
                            <label className="checkbox-field"><input type="checkbox" checked={productForm.isAvailable} onChange={(event) => updateForm('isAvailable', event.target.checked)} /> Available for ordering</label>
                            <label className="checkbox-field"><input type="checkbox" checked={productForm.isPromoted} onChange={(event) => updateForm('isPromoted', event.target.checked)} /> Promote this item</label>
                            {productForm.isPromoted && <>
                                <label>Promotional price (₱)<input type="number" min="0" step="0.01" value={productForm.promoPrice} onChange={(event) => updateForm('promoPrice', event.target.value)} required /></label>
                                <label>Promotion label<input value={productForm.promoLabel} maxLength="80" onChange={(event) => updateForm('promoLabel', event.target.value)} placeholder="Student special, lunch deal…" /></label>
                                <label>Starts at (optional)<input type="datetime-local" value={productForm.promoStartsAt} onChange={(event) => updateForm('promoStartsAt', event.target.value)} /></label>
                                <label>Ends at (optional)<input type="datetime-local" value={productForm.promoEndsAt} onChange={(event) => updateForm('promoEndsAt', event.target.value)} /></label>
                                <p className="muted-copy form-span-two">Leave the schedule blank to make the promotion active immediately with no end date. Promotional prices are checked again at checkout.</p>
                            </>}
                        </div>
                        <button className="primary-button" type="submit" disabled={savingProduct}><Plus size={16} /> {savingProduct ? 'Saving…' : editingId ? 'Save product' : 'Add product'}</button>
                    </form>
                </section>
            )}

            {page === 'manager-products' && (
                <section className="dashboard-panel">
                    <div className="panel-heading"><div><h2>Your products</h2><p>{products.length} product records in DormDish</p></div></div>
                    {loading ? <p className="muted-copy">Loading products…</p> : products.length ? (
                        <div className="admin-table-wrap">
                            <table className="admin-table">
                                <thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Availability</th><th>Actions</th></tr></thead>
                                <tbody>{products.map((product) => (
                                    <tr key={product.id}>
                                        <td><div className="table-product"><MediaImage src={product.image_url} alt="" className="manager-product-thumbnail" fallbackSrc="/images/hero-food.png" /><div><strong>{product.name}</strong><small>{product.category}</small></div></div></td>
                                        <td>
                                            {product.promo_active ? <><strong>{money(product.price)}</strong> <del>{money(product.regular_price)}</del><small className="stock-good">{product.promo_label || 'Promotional price'}</small></> : money(product.price)}
                                            {product.is_promoted && !product.promo_active && <small className="muted-copy">Promotion scheduled/ended</small>}
                                        </td>
                                        <td>{product.stock}</td>
                                        <td><span className={`status-pill ${product.is_available && product.stock > 0 ? 'status-delivered' : 'status-cancelled'}`}>{product.is_available && product.stock > 0 ? 'Available' : 'Unavailable'}</span></td>
                                        <td><div className="table-actions"><button className="icon-button" onClick={() => editProduct(product)} aria-label={`Edit ${product.name}`}><Edit3 size={16} /></button><button className="icon-button danger-icon" onClick={() => deleteProduct(product)} aria-label={`Delete ${product.name}`}><Trash2 size={16} /></button></div></td>
                                    </tr>
                                ))}</tbody>
                            </table>
                        </div>
                    ) : <div className="dashboard-empty"><Package size={26} /><h3>No products yet</h3><p>Add your first menu item above.</p></div>}
                </section>
            )}

            {page === 'manager-orders' && (
                <section className="section-block">
                    <div className="dashboard-section-heading"><div><h2>Store orders</h2><p>Set an estimated arrival and add simulated tracking updates.</p></div></div>
                    {loading ? <p className="muted-copy">Loading orders…</p> : orders.length ? (
                        <div className="order-list">{orders.map((order) => <ManagerOrderCard key={order.id} order={order} onUpdate={updateOrder} />)}</div>
                    ) : <div className="dashboard-empty"><Package size={26} /><h3>No orders yet</h3><p>New customer orders will appear here.</p></div>}
                </section>
            )}

            {page === 'manager-ratings' && (
                <section className="dashboard-panel">
                    <div className="panel-heading"><div><h2>Customer ratings</h2><p>Rating averages use customer ratings that are visible to shoppers.</p></div><span className="store-rating"><Star size={15} fill="currentColor" /> {ratingSummary.rating ? Number(ratingSummary.rating).toFixed(1) : 'New'}</span></div>
                    {ratings.length ? (
                        <div className="rating-list">{ratings.map((rating) => <article className="rating-row" key={rating.id}><div className="rating-row-score"><Star size={16} fill="currentColor" /> {rating.score}/5</div><div><strong>{rating.reviewer_name}</strong><p>{rating.review || 'No written review.'}</p><small>{formatDate(rating.created_at)}</small></div></article>)}</div>
                    ) : <div className="dashboard-empty"><Star size={26} /><h3>No ratings yet</h3><p>Customer reviews will appear after delivered orders.</p></div>}
                </section>
            )}
        </div>
    );
}