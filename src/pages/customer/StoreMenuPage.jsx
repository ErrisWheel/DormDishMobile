import { ArrowLeft, Heart, MapPin, Plus, Search, Star } from 'lucide-react';
import { money } from '../../lib/api.js';

export function StoreMenuPage({ store, products, onBack, onAdd, query, onQuery, favorites, onFavorite }) {
    const filtered = products.filter((product) => `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(query.toLowerCase()));

    if (!store) {
        return <div className="dashboard-empty"><h3>Choose a store first</h3><button className="primary-button" onClick={onBack}>Browse stores</button></div>;
    }

    return (
        <div className="page-stack">
            <button className="back-link" onClick={onBack}><ArrowLeft size={16} /> All stores</button>
            <section className="store-detail-hero">
                <img src={store.image_url || '/images/hero-food.png'} alt={store.name} />
                <div><span className="eyebrow">CAMPUS STORE</span><h1>{store.name}</h1><p>{store.description}</p><div className="store-card-meta"><span><Star size={15} fill="currentColor" /> {store.rating ? Number(store.rating).toFixed(1) : 'New'} ({store.rating_count || 0} ratings)</span><span><MapPin size={15} /> {store.location_name}</span></div><a className="map-link" href={store.maps_url} target="_blank" rel="noreferrer"><MapPin size={16} /> Open store location in Google Maps</a></div>
            </section>
            <section className="section-block">
                <div className="dashboard-section-heading"><div><span className="eyebrow">MADE FOR YOUR BREAK</span><h2>Menu</h2><p>Product and stock information comes from SQLite.</p></div><label className="store-search"><Search size={17} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search menu" /></label></div>
                {filtered.length ? <div className="product-grid role-product-grid">{filtered.map((product) => <article className="product-card role-product-card" key={product.id}><img className="product-image" src={product.image_url || '/images/hero-food.png'} alt={product.name} /><button className={`role-favorite-button ${favorites.includes(product.id) ? 'active' : ''}`} onClick={() => onFavorite(product.id)} aria-label={`Toggle favorite for ${product.name}`}><Heart size={17} fill={favorites.includes(product.id) ? 'currentColor' : 'none'} /></button><div className="product-details"><div className="product-meta"><span className="product-category">{product.category}</span><span className={product.stock > 0 ? 'stock-good' : 'stock-empty'}>{product.stock > 0 ? `${product.stock} left` : 'Out of stock'}</span></div><h3>{product.name}</h3><p>{product.description}</p><div className="product-bottom"><strong>{money(product.price)}</strong><button className="add-button" disabled={!product.stock || !product.is_available} onClick={() => onAdd(product)} aria-label={`Add ${product.name}`}><Plus size={19} /></button></div></div></article>)}</div> : <div className="dashboard-empty"><h3>No products found</h3><p>This store has no matching products available.</p></div>}
            </section>
        </div>
    );
}
