import {
    ArrowLeft,
    ArrowRight,
    Bell,
    Check,
    ChefHat,
    ChevronDown,
    ChevronRight,
    Clock3,
    CreditCard,
    Flame,
    Heart,
    Home,
    ListOrdered,
    MapPin,
    Minus,
    PackageCheck,
    Plus,
    Search,
    ShoppingBag,
    ShoppingCart,
    SlidersHorizontal,
    Sparkles,
    Sun,
    UserRound,
    Utensils,
    X,
    Moon,
    CircleHelp,
    LogIn,
    LogOut,
    Trash2,
    Bike,
    CheckCircle2
} from 'lucide-react';

import { orderStatusLabel } from '../lib/order-status.js';

import {
    products,
    categories,
    money
} from "../data/menu.js";

export function OrdersPage({
    orders,
    onBrowse,
    onReorder
}) {
    return (
        <>
            <div className="page-title-row">
                <div>
                    <div className="eyebrow">
                        YOUR CAMPUS MEAL HISTORY
                    </div>

                    <h1>My orders</h1>

                    <p className="page-subtitle">
                        All your campus cravings, in one place.
                    </p>
                </div>

                <div className="orders-count">
                    <strong>
                        {orders.length.toString().padStart(2, '0')}
                    </strong>

                    <span>total orders</span>
                </div>
            </div>

            {orders.length ? (
                <div className="orders-list">
                    {orders.map((order) => (
                        <article
                            className="order-card"
                            key={order.id}
                        >
                            <div className="order-card-top">
                                <div className="order-id-block">
                                    <span className="order-icon">
                                        <PackageCheck size={19} />
                                    </span>

                                    <div>
                                        <strong>{order.id}</strong>
                                        <span>{order.date}</span>
                                    </div>
                                </div>

                                <span className="order-status">
                                    <i />
                                    {orderStatusLabel(order.status)}
                                </span>
                            </div>

                            <div className="order-products">
                                {order.items
                                    .slice(0, 3)
                                    .map((item) => (
                                        <div
                                            key={item.id}
                                            className="order-product"
                                        >
                                            <img
                                                src={item.image}
                                                alt={item.name}
                                            />

                                            <span>
                                                {item.quantity}×{' '}
                                                {item.name}
                                            </span>
                                        </div>
                                    ))}

                                {order.items.length > 3 && (
                                    <span className="more-items">
                                        +{order.items.length - 3} more
                                    </span>
                                )}
                            </div>

                            <div className="order-card-bottom">
                                <div>
                                    <span>
                                        Total paid on delivery
                                    </span>

                                    <strong>
                                        {money(order.total)}
                                    </strong>
                                </div>

                                <button
                                    className="secondary-button"
                                    onClick={() =>
                                        onReorder(order)
                                    }
                                >
                                    Order again
                                    <ArrowRight size={15} />
                                </button>
                            </div>

                            <div className="order-detail-line">
                                <MapPin size={14} />
                                {order.address}

                                <span>·</span>

                                <CreditCard size={14} />
                                {order.payment}
                            </div>
                        </article>
                    ))}
                </div>
            ) : (
                <div className="empty-state orders-empty">
                    <span>
                        <ListOrdered size={26} />
                    </span>

                    <h3>Your order history starts here</h3>

                    <p>
                        Once you place a demo order, you’ll be able
                        to find its details here.
                    </p>

                    <button
                        className="primary-button"
                        onClick={onBrowse}
                    >
                        Find a meal
                        <ArrowRight size={16} />
                    </button>
                </div>
            )}
        </>
    );
}
