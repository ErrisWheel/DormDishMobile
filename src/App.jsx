import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bike, Heart, Home, LogOut, Moon, Package, Settings2, ShoppingCart, Store, Sun, Utensils, UserRound, Users, Star, ListOrdered, CircleHelp } from 'lucide-react';
import { apiRequest, clearSession, getToken, money, saveSession, roleLabel } from './lib/api.js';
import { LoginPage } from './components/LoginPage.jsx';
import { CustomerHomePage } from './pages/customer/CustomerHomePage.jsx';
import { StoreMenuPage } from './pages/customer/StoreMenuPage.jsx';
import { CustomerOrdersPage } from './pages/customer/CustomerOrdersPage.jsx';
import { CustomerCartPage } from './pages/customer/CustomerCartPage.jsx';
import { CustomerProfilePage } from './pages/customer/CustomerProfilePage.jsx';
import { CustomerOrderConfirmationPage } from './pages/customer/CustomerOrderConfirmationPage.jsx';
import { ManagerDashboard } from './pages/manager/ManagerDashboard.jsx';
import { AdminDashboard } from './pages/admin/AdminDashboard.jsx';
import { RiderDashboard } from './pages/rider/RiderDashboard.jsx';
import './styles.css';
import './role-styles.css';
import './enhancements.css';

const navigation = {
    customer: [
        { page: 'customer-home', label: 'Stores', icon: Store },
        { page: 'customer-orders', label: 'My orders', icon: ListOrdered },
        { page: 'customer-favorites', label: 'Favorites', icon: Heart },
        { page: 'customer-profile', label: 'My profile', icon: UserRound }
    ],
    store_manager: [
        { page: 'manager-dashboard', label: 'Overview', icon: Home },
        { page: 'manager-products', label: 'Products', icon: Package },
        { page: 'manager-orders', label: 'Orders & tracking', icon: ListOrdered },
        { page: 'manager-ratings', label: 'Store ratings', icon: Star }
    ],
    superadmin: [
        { page: 'admin-users', label: 'Accounts', icon: Users },
        { page: 'admin-stores', label: 'Stores', icon: Store },
        { page: 'admin-settings', label: 'Settings', icon: Settings2 },
        { page: 'admin-ratings', label: 'Ratings moderation', icon: Star }
    ],
    rider: [
        { page: 'rider-dashboard', label: 'My deliveries', icon: Bike }
    ]
};

function readStoredJson(key, fallback) {
    try {
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : fallback;
    } catch {
        return fallback;
    }
}

function getHomePage(role) {
    return {
        customer: 'customer-home',
        store_manager: 'manager-dashboard',
        superadmin: 'admin-users',
        rider: 'rider-dashboard'
    }[role] || 'customer-home';
}

function App() {
    const [user, setUser] = useState(null);
    const [checkingSession, setCheckingSession] = useState(Boolean(getToken()));
    const [page, setPage] = useState('customer-home');
    const [stores, setStores] = useState([]);
    const [products, setProducts] = useState([]);
    const [selectedStore, setSelectedStore] = useState(null);
    const [storeProducts, setStoreProducts] = useState([]);
    const [orders, setOrders] = useState([]);
    const [lastPlacedOrder, setLastPlacedOrder] = useState(null);
    const [cart, setCart] = useState(() => readStoredJson('dormdish-cart', []));
    const [favorites, setFavorites] = useState(() => readStoredJson('dormdish-favorites', []));
    const [address, setAddress] = useState(() => localStorage.getItem('dormdish-address') || 'TIPQC Main Building');
    const [payment, setPayment] = useState('Cash on delivery');
    const [storeSearch, setStoreSearch] = useState('');
    const [menuSearch, setMenuSearch] = useState('');
    const [toast, setToast] = useState('');
    const [dark, setDark] = useState(() => localStorage.getItem('dormdish-theme') === 'dark');
    const [loadingCustomerData, setLoadingCustomerData] = useState(false);
    const [placingOrder, setPlacingOrder] = useState(false);
    const [deliveryFee, setDeliveryFee] = useState(20);

    const notify = useCallback((message) => setToast(message), []);

    const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);


    useEffect(() => {
        localStorage.setItem('dormdish-cart', JSON.stringify(cart));
    }, [cart]);

    useEffect(() => {
        localStorage.setItem('dormdish-favorites', JSON.stringify(favorites));
    }, [favorites]);

    useEffect(() => {
        localStorage.setItem('dormdish-address', address);
    }, [address]);

    useEffect(() => {
        localStorage.setItem('dormdish-theme', dark ? 'dark' : 'light');
    }, [dark]);

    useEffect(() => {
        if (!toast) {
            return undefined;
        }

        const timeout = setTimeout(() => setToast(''), 2800);
        return () => clearTimeout(timeout);
    }, [toast]);

    useEffect(() => {
        if (!getToken()) {
            setCheckingSession(false);
            return;
        }

        let active = true;
        apiRequest('/auth/me')
            .then((result) => {
                if (active) {
                    setUser(result.user);
                    setPage(getHomePage(result.user.role));
                }
            })
            .catch(() => {
                clearSession();
            })
            .finally(() => {
                if (active) {
                    setCheckingSession(false);
                }
            });

        return () => {
            active = false;
        };
    }, []);

    const refreshCustomerData = useCallback(async (silent = false) => {
        if (!user || user.role !== 'customer') {
            return;
        }

        if (!silent) {
            setLoadingCustomerData(true);
        }
        try {
            const [storeResult, productResult, orderResult, settingsResult] = await Promise.all([
                apiRequest('/stores'),
                apiRequest('/products'),
                apiRequest('/orders'),
                apiRequest('/settings/public')
            ]);
            setStores(storeResult.stores);
            setProducts(productResult.products);
            setOrders(orderResult.orders);
            setDeliveryFee(Number(settingsResult.settings.delivery_fee || 20));
        } catch (error) {
            if (error.status === 401) {
                handleLogout();
                return;
            }
            notify(error.message);
        } finally {
            if (!silent) {
                setLoadingCustomerData(false);
            }
        }
    }, [user, notify]);

    useEffect(() => {
        if (user?.role !== 'customer') {
            setStores([]);
            setProducts([]);
            setOrders([]);
            return undefined;
        }

        refreshCustomerData();
        const interval = setInterval(() => refreshCustomerData(true), 20000);
        return () => clearInterval(interval);
    }, [user?.id, user?.role, refreshCustomerData]);

    const activeNavigation = useMemo(() => navigation[user?.role] || [], [user?.role]);

    function handleLogin(nextUser) {
        setUser(nextUser);
        setPage(getHomePage(nextUser.role));
        setSelectedStore(null);
        setStoreProducts([]);
        notify(`Welcome, ${nextUser.name}.`);
    }

    function handleLogout() {
        clearSession();
        setUser(null);
        setPage('customer-home');
        setSelectedStore(null);
        setStoreProducts([]);
        setOrders([]);
        setCart([]);
        setFavorites([]);
        setAddress('TIPQC Main Building');
        notify('You have signed out.');
    }

    function navigate(nextPage) {
        setPage(nextPage);
        if (nextPage === 'customer-home') {
            setSelectedStore(null);
            setStoreProducts([]);
            setMenuSearch('');
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async function openStore(store) {
        try {
            const result = await apiRequest(`/stores/${store.id}/products`);
            setSelectedStore({ ...store, ...result.store });
            setStoreProducts(result.products);
            setMenuSearch('');
            setPage('customer-menu');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (error) {
            notify(error.message);
        }
    }

    function addToCart(product) {
        const productStoreId = Number(product.store_id);
        if (cart.length && Number(cart[0].store_id) !== productStoreId) {
            const shouldSwitch = window.confirm(`Your cart contains items from ${cart[0].store_name}. Clear it and start a cart for ${product.store_name || selectedStore?.name}?`);
            if (!shouldSwitch) {
                return;
            }
            setCart([{ ...product, quantity: 1 }]);
            notify(`${product.name} added to a new cart.`);
            return;
        }

        setCart((current) => {
            const existing = current.find((item) => item.id === product.id);
            if (existing) {
                return current.map((item) => item.id === product.id
                    ? { ...item, quantity: Math.min(item.quantity + 1, item.stock) }
                    : item);
            }
            return [...current, { ...product, quantity: 1 }];
        });
        notify(`${product.name} added to cart.`);
    }

    function changeQuantity(productId, amount) {
        setCart((current) => current
            .map((item) => item.id === productId
                ? { ...item, quantity: Math.min(item.stock, item.quantity + amount) }
                : item)
            .filter((item) => item.quantity > 0));
    }

    function removeFromCart(productId) {
        setCart((current) => current.filter((item) => item.id !== productId));
    }

    function toggleFavorite(productId) {
        setFavorites((current) => current.includes(productId)
            ? current.filter((id) => id !== productId)
            : [...current, productId]);
    }

    async function placeOrder() {
        if (!cart.length) {
            notify('Your cart is empty.');
            return;
        }

        setPlacingOrder(true);
        try {
            const result = await apiRequest('/orders', {
                method: 'POST',
                body: {
                    storeId: cart[0].store_id,
                    items: cart.map((item) => ({ productId: item.id, quantity: item.quantity })),
                    deliveryAddress: address,
                    paymentMethod: payment
                }
            });
            setCart([]);
            setLastPlacedOrder(result.order);
            await refreshCustomerData();
            setPage('customer-order-confirmation');
            notify(`Order ${result.order.id} placed successfully.`);
        } catch (error) {
            notify(error.message);
        } finally {
            setPlacingOrder(false);
        }
    }

    async function saveProfile(name) {
        try {
            const result = await apiRequest('/auth/profile', { method: 'PATCH', body: { name } });
            setUser(result.user);
            saveSession(getToken(), result.user);
            notify('Profile updated.');
        } catch (error) {
            notify(error.message);
        }
    }

    if (checkingSession) {
        return <main className="auth-shell"><div className="loading-card">Loading your DormDish session…</div></main>;
    }

    if (!user) {
        return <div className={`app-shell ${dark ? 'dark' : ''}`}><LoginPage onLogin={handleLogin} dark={dark} onToggleDark={() => setDark((current) => !current)} /></div>;
    }

    const isCustomer = user.role === 'customer';
    const isManager = user.role === 'store_manager';
    const isAdmin = user.role === 'superadmin';
    const isRider = user.role === 'rider';
    const pageTitle = activeNavigation.find((item) => item.page === page)?.label || (page === 'customer-menu' ? selectedStore?.name : page === 'customer-cart' ? 'Your cart' : page === 'customer-order-confirmation' ? 'Order confirmation' : 'DormDish');

    return (
        <div className={`app-shell ${dark ? 'dark' : ''}`}>
            <header className="topbar">
                <button className="brand" onClick={() => navigate(getHomePage(user.role))} aria-label="DormDish home"><span className="brand-mark"><Utensils size={19} strokeWidth={2.5} /></span><span>Dorm<span>Dish</span><small>Campus dining, simplified</small></span></button>
                <div className="top-actions"><span className="role-chip">{roleLabel(user.role)}</span>{isCustomer && <button className="header-cart-button" onClick={() => navigate('customer-cart')}><ShoppingCart size={18} /><span>Cart</span>{cartCount > 0 && <b>{cartCount}</b>}</button>}<button className="icon-button theme-toggle" onClick={() => setDark((current) => !current)} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button><button className="profile-chip" onClick={() => isCustomer && navigate('customer-profile')}><span className="avatar">{user.name.trim().charAt(0).toUpperCase()}</span><span className="profile-chip-name">{user.name}</span></button><button className="icon-button" onClick={handleLogout} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button></div>
            </header>
            <div className="layout">
                <aside className="sidebar"><div className="sidebar-label">{isCustomer ? 'YOUR SPACE' : isManager ? 'STORE WORKSPACE' : isAdmin ? 'ADMINISTRATION' : 'RIDER WORKSPACE'}</div>{activeNavigation.map(({ page: navPage, label, icon: Icon }) => <button key={navPage} className={`nav-button ${page === navPage || (navPage === 'customer-home' && page === 'customer-menu') || (navPage === 'manager-dashboard' && page === 'manager-dashboard') ? 'active' : ''}`} onClick={() => navigate(navPage)}><Icon size={19} /><span>{label}</span>{navPage === 'customer-orders' && orders.length > 0 && <b>{orders.length}</b>}</button>)}{isCustomer && <><div className="sidebar-label sidebar-label-spaced">ORDERING</div><button className={`nav-button ${page === 'customer-cart' ? 'active' : ''}`} onClick={() => navigate('customer-cart')}><ShoppingCart size={19} /><span>Cart</span>{cartCount > 0 && <b>{cartCount}</b>}</button></>}<div className="sidebar-help"><div className="help-icon"><CircleHelp size={19} /></div><strong>{isCustomer ? 'Need a hand?' : 'Demo environment'}</strong><p>{isCustomer ? 'Orders and tracking are saved in the local SQLite database.' : 'This workspace uses seeded test data and simulated delivery updates.'}</p>{isCustomer && <a href="https://www.google.com/maps?cid=2385593826430662165&g_mp=CiVnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLkdldFBsYWNlEAMYASAF" target="_blank" rel="noreferrer">View store location</a>}</div><div className="sidebar-footer">© 2026 DormDish PH<br /><span>Local SQLite school demo</span></div></aside>
                <main className="main-content">
                    <div key={page} className="page-transition">
                        {isCustomer && page === 'customer-home' && <CustomerHomePage stores={stores} onOpenStore={openStore} search={storeSearch} onSearch={setStoreSearch} />}
                        {isCustomer && page === 'customer-menu' && <StoreMenuPage store={selectedStore} products={storeProducts} onBack={() => navigate('customer-home')} onAdd={addToCart} query={menuSearch} onQuery={setMenuSearch} favorites={favorites} onFavorite={toggleFavorite} />}
                        {isCustomer && page === 'customer-orders' && <CustomerOrdersPage orders={orders} onRefresh={() => refreshCustomerData(false)} onBrowse={() => navigate('customer-home')} onToast={notify} />}
                        {isCustomer && page === 'customer-order-confirmation' && lastPlacedOrder && <CustomerOrderConfirmationPage order={lastPlacedOrder} onTrack={() => navigate('customer-orders')} onContinue={() => navigate('customer-home')} />}
                        {isCustomer && page === 'customer-cart' && <CustomerCartPage cart={cart} address={address} onAddress={setAddress} payment={payment} onPayment={setPayment} onQuantity={changeQuantity} onRemove={removeFromCart} onPlaceOrder={placeOrder} onBack={() => navigate(selectedStore ? 'customer-menu' : 'customer-home')} busy={placingOrder} deliveryFee={deliveryFee} />}
                        {isCustomer && page === 'customer-favorites' && <div className="page-stack"><div className="dashboard-section-heading"><div><span className="eyebrow">SAVED FOR LATER</span><h1>Favorite meals</h1><p>Favorites are saved on this device while product information comes from SQLite.</p></div></div>{products.filter((product) => favorites.includes(product.id)).length ? <div className="product-grid role-product-grid">{products.filter((product) => favorites.includes(product.id)).map((product) => <article className="product-card role-product-card" key={product.id}><img className="product-image" src={product.image_url} alt={product.name} /><div className="product-details"><span className="product-category">{product.store_name}</span><h3>{product.name}</h3><p>{product.description}</p><div className="product-bottom"><strong>{money(product.price)}</strong><button className="secondary-button small-button" onClick={() => openStore(stores.find((store) => store.id === product.store_id))}>Open store</button></div><button className="favorite-remove-link" onClick={() => toggleFavorite(product.id)}>Remove from favorites</button></div></article>)}</div> : <div className="dashboard-empty"><Heart size={28} /><h3>No favorites yet</h3><p>Open a store menu and save your favorite products from there.</p><button className="primary-button" onClick={() => navigate('customer-home')}>Browse stores</button></div>}</div>}
                        {isCustomer && page === 'customer-profile' && <CustomerProfilePage user={user} address={address} onAddress={setAddress} onSave={saveProfile} orders={orders} favorites={favorites} />}
                        {isManager && page.startsWith('manager-') && <ManagerDashboard key={user.id} user={user} page={page} onToast={notify} />}
                        {isAdmin && page.startsWith('admin-') && <AdminDashboard key={user.id} page={page} onToast={notify} />}
                        {isRider && page === 'rider-dashboard' && <RiderDashboard onToast={notify} />}
                    </div>
                    {isCustomer && loadingCustomerData && <div className="inline-sync-indicator">Syncing order and store data…</div>}
                </main>
            </div>
            <nav className="mobile-bottom-nav">{activeNavigation.map(({ page: navPage, label, icon: Icon }) => <button key={navPage} className={page === navPage || (navPage === 'customer-home' && page === 'customer-menu') ? 'active' : ''} onClick={() => navigate(navPage)}><Icon size={20} /><span>{label}</span></button>)}{isCustomer && <button className={page === 'customer-cart' ? 'active' : ''} onClick={() => navigate('customer-cart')}><ShoppingCart size={20} /><span>Cart</span>{cartCount > 0 && <b>{cartCount}</b>}</button>}</nav>
            {toast && <div className="toast-message" role="status">{toast}</div>}
        </div>
    );
}

export default App;
