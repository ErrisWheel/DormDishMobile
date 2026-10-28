import { ArrowUpRight, MapPin, Plus, Search, Star, Store, TrendingUp } from 'lucide-react';
import { money } from '../../lib/api.js';

function MealRecommendations({ title, description, products, onAdd, icon: Icon }) {
    if (!products.length) return null;

    return (
        <section className="section-block">
            <div className="dashboard-section-heading">
                <div>
                    <span className="eyebrow">QUICK PICKS</span>
                    <h2>{title}</h2>
                    <p>{description}</p>
                </div>
                {Icon && <Icon size={21} />}
            </div>
            <div className="product-grid role-product-grid">
                {products.map((product) => (
                    <article className="product-card role-product-card" key={product.id}>
                        <img className="product-image" src={product.image_url || '/images/hero-food.png'} alt={product.name} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = '/images/hero-food.png'; }} />
                        <div className="product-details">
                            <div className="product-meta">
                                <span className="product-category">{product.store_name}</span>
                                {product.promo_active && <span className="promo-label-pill">{product.promo_label || 'Special offer'}</span>}
                                {Number(product.sold_count) > 0 && <span className="stock-good">{Number(product.sold_count)} sold</span>}
                            </div>
                            <h3>{product.name}</h3>
                            <p>{product.description}</p>
                            <div className="product-bottom">
                                <div>
                                    <strong>{money(product.price)}</strong>
                                    {Number(product.old_price) > Number(product.price) && <del>{money(product.old_price)}</del>}
                                </div>
                                <button className="add-button" disabled={!product.is_available || Number(product.stock) < 1} onClick={() => onAdd(product)} aria-label={`Add ${product.name} to cart`}>
                                    <Plus size={19} />
                                </button>
                            </div>
                        </div>
                    </article>
                ))}
            </div>
        </section>
    );
}

export function CustomerHomePage({ stores, products = [], orders = [], onOpenStore, onAdd, search, onSearch }) {
    const filteredStores = stores.filter((store) => `${store.name} ${store.description}`.toLowerCase().includes(search.toLowerCase()));
    const availableProducts = products.filter((product) => Boolean(product.is_available) && Number(product.stock) > 0);
    const mostRecentProductIds = [];

    [...orders]
        .filter((order) => order.status !== 'Cancelled')
        .sort((left, right) => new Date(right.created_at) - new Date(left.created_at))
        .forEach((order) => {
            (order.items || []).forEach((item) => {
                if (item.product_id && !mostRecentProductIds.includes(Number(item.product_id))) {
                    mostRecentProductIds.push(Number(item.product_id));
                }
            });
        });

    const recentlyOrdered = mostRecentProductIds
        .map((id) => availableProducts.find((product) => Number(product.id) === id))
        .filter(Boolean)
        .slice(0, 4);

    const popularMeals = [...availableProducts]
        .sort((left, right) => Number(right.sold_count || 0) - Number(left.sold_count || 0) || Number(left.price) - Number(right.price))
        .slice(0, 4);

    const budgetPicks = [...availableProducts]
        .sort((left, right) => Number(left.price) - Number(right.price))
        .slice(0, 4);

    const promotionalMeals = [...availableProducts]
        .filter((product) => product.promo_active)
        .sort((left, right) =>
            (Number(right.regular_price) - Number(right.price)) -
            (Number(left.regular_price) - Number(left.price))
        )
        .slice(0, 4);

    return (
        <div className="page-stack">
            <section className="customer-hero">
                <div>
                    <span className="eyebrow">YOUR CAMPUS, YOUR CRAVINGS</span>
                    <h1>Good food. <span>Better days.</span></h1>
                    <p>Find your next favorite meal from stores around campus.</p>
                    <div className="customer-hero-points"><span><Store size={15} /> Local campus stores</span><span><Star size={15} /> Sorted by ratings</span></div>
                </div>
                <div className="customer-hero-image"><img src="/images/hero-food.png" alt="Freshly prepared meal" /></div>
            </section>

            <MealRecommendations title="Promotional items" description="Limited-time deals from campus stores. Prices are rechecked at checkout." products={promotionalMeals} onAdd={onAdd} icon={TrendingUp} />
            {recentlyOrdered.length > 0 && <MealRecommendations title="Order again" description="Your recent meals are ready for a quick reorder." products={recentlyOrdered} onAdd={onAdd} icon={TrendingUp} />}
            <MealRecommendations title="Popular around campus" description="Meals with the most orders across active stores." products={popularMeals} onAdd={onAdd} icon={TrendingUp} />
            <MealRecommendations title="Budget-friendly picks" description="Affordable meals sorted from lowest to highest price." products={budgetPicks} onAdd={onAdd} />

            <section className="section-block">
                <div className="dashboard-section-heading">
                    <div>
                        <span className="eyebrow">STUDENT FAVORITES</span>
                        <h2>Recommended stores</h2>
                        <p>Stores with higher ratings appear first.</p>
                    </div>
                    <label className="store-search"><Search size={17} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search stores" /></label>
                </div>
                {filteredStores.length ? (
                    <div className="store-grid">
                        {filteredStores.map((store, index) => (
                            <article className="store-card" key={store.id}>
                                <button className="store-image-button" onClick={() => onOpenStore(store)} aria-label={`Open ${store.name}`}>
                                    <img src={store.image_url || '/images/hero-food.png'} alt={store.name} onError={(event) => { event.currentTarget.onerror = null; event.currentTarget.src = '/images/hero-food.png'; }} />
                                    {index === 0 && <span className="recommended-pill">Top rated</span>}
                                </button>
                                <div className="store-card-body">
                                    <div className="store-title-line"><h3>{store.name}</h3><span className="store-rating"><Star size={15} fill="currentColor" /> {store.rating ? Number(store.rating).toFixed(1) : 'New'}</span></div>
                                    <p>{store.description}</p>
                                    <div className="store-card-meta"><span><Store size={14} /> {store.product_count} items</span><span><MapPin size={14} /> {store.location_name}</span></div>
                                    <button className="secondary-button store-open-button" onClick={() => onOpenStore(store)}>Browse store <ArrowUpRight size={16} /></button>
                                </div>
                            </article>
                        ))}
                    </div>
                ) : <div className="dashboard-empty"><Store size={28} /><h3>No stores found</h3><p>Try another search or check back later.</p></div>}
            </section>
        </div>
    );
}