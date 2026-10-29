import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bike, Heart, Home, LogOut, Moon, Package, Settings2, ShoppingCart, Store, Sun, Utensils, UserRound, Users, Star, ListOrdered, CircleHelp, MailCheck, BadgeCheck } from 'lucide-react';
import { apiRequest, clearSession, getToken, money, saveSession, roleLabel } from './lib/api.js';
import { LoginPage } from './components/LoginPage.jsx';
import { SignupPage } from './components/SignupPage.jsx';
import { CustomerHomePage } from './pages/customer/CustomerHomePage.jsx';
import { StoreMenuPage } from './pages/customer/StoreMenuPage.jsx';
import { CustomerOrdersPage } from './pages/customer/CustomerOrdersPage.jsx';
import { CustomerCartPage } from './pages/customer/CustomerCartPage.jsx';
import { CustomerProfilePage } from './pages/customer/CustomerProfilePage.jsx';
import { CustomerOrderConfirmationPage } from './pages/customer/CustomerOrderConfirmationPage.jsx';
import { ManagerDashboard } from './pages/manager/ManagerDashboard.jsx';
import { AdminDashboard } from './pages/admin/AdminDashboard.jsx';
import { RiderDashboard } from './pages/rider/RiderDashboard.jsx';
import { VerificationPage } from './pages/VerificationPage.jsx';
import { AccountProfilePage } from './pages/AccountProfilePage.jsx';
import { SupportPage } from './pages/SupportPage.jsx';
import { MediaImage } from './components/MediaImage.jsx';
import './styles.css';
import './role-styles.css';
import './enhancements.css';

// Navbar
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
    const [verificationToken, setVerificationToken] = useState(() => new URLSearchParams(window.location.search).get('verify') || '');
    const [stores, setStores] = useState([]);
    const [products, setProducts] = useState([]);
    const [selectedStore, setSelectedStore] = useState(null);
    const [storeProducts, setStoreProducts] = useState([]);
    const [orders, setOrders] = useState([]);
    const [lastPlacedOrder, setLastPlacedOrder] = useState(null);
    const [cart, setCart] = useState(() => readStoredJson('dormdish-cart', []));
    const [favorites, setFavorites] = useState(() => readStoredJson('dormdish-favorites', []));
    const [address, setAddress] = useState('');
    const [savedAddresses, setSavedAddresses] = useState([]);
    const [selectedAddressId, setSelectedAddressId] = useState('');
    const [deliveryInstructions, setDeliveryInstructions] = useState('');
    const [payment, setPayment] = useState('Cash on delivery');
    const [orderNotes, setOrderNotes] = useState(() => localStorage.getItem('dormdish-order-notes') || '');
    const orderPlacementLock = useRef(false);
    const [storeSearch, setStoreSearch] = useState('');
    const [menuSearch, setMenuSearch] = useState('');
    const [toast, setToast] = useState('');
    const [dark, setDark] = useState(() => localStorage.getItem('dormdish-theme') === 'dark');
    const [loadingCustomerData, setLoadingCustomerData] = useState(false);
    const [placingOrder, setPlacingOrder] = useState(false);
    const [deliveryFee, setDeliveryFee] = useState(20);
    const [studentDiscountPercent, setStudentDiscountPercent] = useState(5);
    const [groupOrder, setGroupOrder] = useState(null);
    const [groupBusy, setGroupBusy] = useState(false);

    const notify = useCallback((message) => setToast(message), []);

    const refreshAuthenticatedUser = useCallback(async (verifiedUser = null) => {
        const token = getToken();
        if (!token) return null;
        try {
            const result = await apiRequest('/auth/me');
            const latestUser = result?.user;
            if (!latestUser) return null;
            if (verifiedUser?.email && String(latestUser.email).toLowerCase() !== String(verifiedUser.email).toLowerCase()) return null;
            saveSession(token, latestUser);
            setUser((current) => {
                if (current && String(current.id) !== String(latestUser.id)) return current;
                return latestUser;
            });
            return latestUser;
        } catch {
            return null;
        }
    }, []);

    const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

    useEffect(() => {
        localStorage.setItem('dormdish-cart', JSON.stringify(cart));
    }, [cart]);

    useEffect(() => {
        localStorage.setItem('dormdish-favorites', JSON.stringify(favorites));
    }, [favorites]);

    useEffect(() => {
        localStorage.setItem('dormdish-order-notes', orderNotes);
    }, [orderNotes]);

    useEffect(() => {
        localStorage.setItem('dormdish-theme', dark ? 'dark' : 'light');
    }, [dark]);

    useEffect(() => {
        if (!toast) return undefined;
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
                if (active) setCheckingSession(false);
            });

        return () => {
            active = false;
        };
    }, []);

    // Keep verification and account details in sync when the email link is opened outside the app.
    useEffect(() => {
        if (!user?.id || !getToken()) return undefined;
        let active = true;
        const syncAccount = async () => {
            if (!active || document.visibilityState === 'hidden') return;
            await refreshAuthenticatedUser();
        };
        window.addEventListener('focus', syncAccount);
        document.addEventListener('visibilitychange', syncAccount);
        const interval = setInterval(syncAccount, 30000);
        return () => {
            active = false;
            window.removeEventListener('focus', syncAccount);
            document.removeEventListener('visibilitychange', syncAccount);
            clearInterval(interval);
        };
    }, [user?.id, refreshAuthenticatedUser]);

    const refreshCustomerData = useCallback(async (silent = false) => {
        if (!user || user.role !== 'customer') return;

        if (!silent) setLoadingCustomerData(true);

        try {
            const [storeResult, productResult, orderResult, settingsResult, groupResult, addressResult] = await Promise.all([
                apiRequest('/stores'),
                apiRequest('/products'),
                apiRequest('/orders'),
                apiRequest('/settings/public'),
                apiRequest('/group-orders/mine'),
                apiRequest('/customer/addresses')
            ]);

            setStores(storeResult.stores);
            setProducts(productResult.products);
            setOrders(orderResult.orders);
            setDeliveryFee(Number(settingsResult.settings.delivery_fee || 20));
            setStudentDiscountPercent(Number(settingsResult.settings.student_discount_percent || 5));
            setGroupOrder(groupResult.groupOrder);
            const addresses = addressResult.addresses || [];
            setSavedAddresses(addresses);
            const selected = addresses.find((item) => String(item.id) === String(selectedAddressId)) || addresses.find((item) => Number(item.is_default)) || addresses[0];
            if (selected) {
                setSelectedAddressId(String(selected.id));
                setAddress((current) => !current || current === 'TIPQC Main Building' ? selected.address_text : current);
                setDeliveryInstructions((current) => current || selected.delivery_instructions || '');
            }
        } catch (error) {
            if (error.status === 401) {
                handleLogout({ skipConfirm: true });
                return;
            }
            notify(error.message);
        } finally {
            if (!silent) setLoadingCustomerData(false);
        }
    }, [user, notify, selectedAddressId]);

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

    function handleLogin(nextUser, authResult = null) {
        setUser(nextUser);
        setPage(getHomePage(nextUser.role));
        setSelectedStore(null);
        setStoreProducts([]);
        notify(authResult?.verificationMessage || `Welcome, ${nextUser.name}.`);
    }

    function handleLogout({ skipConfirm = false } = {}) {
        if (!skipConfirm && !window.confirm('Are you sure you want to log out?')) return;
        clearSession();
        setUser(null);
        setPage('customer-home');
        setSelectedStore(null);
        setStoreProducts([]);
        setOrders([]);
        setGroupOrder(null);
        setCart([]);
        setFavorites([]);
        setAddress('');
        localStorage.removeItem('dormdish-address');
        setSavedAddresses([]);
        setSelectedAddressId('');
        setDeliveryInstructions('');
        setOrderNotes('');
        localStorage.removeItem('dormdish-order-notes');
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
            const shouldSwitch = window.confirm(
                `Your cart contains items from ${cart[0].store_name}. Clear it and start a cart for ${product.store_name || selectedStore?.name}?`
            );

            if (!shouldSwitch) return;

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

    function selectSavedAddress(addressId) {
        const selected = savedAddresses.find((item) => String(item.id) === String(addressId));
        setSelectedAddressId(selected ? String(selected.id) : '');
        setAddress(selected?.address_text || '');
        setDeliveryInstructions(selected?.delivery_instructions || '');
    }

    function updateCheckoutAddress(value) {
        setAddress(value);
        setSelectedAddressId('');
        setDeliveryInstructions('');
    }

    async function refreshSavedAddresses() {
        const result = await apiRequest('/customer/addresses');
        setSavedAddresses(result.addresses || []);
        const selected = (result.addresses || []).find((item) => String(item.id) === String(selectedAddressId)) || (result.addresses || []).find((item) => Number(item.is_default)) || (result.addresses || [])[0];
        if (selected) {
            setSelectedAddressId(String(selected.id));
            setAddress(selected.address_text);
            setDeliveryInstructions(selected.delivery_instructions || '');
        } else {
            setSelectedAddressId('');
            setAddress('');
            setDeliveryInstructions('');
        }
    }

    async function placeOrder() {
        if (orderPlacementLock.current || placingOrder) return;

        if (!cart.length) {
            notify('Your cart is empty.');
            return;
        }

        if (!address.trim()) {
            notify('Enter a delivery location before placing your order.');
            return;
        }

        orderPlacementLock.current = true;
        setPlacingOrder(true);

        try {
            const liveResult = await apiRequest(`/stores/${cart[0].store_id}/products`);
            const liveProducts = new Map(liveResult.products.map((product) => [Number(product.id), product]));

            const unavailable = cart.filter((item) => {
                const latest = liveProducts.get(Number(item.id));
                return !latest || !latest.is_available || Number(latest.stock) < 1;
            });

            if (unavailable.length) {
                setCart((current) => current.filter((item) => !unavailable.some((missing) => missing.id === item.id)));
                notify(`${unavailable.map((item) => item.name).join(', ')} ${unavailable.length === 1 ? 'is' : 'are'} no longer available and ${unavailable.length === 1 ? 'has' : 'have'} been removed. Review your cart.`);
                return;
            }

            let stockChanged = false;
            let priceChanged = false;

            const refreshedCart = cart.map((item) => {
                const latest = liveProducts.get(Number(item.id));

                if (Number(latest.stock) < item.quantity) stockChanged = true;
                if (Number(latest.price) !== Number(item.price)) priceChanged = true;

                return {
                    ...latest,
                    quantity: Math.min(item.quantity, Number(latest.stock))
                };
            }).filter((item) => item.quantity > 0);

            if (stockChanged || priceChanged) {
                setCart(refreshedCart);
                notify(stockChanged
                    ? 'Stock changed. Your cart quantity was updated; review it before placing the order.'
                    : 'A product price changed. Your cart was updated; review the total before placing the order.');
                return;
            }

            const result = await apiRequest('/orders', {
                method: 'POST',
                body: {
                    storeId: cart[0].store_id,
                    items: cart.map((item) => ({ productId: item.id, quantity: item.quantity })),
                    deliveryAddress: address,
                    paymentMethod: payment,
                    orderNotes: [orderNotes.trim(), deliveryInstructions.trim() ? `Delivery instructions: ${deliveryInstructions.trim()}` : ''].filter(Boolean).join('\n\n')
                }
            });

            setCart([]);
            setOrderNotes('');
            localStorage.removeItem('dormdish-order-notes');
            setLastPlacedOrder(result.order);
            await refreshCustomerData();
            setPage('customer-order-confirmation');
            notify(`Order ${result.order.id} placed successfully.`);
        } catch (error) {
            notify(error.message);
        } finally {
            orderPlacementLock.current = false;
            setPlacingOrder(false);
        }
    }

    async function createGroupOrder() {
        if (!cart.length) {
            notify('Add items to your cart before creating a group order.');
            return;
        }

        if (!address.trim()) {
            notify('Enter a shared delivery location before creating the group.');
            return;
        }

        if (groupBusy || placingOrder) return;

        setGroupBusy(true);

        try {
            const result = await apiRequest('/group-orders', {
                method: 'POST',
                body: {
                    storeId: cart[0].store_id,
                    deliveryAddress: address,
                    items: cart.map((item) => ({ productId: item.id, quantity: item.quantity }))
                }
            });

            setGroupOrder(result.groupOrder);
            setCart([]);
            notify(`Group created. Share code ${result.groupOrder.join_code} with classmates.`);
        } catch (error) {
            notify(error.message);
        } finally {
            setGroupBusy(false);
        }
    }

    async function joinGroupOrder(joinCode) {
        if (groupBusy || placingOrder) return;

        setGroupBusy(true);

        try {
            const result = await apiRequest('/group-orders/join', {
                method: 'POST',
                body: { joinCode }
            });

            setGroupOrder(result.groupOrder);
            notify(`Joined ${result.groupOrder.store_name}. Add meals from that store, then submit your cart to the group.`);
        } catch (error) {
            notify(error.message);
        } finally {
            setGroupBusy(false);
        }
    }

    async function addCartToGroupOrder() {
        if (!groupOrder || !cart.length) {
            notify('Add items to your cart first.');
            return;
        }

        if (Number(cart[0].store_id) !== Number(groupOrder.store_id)) {
            notify(`Choose items from ${groupOrder.store_name} for this group order.`);
            return;
        }

        if (groupBusy || placingOrder) return;

        setGroupBusy(true);

        try {
            const result = await apiRequest(`/group-orders/${encodeURIComponent(groupOrder.id)}/items`, {
                method: 'POST',
                body: { items: cart.map((item) => ({ productId: item.id, quantity: item.quantity })) }
            });

            setGroupOrder(result.groupOrder);
            setCart([]);
            notify('Your cart has been added to the group order.');
        } catch (error) {
            notify(error.message);
        } finally {
            setGroupBusy(false);
        }
    }

    async function refreshGroupOrder() {
        if (!groupOrder) return;

        try {
            const result = await apiRequest('/group-orders/mine');
            setGroupOrder(result.groupOrder);
            if (!result.groupOrder) notify('This group order is no longer open.');
        } catch (error) {
            notify(error.message);
        }
    }

    async function placeGroupOrder(paymentMethod) {
        if (!groupOrder || !Number(groupOrder.host_customer_id) || Number(groupOrder.host_customer_id) !== Number(user.id)) {
            notify('Only the group host can place the combined order.');
            return;
        }

        if (groupBusy || placingOrder) return;
        setGroupBusy(true);

        try {
            const result = await apiRequest(`/group-orders/${encodeURIComponent(groupOrder.id)}/checkout`, {
                method: 'POST',
                body: { paymentMethod, orderNotes }
            });

            setCart([]);
            setOrderNotes('');
            localStorage.removeItem('dormdish-order-notes');
            setLastPlacedOrder(result.order);
            setGroupOrder(null);
            await refreshCustomerData(true);
            setPage('customer-order-confirmation');
            notify(`Group order ${result.order.id} placed successfully.`);
        } catch (error) {
            notify(error.message);
        } finally {
            setGroupBusy(false);
        }
    }

    async function leaveOrCancelGroupOrder() {
        if (!groupOrder || groupBusy || placingOrder) return;

        const isHost = Number(groupOrder.host_customer_id) === Number(user.id);
        const confirmed = window.confirm(
            isHost
                ? 'Cancel this group order? All members will need to start again.'
                : 'Leave this group order and remove your contributed items?'
        );

        if (!confirmed) return;
        setGroupBusy(true);

        try {
            if (isHost) {
                await apiRequest(`/group-orders/${encodeURIComponent(groupOrder.id)}`, { method: 'DELETE' });
            } else {
                await apiRequest(`/group-orders/${encodeURIComponent(groupOrder.id)}/leave`, { method: 'POST' });
            }

            setGroupOrder(null);
            await refreshCustomerData(true);
            notify(isHost ? 'Group order cancelled.' : 'You left the group order.');
        } catch (error) {
            notify(error.message);
        } finally {
            setGroupBusy(false);
        }
    }

    async function saveProfile(profile) {
        try {
            const result = await apiRequest('/auth/profile', { method: 'PATCH', body: profile });
            setUser(result.user);
            saveSession(getToken(), result.user);
            notify('Profile updated.');
            return true;
        } catch (error) {
            notify(error.message);
            return false;
        }
    }

    async function finishVerification(verifiedUser = null) {
        window.history.replaceState({}, '', window.location.pathname + window.location.hash);
        setVerificationToken('');
        if (!getToken()) {
            setUser(null);
            setPage('customer-home');
            setCheckingSession(false);
            return;
        }
        setCheckingSession(true);
        const latestUser = await refreshAuthenticatedUser(verifiedUser);
        if (latestUser) setPage(getHomePage(latestUser.role));
        setCheckingSession(false);
    }

    if (verificationToken) {
        return <div className={`app-shell ${dark ? 'dark' : ''}`}><VerificationPage token={verificationToken} onVerified={refreshAuthenticatedUser} onDone={finishVerification} /></div>;
    }

    if (checkingSession) {
        return <main className="auth-shell"><div className="loading-card">Loading your DormDish session…</div></main>;
    }

    if (!user) {
        return <div className={`app-shell ${dark ? 'dark' : ''}`}>
            {page === 'support' ? <SupportPage onBack={() => setPage('customer-home')} /> : page === 'signup' ? <SignupPage onLogin={handleLogin} onBack={() => setPage('customer-home')} /> : <LoginPage onLogin={handleLogin} onSignUp={() => setPage('signup')} onSupport={() => setPage('support')} dark={dark} onToggleDark={() => setDark((current) => !current)} />}
        </div>;
    }

    const isCustomer = user.role === 'customer';
    const isManager = user.role === 'store_manager';
    const isAdmin = user.role === 'superadmin';
    const isRider = user.role === 'rider';

    return (
        <div className={`app-shell ${dark ? 'dark' : ''}`}>
            <header className="topbar">
                <button className="brand" onClick={() => navigate(getHomePage(user.role))} aria-label="DormDish home">
                    <span className="brand-mark"><Utensils size={19} strokeWidth={2.5} /></span>
                    <span>Dorm<span>Dish</span><small>Campus dining, simplified</small></span>
                </button>
                <div className="top-actions">
                    <span className="role-chip">{roleLabel(user.role)}</span>
                    {Number(user.email_verified) ? <span className="email-verified-topbar" title="Your email is verified"><BadgeCheck size={14} /> Verified</span> : <button className="secondary-button small-button verify-email-topbar" onClick={() => navigate('verify-account')}><MailCheck size={14} /> Verify email</button>}
                    <button className="icon-button" onClick={() => navigate('support')} aria-label="Contact support" title="Contact support"><CircleHelp size={18} /></button>
                    {isCustomer && <button className="header-cart-button" onClick={() => navigate('customer-cart')}><ShoppingCart size={18} /><span>Cart</span>{cartCount > 0 && <b>{cartCount}</b>}</button>}
                    <button className="icon-button theme-toggle" onClick={() => setDark((current) => !current)} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Switch to light mode' : 'Switch to dark mode'}>{dark ? <Sun size={19} /> : <Moon size={19} />}</button>
                    <button className="profile-chip" onClick={() => navigate(isCustomer ? 'customer-profile' : 'account-profile')}>

                        <span className="avatar">{user.profile_image_url ? <MediaImage src={user.profile_image_url} alt="" className="avatar-media" fallbackText={user.name.trim().charAt(0).toUpperCase() || '?'} /> : user.name.trim().charAt(0).toUpperCase() || '?'}</span>
                        <span className="profile-chip-name">{user.name}</span>
                    </button>
                    <button className="icon-button" onClick={() => handleLogout()} aria-label="Sign out" title="Sign out"><LogOut size={18} /></button>
                </div>
            </header>
            <div className="layout">
                <aside className="sidebar">
                    <div className="sidebar-label">{isCustomer ? 'YOUR SPACE' : isManager ? 'STORE WORKSPACE' : isAdmin ? 'ADMINISTRATION' : 'RIDER WORKSPACE'}</div>
                    {activeNavigation.map(({ page: navPage, label, icon: Icon }) => (
                        <button
                            key={navPage}
                            className={`nav-button ${page === navPage || (navPage === 'customer-home' && page === 'customer-menu') ? 'active' : ''}`}
                            onClick={() => navigate(navPage)}
                        >
                            <Icon size={19} /><span>{label}</span>
                            {navPage === 'customer-orders' && orders.length > 0 && <b>{orders.length}</b>}
                        </button>
                    ))}
                    {isCustomer && <>
                        <div className="sidebar-label sidebar-label-spaced">ORDERING</div>
                        <button className={`nav-button ${page === 'customer-cart' ? 'active' : ''}`} onClick={() => navigate('customer-cart')}>
                            <ShoppingCart size={19} /><span>Cart</span>{cartCount > 0 && <b>{cartCount}</b>}
                        </button>
                    </>}
                    <div className="sidebar-help">
                        <div className="help-icon"><CircleHelp size={19} /></div>
                        <strong>{isCustomer ? 'Need a hand?' : 'Demo environment'}</strong>
                        <p>{isCustomer ? 'Orders and tracking are saved in the local SQLite database.' : 'This workspace uses seeded test data and simulated delivery updates.'}</p>
                        {isCustomer && <a href="https://www.google.com/maps?cid=2385593826430662165&g_mp=CiVnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLkdldFBsYWNlEAMYASAF" target="_blank" rel="noreferrer">View store location</a>}
                    </div>
                    <div className="sidebar-footer">© 2026 DormDish PH<br /><span>Local SQLite school demo</span></div>
                </aside>
                <main className="main-content">
                    {/* Routes */}
                    <div key={page} className="page-transition">
                        {isCustomer && page === 'customer-home' && <CustomerHomePage stores={stores} products={products} orders={orders} onOpenStore={openStore} onAdd={addToCart} search={storeSearch} onSearch={setStoreSearch} />}
                        {isCustomer && page === 'customer-menu' && <StoreMenuPage store={selectedStore} products={storeProducts} onBack={() => navigate('customer-home')} onAdd={addToCart} query={menuSearch} onQuery={setMenuSearch} favorites={favorites} onFavorite={toggleFavorite} />}
                        {isCustomer && page === 'customer-orders' && <CustomerOrdersPage orders={orders} onRefresh={() => refreshCustomerData(false)} onBrowse={() => navigate('customer-home')} onToast={notify} />}
                        {isCustomer && page === 'customer-order-confirmation' && lastPlacedOrder && <CustomerOrderConfirmationPage order={lastPlacedOrder} onTrack={() => navigate('customer-orders')} onContinue={() => navigate('customer-home')} />}
                        {isCustomer && page === 'customer-cart' && <CustomerCartPage cart={cart} address={address} onAddress={updateCheckoutAddress} savedAddresses={savedAddresses} selectedAddressId={selectedAddressId} onSelectSavedAddress={selectSavedAddress} deliveryInstructions={deliveryInstructions} onDeliveryInstructions={setDeliveryInstructions} payment={payment} onPayment={setPayment} orderNotes={orderNotes} onOrderNotes={setOrderNotes} onQuantity={changeQuantity} onRemove={removeFromCart} onPlaceOrder={placeOrder} onBack={() => navigate(selectedStore ? 'customer-menu' : 'customer-home')} busy={placingOrder || groupBusy} deliveryFee={deliveryFee} studentDiscountPercent={studentDiscountPercent} groupOrder={groupOrder} isGroupHost={Number(groupOrder?.host_customer_id) === Number(user.id)} onCreateGroupOrder={createGroupOrder} onJoinGroupOrder={joinGroupOrder} onAddCartToGroup={addCartToGroupOrder} onPlaceGroupOrder={placeGroupOrder} onRefreshGroupOrder={refreshGroupOrder} onLeaveOrCancelGroup={leaveOrCancelGroupOrder} />}
                        {isCustomer && page === 'customer-favorites' && <div className="page-stack">
                            <div className="dashboard-section-heading"><div><span className="eyebrow">SAVED FOR LATER</span><h1>Favorite meals</h1><p>Favorites are saved on this device while product information comes from SQLite.</p></div></div>
                            {products.filter((product) => favorites.includes(product.id)).length ? (
                                <div className="product-grid role-product-grid">
                                    {products.filter((product) => favorites.includes(product.id)).map((product) => (
                                        <article className="product-card role-product-card" key={product.id}>
                                            <MediaImage className="product-image" src={product.image_url} alt={product.name} fallbackSrc="/images/hero-food.png" />
                                            <div className="product-details">
                                                <span className="product-category">{product.store_name}</span>
                                                <h3>{product.name}</h3><p>{product.description}</p>
                                                <div className="product-bottom">
                                                    <strong>{money(product.price)}</strong>
                                                    <button className="secondary-button small-button" onClick={() => openStore(stores.find((store) => store.id === product.store_id))}>Open store</button>
                                                </div>
                                                <button className="favorite-remove-link" onClick={() => toggleFavorite(product.id)}>Remove from favorites</button>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            ) : (
                                <div className="dashboard-empty"><Heart size={28} /><h3>No favorites yet</h3><p>Open a store menu and save your favorite products from there.</p><button className="primary-button" onClick={() => navigate('customer-home')}>Browse stores</button></div>
                            )}
                        </div>}
                        {isCustomer && page === 'customer-profile' && <CustomerProfilePage user={user} address={address} onAddress={updateCheckoutAddress} addresses={savedAddresses} onRefreshAddresses={refreshSavedAddresses} onUseAddress={(saved) => { selectSavedAddress(saved.id); notify(`${saved.address_label} selected for checkout.`); }} onSave={saveProfile} onVerify={() => navigate('verify-account')} orders={orders} favorites={favorites} />}
                        {!isCustomer && page === 'account-profile' && <AccountProfilePage user={user} onSave={saveProfile} onVerify={() => navigate('verify-account')} />}
                        {page === 'verify-account' && <VerificationPage user={user} onVerified={refreshAuthenticatedUser} onBack={() => navigate(getHomePage(user.role))} />}
                        {page === 'support' && <SupportPage user={user} onBack={() => navigate(getHomePage(user.role))} />}
                        {isManager && page.startsWith('manager-') && <ManagerDashboard key={user.id} user={user} page={page} onToast={notify} />}
                        {isAdmin && page.startsWith('admin-') && <AdminDashboard key={user.id} page={page} onToast={notify} />}
                        {isRider && page === 'rider-dashboard' && <RiderDashboard onToast={notify} />}
                    </div>
                    {isCustomer && loadingCustomerData && <div className="inline-sync-indicator">Syncing order and store data…</div>}
                </main>
            </div>
            <nav className="mobile-bottom-nav">
                {activeNavigation.map(({ page: navPage, label, icon: Icon }) => (
                    <button key={navPage} className={page === navPage || (navPage === 'customer-home' && page === 'customer-menu') ? 'active' : ''} onClick={() => navigate(navPage)}>
                        <Icon size={20} /><span>{label}</span>
                    </button>
                ))}
                {isCustomer && <button className={page === 'customer-cart' ? 'active' : ''} onClick={() => navigate('customer-cart')}><ShoppingCart size={20} /><span>Cart</span>{cartCount > 0 && <b>{cartCount}</b>}</button>}
            </nav>
            {toast && <div className="toast-message" role="status">{toast}</div>}
        </div>
    );
}

export default App;