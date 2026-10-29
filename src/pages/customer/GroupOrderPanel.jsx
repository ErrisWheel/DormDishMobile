// Group order panel
import { useState } from 'react';
import { CheckCircle2, Copy, RefreshCw, ShoppingBasket, Users, X } from 'lucide-react';
import { money } from '../../lib/api.js';

export function GroupOrderPanel({
    groupOrder, isHost, cart, onCreate, onJoin, onAddCart, onCheckout,
    onRefresh, onLeaveOrCancel, busy, studentDiscountPercent = 5, paymentMethod
}) {
    const [joinCode, setJoinCode] = useState('');

    async function copyCode() {
        try {
            await navigator.clipboard.writeText(groupOrder.join_code);
        } catch {
            window.prompt('Copy this group code:', groupOrder.join_code);
        }
    }

    return (
        <section className="dashboard-panel group-order-panel" style={{ marginTop: 18 }}>
            <div className="panel-heading">
                <div>
                    <span className="eyebrow">STUDENT SAVINGS</span>
                    <h2>Group order</h2>
                    <p>Combine classmates' meals from the same store for one shared drop-off.</p>
                </div>
                <Users size={22} />
            </div>

            {!groupOrder ? (
                <div style={{ display: 'grid', gap: 12 }}>
                    <p className="muted-copy" style={{ margin: 0 }}>Start a group from your current cart, then share the invite code with classmates. Everyone must order from the same store and use the same delivery point.</p>
                    <button className="primary-button" disabled={busy || !cart.length} onClick={onCreate}><Users size={16} /> Create group from my cart</button>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                            aria-label="Group invite code"
                            value={joinCode}
                            onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 6))}
                            placeholder="6-character group code"
                            maxLength={6}
                            style={{ flex: '1 1 180px', minWidth: 0, border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', background: 'var(--surface)', color: 'var(--text)' }}
                        />
                        <button className="secondary-button" disabled={busy || joinCode.length !== 6} onClick={async () => { await onJoin(joinCode); setJoinCode(''); }}>Join group</button>
                    </div>
                    <small className="muted-copy">Every customer account receives a {studentDiscountPercent}% student discount on regular-priced items. Group orders with at least 3 students and ₱300 in items receive an additional group discount.</small>
                </div>
            ) : (
                <div style={{ display: 'grid', gap: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <div>
                            <span className="status-pill status-delivered">{groupOrder.status === 'OPEN' ? 'Collecting orders' : groupOrder.status}</span>
                            <h3 style={{ margin: '10px 0 4px' }}>{groupOrder.store_name}</h3>
                            <p className="muted-copy" style={{ margin: 0 }}>Drop-off: {groupOrder.delivery_address}</p>
                            <p className="muted-copy" style={{ margin: '5px 0 0' }}>{isHost ? 'You are the host. You place the combined checkout.' : `${groupOrder.host_name} is hosting this group order.`}</p>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <div style={{ border: '1px dashed var(--border)', borderRadius: 10, padding: '9px 12px', display: 'flex', gap: 8, alignItems: 'center' }}>
                                <span style={{ fontWeight: 800, letterSpacing: 2 }}>{groupOrder.join_code}</span>
                                <button className="icon-button" onClick={copyCode} aria-label="Copy group invite code" title="Copy group invite code"><Copy size={15} /></button>
                            </div>
                            <button className="icon-button" onClick={onRefresh} disabled={busy} aria-label="Refresh group order"><RefreshCw size={16} /></button>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gap: 7 }}>
                        <strong>{groupOrder.member_count} student{groupOrder.member_count === 1 ? '' : 's'} joined</strong>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
                            {groupOrder.members.map((member) => (
                                <span key={member.id} className="role-chip">
                                    {member.name}{Number(member.id) === Number(groupOrder.host_customer_id) ? ' · Host' : ''}
                                </span>
                            ))}
                        </div>
                    </div>

                    <div style={{ display: 'grid', gap: 8 }}>
                        <strong>Items in the shared order</strong>
                        {groupOrder.items.length ? groupOrder.items.map((item) => (
                            <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                                <span>{item.quantity} × {item.product_name}<small style={{ display: 'block', color: 'var(--muted)' }}>Added by {item.member_name}</small></span>
                                <strong>{money(Number(item.current_price) * Number(item.quantity))}</strong>
                            </div>
                        )) : <p className="muted-copy">No items have been added yet.</p>}
                    </div>

                    <div className="checkout-total-lines">
                        <div><span>Group subtotal</span><strong>{money(groupOrder.subtotal)}</strong></div>
                        <div><span>Student discounts</span><strong>−{money(groupOrder.student_discount)}</strong></div>
                        <div>
                            <span>
                                Group discount {groupOrder.group_discount_eligible
                                    ? `(${groupOrder.discount_policy.group_discount_percent}%)`
                                    : `(${groupOrder.discount_policy.group_discount_min_members}+ students, ₱${groupOrder.discount_policy.group_discount_min_subtotal}+ subtotal)`}
                            </span>
                            <strong>−{money(groupOrder.group_discount)}</strong>
                        </div>
                        <div><span>Delivery fee</span><strong>{money(groupOrder.delivery_fee)}</strong></div>
                        <div className="checkout-grand-total"><span>Estimated group total</span><strong>{money(groupOrder.estimated_total)}</strong></div>
                    </div>

                    {isHost ? (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button className="primary-button" disabled={busy || !groupOrder.items.length} onClick={() => onCheckout(paymentMethod)}>
                                <CheckCircle2 size={16} /> {busy ? 'Processing…' : 'Place combined order'}
                            </button>
                            <button className="secondary-button" disabled={busy} onClick={onLeaveOrCancel}><X size={15} /> Cancel group</button>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button className="primary-button" disabled={busy || !cart.length || Number(cart[0]?.store_id) !== Number(groupOrder.store_id)} onClick={onAddCart}>
                                <ShoppingBasket size={16} /> Add my cart to group
                            </button>
                            <button className="secondary-button" disabled={busy} onClick={onLeaveOrCancel}><X size={15} /> Leave group</button>
                        </div>
                    )}

                    {!isHost && cart.length > 0 && Number(cart[0]?.store_id) !== Number(groupOrder.store_id) && <small className="muted-copy">Your cart is from a different store. Clear it or add meals from {groupOrder.store_name} before submitting.</small>}
                    {isHost && groupOrder.member_count < groupOrder.discount_policy.group_discount_min_members && (
                        <small className="muted-copy">Share the code with {groupOrder.discount_policy.group_discount_min_members - groupOrder.member_count} more student{groupOrder.discount_policy.group_discount_min_members - groupOrder.member_count === 1 ? '' : 's'} to unlock the group discount.</small>
                    )}
                    <small className="muted-copy">Promotional prices are honored only while active. Stock and prices are checked again when the host places the order. The combined payment method belongs to the host, so coordinate repayment with your classmates.</small>
                </div>
            )}
        </section>
    );
}