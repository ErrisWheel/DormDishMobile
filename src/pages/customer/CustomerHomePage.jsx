import { MapPin, Search, Star, Store, ArrowUpRight } from 'lucide-react';

export function CustomerHomePage({ stores, onOpenStore, search, onSearch }) {
    const filteredStores = stores.filter((store) => `${store.name} ${store.description}`.toLowerCase().includes(search.toLowerCase()));

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

            <section className="section-block">
                <div className="dashboard-section-heading">
                    <div><span className="eyebrow">STUDENT FAVORITES</span><h2>Recommended stores</h2><p>Stores with higher ratings appear first.</p></div>
                    <label className="store-search"><Search size={17} /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Search stores" /></label>
                </div>
                {filteredStores.length ? (
                    <div className="store-grid">
                        {filteredStores.map((store, index) => (
                            <article className="store-card" key={store.id}>
                                <button className="store-image-button" onClick={() => onOpenStore(store)} aria-label={`Open ${store.name}`}>
                                    <img src={store.image_url || '/images/hero-food.png'} alt={store.name} />
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
                ) : (
                    <div className="dashboard-empty"><Store size={28} /><h3>No stores found</h3><p>Try another search or check back later.</p></div>
                )}
            </section>
        </div>
    );
}
