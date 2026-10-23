import { ArrowLeft, Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { money } from '../../lib/api.js';
import { GroupOrderPanel } from './GroupOrderPanel.jsx';

export function CustomerCartPage({
    cart, address, onAddress, payment, onPayment, orderNotes = '', onOrderNotes,
    onQuantity, onRemove, onPlaceOrder, onBack, busy, deliveryFee = 20,
    studentDiscountPercent = 5, groupOrder, isGroupHost, onCreateGroupOrder,
    onJoinGroupOrder, onAddCartToGroup, onPlaceGroupOrder, onRefreshGroupOrder,
    onLeaveOrCancelGroup
}) {
    const subtotal = cart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0);
    const calculatedDeliveryFee = cart.length ? deliveryFee : 0;

    const promoSavings = cart.reduce((sum, item) => {
        const regularPrice = Number(item.regular_price ?? item.old_price ?? item.price);
        const price = Number(item.price || 0);
        return sum + (item.promo_active ? Math.max(0, regularPrice - price) * item.quantity : 0);
    }, 0);

    const studentEligibleSubtotal = cart.reduce(
        (sum, item) => sum + (!item.promo_active ? Number(item.price) * item.quantity : 0),
        0
    );
    const studentDiscount = Math.round(studentEligibleSubtotal * studentDiscountPercent) / 100;
    const estimatedTotal = Math.max(0, subtotal - studentDiscount) + calculatedDeliveryFee;

    return (
        <div className="page-stack">
            <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> Continue browsing</button>
            <div className="dashboard-section-heading">
                <div><span className="eyebrow">READY WHEN YOU ARE</span><h1>Your cart</h1><p>For a standard order, items must come from one store. Use group ordering to combine classmates' carts.</p></div>
            </div>

            {cart.length ? (
                <div className="cart-layout">
                    <section className="dashboard-panel cart-items-panel">
                        <div className="panel-heading"><div><h2>{cart[0].store_name}</h2><p>{cart.length} unique items in your cart</p></div><ShoppingCart size={21} /></div>
                        {cart.map((item) => (
                            <article className="cart-line-item" key={item.id}>
                                <img src={item.image_url || '/images/hero-food.png'} alt={item.name} />
                                <div className="cart-line-copy">
                                    <strong>{item.name}</strong>
                                    <small>{money(item.price)} each {item.promo_active && <span className="promo-label-pill">{item.promo_label || 'Promo'}</span>}</small>
                                    <div className="cart-quantity">
                                        <button onClick={() => onQuantity(item.id, -1)} aria-label={`Decrease ${item.name}`}><Minus size={14} /></button>
                                        <span>{item.quantity}</span>
                                        <button onClick={() => onQuantity(item.id, 1)} aria-label={`Increase ${item.name}`} disabled={item.quantity >= item.stock}><Plus size={14} /></button>
                                    </div>
                                </div>
                                <div className="cart-line-total">
                                    <strong>{money(Number(item.price) * item.quantity)}</strong>
                                    {item.promo_active && <del>{money(Number(item.regular_price ?? item.old_price ?? item.price) * item.quantity)}</del>}
                                    <button className="icon-button danger-icon" onClick={() => onRemove(item.id)} aria-label={`Remove ${item.name}`}><Trash2 size={16} /></button>
                                </div>
                            </article>
                        ))}
                    </section>

                    <section className="dashboard-panel checkout-panel">
                        <div className="panel-heading"><div><h2>Checkout details</h2><p>Demo checkout only. No payment is processed.</p></div></div>
                        <label className="stacked-field">Delivery location
                            <textarea value={address} onChange={(event) => onAddress(event.target.value)} rows="3" placeholder="Building, dorm, room, or pickup point" required />
                        </label>
                        <label className="stacked-field">Order notes
                            <textarea value={orderNotes} onChange={(event) => onOrderNotes(event.target.value.slice(0, 500))} rows="2" maxLength={500} placeholder="Optional: no onions, sauce on the side, pickup instructions…" />
                            <small>{orderNotes.length}/500 characters</small>
                        </label>
                        <label className="stacked-field">Payment method
                            <select value={payment} onChange={(event) => onPayment(event.target.value)}><option>Cash on delivery</option><option>Pay at pickup</option></select>
                        </label>
                        <div className="checkout-total-lines">
                            <div><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
                            {promoSavings > 0 && <div><span>Promotional savings included</span><strong>−{money(promoSavings)}</strong></div>}
                            <div><span>Student discount ({studentDiscountPercent}%, regular-priced items)</span><strong>−{money(studentDiscount)}</strong></div>
                            <div><span>Delivery fee</span><strong>{money(calculatedDeliveryFee)}</strong></div>
                            <div className="checkout-grand-total"><span>Estimated total</span><strong>{money(estimatedTotal)}</strong></div>
                        </div>
                        <button className="primary-button full-button" disabled={busy || !address.trim() || !cart.length} onClick={onPlaceOrder}>
                            {busy ? 'Checking availability…' : 'Place order'} <ShoppingCart size={17} />
                        </button>
                        <p className="checkout-footnote">Promotions, stock, and prices are checked again before the order is created. Student discounts are applied by the server.</p>
                    </section>
                </div>
            ) : (
                <div className="dashboard-empty"><ShoppingCart size={30} /><h3>Your cart is empty</h3><p>Browse a store and add items, or join a classmate's group order below.</p><button className="primary-button" onClick={onBack}>Browse stores</button></div>
            )}

            <GroupOrderPanel
                groupOrder={groupOrder}
                isHost={isGroupHost}
                cart={cart}
                busy={busy}
                studentDiscountPercent={studentDiscountPercent}
                paymentMethod={payment}
                onCreate={onCreateGroupOrder}
                onJoin={onJoinGroupOrder}
                onAddCart={onAddCartToGroup}
                onCheckout={onPlaceGroupOrder}
                onRefresh={onRefreshGroupOrder}
                onLeaveOrCancel={onLeaveOrCancelGroup}
            />
        </div>
    );
}