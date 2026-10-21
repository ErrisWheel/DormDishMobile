import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import { db, getOrderDetails, getProduct, getStoreRatingSummary, initializeDatabase } from './database.js';
import { allowRoles, createToken, requireAuth } from './auth.js';

initializeDatabase();

const app = express();
const port = Number(process.env.PORT || 4000);
const orderStatuses = ['Pending', 'Confirmed', 'Preparing', 'Ready for Pickup', 'Out for Delivery', 'Delivered', 'Cancelled'];
const nextStatuses = {
    Pending: ['Confirmed', 'Cancelled'],
    Confirmed: ['Preparing', 'Cancelled'],
    Preparing: ['Ready for Pickup', 'Cancelled'],
    'Ready for Pickup': ['Out for Delivery', 'Cancelled'],
    'Out for Delivery': ['Delivered', 'Cancelled'],
    Delivered: [],
    Cancelled: []
};

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '1mb' }));

function cleanUser(user) {
    if (!user) {
        return user;
    }

    const { password_hash, ...safeUser } = user;
    return safeUser;
}

function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function userStoreId(user) {
    return Number(user.store_id);
}

function getStoreById(id) {
    return db.prepare('SELECT * FROM stores WHERE id = ?').get(Number(id));
}

function requireStoreManagerOfOrder(req, res, order) {
    if (req.user.role === 'store_manager' && order.store_id === userStoreId(req.user)) {
        return true;
    }

    res.status(403).json({ error: 'You can only manage orders from your assigned store.' });
    return false;
}

function canViewOrder(user, order) {
    if (user.role === 'customer') {
        return order.customer_id === user.id;
    }

    if (user.role === 'store_manager') {
        return order.store_id === userStoreId(user);
    }

    if (user.role === 'rider') {
        return order.rider_id === user.id && order.store_id === userStoreId(user);
    }

    return false;
}

function parseProductPayload(body, partial = false) {
    const values = {};
    const allowed = ['name', 'description', 'category', 'price', 'oldPrice', 'imageUrl', 'stock', 'isAvailable'];

    for (const field of allowed) {
        if (partial && !Object.hasOwn(body, field)) {
            continue;
        }

        values[field] = body[field];
    }

    if (!partial || Object.hasOwn(body, 'name')) {
        if (typeof values.name !== 'string' || !values.name.trim()) {
            throw new Error('Product name is required.');
        }
        values.name = values.name.trim();
    }

    for (const field of ['description', 'category', 'imageUrl']) {
        if (!partial || Object.hasOwn(body, field)) {
            values[field] = typeof values[field] === 'string' ? values[field].trim() : '';
        }
    }

    if (!partial || Object.hasOwn(body, 'price')) {
        values.price = Number(values.price);
        if (!Number.isFinite(values.price) || values.price < 0) {
            throw new Error('Enter a valid product price.');
        }
    }

    if (!partial || Object.hasOwn(body, 'oldPrice')) {
        values.oldPrice = values.oldPrice === '' || values.oldPrice === null || values.oldPrice === undefined
            ? null
            : Number(values.oldPrice);
        if (values.oldPrice !== null && (!Number.isFinite(values.oldPrice) || values.oldPrice < 0)) {
            throw new Error('Enter a valid old price.');
        }
    }

    if (!partial || Object.hasOwn(body, 'stock')) {
        values.stock = Number(values.stock);
        if (!Number.isInteger(values.stock) || values.stock < 0) {
            throw new Error('Stock must be a whole number greater than or equal to zero.');
        }
    }

    if (!partial || Object.hasOwn(body, 'isAvailable')) {
        values.isAvailable = values.isAvailable === undefined ? true : Boolean(values.isAvailable);
    }

    return values;
}

function logTracking(orderId, updatedBy, status, note, locationLabel, etaAt) {
    db.prepare(`
        INSERT INTO tracking_updates (order_id, updated_by, status, note, location_label, eta_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(orderId, updatedBy, status, note, locationLabel || '', etaAt || null, new Date().toISOString());
}

app.get('/api/health', (req, res) => {
    res.json({ ok: true, database: 'sqlite', timestamp: new Date().toISOString() });
});

app.post('/api/auth/login', (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!email || !password) {
        return res.status(400).json({ error: 'Enter your email and password.' });
    }

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user || !user.is_active || !bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ error: 'Email or password is incorrect.' });
    }

    res.json({ token: createToken(user), user: cleanUser(user) });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
});

app.patch('/api/auth/profile', requireAuth, allowRoles('customer'), (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';

    if (name.length < 2 || name.length > 100) {
        return res.status(400).json({ error: 'Name must contain between 2 and 100 characters.' });
    }

    db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, req.user.id);
    const user = db.prepare('SELECT id, name, email, role, store_id, is_active, created_at FROM users WHERE id = ?').get(req.user.id);
    res.json({ user });
});

app.get('/api/settings/public', (req, res) => {
    const rows = db.prepare("SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('delivery_fee', 'default_eta_minutes', 'campus_location')").all();
    res.json({ settings: Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value])) });
});

app.get('/api/stores', (req, res) => {
    const stores = db.prepare(`
        SELECT s.id, s.name, s.description, s.image_url, s.location_name, s.maps_url, s.is_active,
               ROUND(AVG(r.score), 1) AS rating, COUNT(DISTINCT r.id) AS rating_count,
               COUNT(DISTINCT CASE WHEN p.is_available = 1 AND p.stock > 0 THEN p.id END) AS product_count
        FROM stores s
        LEFT JOIN ratings r ON r.store_id = s.id AND r.is_visible = 1
        LEFT JOIN products p ON p.store_id = s.id
        WHERE s.is_active = 1
        GROUP BY s.id
        ORDER BY COALESCE(AVG(r.score), 0) DESC, s.name COLLATE NOCASE ASC
    `).all();
    res.json({ stores });
});

app.get('/api/stores/:id/products', (req, res) => {
    const store = getStoreById(req.params.id);

    if (!store || !store.is_active) {
        return res.status(404).json({ error: 'Store not found.' });
    }

    const products = db.prepare(`
        SELECT p.*, s.name AS store_name
        FROM products p JOIN stores s ON s.id = p.store_id
        WHERE p.store_id = ? AND p.is_available = 1 AND s.is_active = 1
        ORDER BY p.name COLLATE NOCASE
    `).all(store.id);

    res.json({ store, products });
});

app.get('/api/products', (req, res) => {
    const storeId = req.query.storeId ? Number(req.query.storeId) : null;
    const where = storeId
        ? 'WHERE p.store_id = ? AND s.is_active = 1'
        : 'WHERE s.is_active = 1';
    const products = db.prepare(`
        SELECT p.*, s.name AS store_name
        FROM products p JOIN stores s ON s.id = p.store_id
        ${where}
        ORDER BY p.store_id, p.name COLLATE NOCASE
    `).all(...(storeId ? [storeId] : []));

    res.json({ products });
});

app.post('/api/products', requireAuth, allowRoles('store_manager'), (req, res) => {
    let values;

    try {
        values = parseProductPayload(req.body);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    const result = db.prepare(`
        INSERT INTO products (store_id, name, description, category, price, old_price, image_url, stock, is_available, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        userStoreId(req.user), values.name, values.description, values.category || 'Meals',
        values.price, values.oldPrice, values.imageUrl || '/images/hero-food.png', values.stock,
        values.isAvailable ? 1 : 0, new Date().toISOString()
    );

    res.status(201).json({ product: getProduct(result.lastInsertRowid) });
});

app.put('/api/products/:id', requireAuth, allowRoles('store_manager'), (req, res) => {
    const product = getProduct(req.params.id);

    if (!product) {
        return res.status(404).json({ error: 'Product not found.' });
    }

    if (product.store_id !== userStoreId(req.user)) {
        return res.status(403).json({ error: 'You can only manage products from your assigned store.' });
    }

    let values;

    try {
        values = parseProductPayload(req.body);
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }

    db.prepare(`
        UPDATE products
        SET name = ?, description = ?, category = ?, price = ?, old_price = ?, image_url = ?, stock = ?, is_available = ?
        WHERE id = ?
    `).run(values.name, values.description, values.category || 'Meals', values.price, values.oldPrice, values.imageUrl || '/images/hero-food.png', values.stock, values.isAvailable ? 1 : 0, product.id);

    res.json({ product: getProduct(product.id) });
});

app.delete('/api/products/:id', requireAuth, allowRoles('store_manager'), (req, res) => {
    const product = getProduct(req.params.id);

    if (!product) {
        return res.status(404).json({ error: 'Product not found.' });
    }

    if (product.store_id !== userStoreId(req.user)) {
        return res.status(403).json({ error: 'You can only remove products from your assigned store.' });
    }

    db.prepare('DELETE FROM products WHERE id = ?').run(product.id);
    res.json({ success: true });
});

app.get('/api/orders', requireAuth, (req, res) => {
    if (req.user.role === 'superadmin') {
        return res.status(403).json({ error: 'Super Admin does not have order-management access.' });
    }

    let query;
    let parameters = [];

    if (req.user.role === 'customer') {
        query = 'SELECT id FROM orders WHERE customer_id = ? ORDER BY created_at DESC';
        parameters = [req.user.id];
    } else if (req.user.role === 'store_manager') {
        query = 'SELECT id FROM orders WHERE store_id = ? ORDER BY created_at DESC';
        parameters = [userStoreId(req.user)];
    } else {
        query = 'SELECT id FROM orders WHERE rider_id = ? AND store_id = ? ORDER BY created_at DESC';
        parameters = [req.user.id, userStoreId(req.user)];
    }

    const orders = db.prepare(query).all(...parameters).map(({ id }) => getOrderDetails(id));
    res.json({ orders });
});

app.post('/api/orders', requireAuth, allowRoles('customer'), (req, res) => {
    const { storeId, items, deliveryAddress, paymentMethod } = req.body;
    const numericStoreId = Number(storeId);
    const store = getStoreById(numericStoreId);

    if (!store || !store.is_active) {
        return res.status(400).json({ error: 'Choose an available store.' });
    }

    if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Add at least one item before placing an order.' });
    }

    if (typeof deliveryAddress !== 'string' || deliveryAddress.trim().length < 3) {
        return res.status(400).json({ error: 'Enter a delivery location.' });
    }

    const groupedItems = new Map();

    for (const item of items) {
        const productId = Number(item.productId);
        const quantity = Number(item.quantity);

        if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
            return res.status(400).json({ error: 'Each item must have a valid product and quantity.' });
        }

        groupedItems.set(productId, (groupedItems.get(productId) || 0) + quantity);
    }

    const deliveryFee = Number(db.prepare("SELECT setting_value FROM app_settings WHERE setting_key = 'delivery_fee'").get()?.setting_value || 20);
    const createOrder = db.transaction(() => {
        const selectedProducts = [];
        let subtotal = 0;

        for (const [productId, quantity] of groupedItems) {
            const product = getProduct(productId);

            if (!product || product.store_id !== numericStoreId || !product.store_active || !product.is_available) {
                throw new Error('Your cart contains an unavailable item or an item from a different store.');
            }

            if (product.stock < quantity) {
                throw new Error(`${product.name} does not have enough stock for this quantity.`);
            }

            subtotal += product.price * quantity;
            selectedProducts.push({ product, quantity });
        }

        const rider = db.prepare("SELECT id FROM users WHERE role = 'rider' AND store_id = ? AND is_active = 1 ORDER BY id LIMIT 1").get(numericStoreId);
        const orderId = `DD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
        const now = new Date().toISOString();

        db.prepare(`
            INSERT INTO orders (id, customer_id, store_id, rider_id, status, subtotal, delivery_fee, total, payment_method, delivery_address, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?)
        `).run(orderId, req.user.id, numericStoreId, rider?.id || null, subtotal, deliveryFee, subtotal + deliveryFee, typeof paymentMethod === 'string' && paymentMethod.trim() ? paymentMethod.trim() : 'Cash on delivery', deliveryAddress.trim(), now, now);

        const insertItem = db.prepare(`
            INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        const decrementStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');

        for (const { product, quantity } of selectedProducts) {
            insertItem.run(orderId, product.id, product.name, product.price, quantity, product.price * quantity);
            const changed = decrementStock.run(quantity, product.id, quantity).changes;

            if (changed !== 1) {
                throw new Error(`${product.name} has just run out of stock. Refresh and try again.`);
            }
        }

        logTracking(orderId, req.user.id, 'Pending', 'Order placed. Waiting for store confirmation.', store.location_name, null);
        return orderId;
    });

    try {
        const orderId = createOrder();
        res.status(201).json({ order: getOrderDetails(orderId) });
    } catch (error) {
        res.status(400).json({ error: error.message || 'The order could not be placed.' });
    }
});

app.get('/api/orders/:id', requireAuth, (req, res) => {
    if (req.user.role === 'superadmin') {
        return res.status(403).json({ error: 'Super Admin does not have order-management access.' });
    }

    const order = getOrderDetails(req.params.id);

    if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
    }

    if (!canViewOrder(req.user, order)) {
        return res.status(403).json({ error: 'You do not have access to this order.' });
    }

    res.json({ order });
});

app.patch('/api/orders/:id/progress', requireAuth, allowRoles('store_manager', 'rider'), (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);

    if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
    }

    if (req.user.role === 'store_manager' && !requireStoreManagerOfOrder(req, res, order)) {
        return;
    }

    if (req.user.role === 'rider' && (order.rider_id !== req.user.id || order.store_id !== userStoreId(req.user))) {
        return res.status(403).json({ error: 'You can only update deliveries assigned to you at your store.' });
    }

    const { status, note, locationLabel } = req.body;
    const etaWasIncluded = Object.hasOwn(req.body, 'etaMinutes');
    const etaMinutes = etaWasIncluded && req.body.etaMinutes !== null && req.body.etaMinutes !== ''
        ? Number(req.body.etaMinutes)
        : null;

    if (!orderStatuses.includes(status)) {
        return res.status(400).json({ error: 'Choose a valid order status.' });
    }

    if (req.user.role === 'rider' && !(order.status === 'Out for Delivery' && ['Out for Delivery', 'Delivered'].includes(status))) {
        return res.status(403).json({ error: 'Riders can update only their active delivery.' });
    }

    if (req.user.role === 'store_manager' && !nextStatuses[order.status].includes(status) && order.status !== status) {
        return res.status(400).json({ error: `Status cannot move from ${order.status} to ${status}.` });
    }

    if (req.user.role === 'rider' && order.status === status && status !== 'Out for Delivery') {
        return res.status(400).json({ error: 'Choose a new delivery status.' });
    }

    if (etaMinutes !== null && (!Number.isInteger(etaMinutes) || etaMinutes < 0 || etaMinutes > 240)) {
        return res.status(400).json({ error: 'ETA must be between 0 and 240 minutes.' });
    }

    if (status !== order.status && order.status === 'Cancelled') {
        return res.status(400).json({ error: 'Cancelled orders cannot be changed.' });
    }

    const update = db.transaction(() => {
        let etaAt = etaWasIncluded
            ? (etaMinutes === null ? null : new Date(Date.now() + etaMinutes * 60000).toISOString())
            : order.eta_at;
        let storedEtaMinutes = etaWasIncluded ? etaMinutes : order.eta_minutes;

        if (status === 'Delivered') {
            etaAt = null;
            storedEtaMinutes = 0;
        }

        const now = new Date().toISOString();
        db.prepare('UPDATE orders SET status = ?, eta_minutes = ?, eta_at = ?, updated_at = ? WHERE id = ?')
            .run(status, storedEtaMinutes, etaAt, now, order.id);

        if (status === 'Cancelled' && order.status !== 'Cancelled') {
            const items = db.prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?').all(order.id);
            const restoreStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');

            for (const item of items) {
                if (item.product_id !== null) {
                    restoreStock.run(item.quantity, item.product_id);
                }
            }
        }

        const defaultNotes = {
            Confirmed: 'The store confirmed your order.',
            Preparing: 'The store is preparing your order.',
            'Ready for Pickup': 'Your order is ready for the rider.',
            'Out for Delivery': 'Your order is on the way.',
            Delivered: 'Your delivery has been marked complete.',
            Cancelled: 'The order was cancelled.'
        };
        logTracking(order.id, req.user.id, status, typeof note === 'string' && note.trim() ? note.trim() : defaultNotes[status] || 'Order progress updated.', typeof locationLabel === 'string' ? locationLabel.trim() : '', etaAt);
    });

    try {
        update();
        res.json({ order: getOrderDetails(order.id) });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Could not update order progress.' });
    }
});

app.patch('/api/orders/:id/assign-rider', requireAuth, allowRoles('store_manager'), (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);

    if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
    }

    if (!requireStoreManagerOfOrder(req, res, order)) {
        return;
    }

    const riderId = req.body.riderId === null || req.body.riderId === '' ? null : Number(req.body.riderId);
    let rider = null;

    if (riderId !== null) {
        rider = db.prepare("SELECT id, name, store_id FROM users WHERE id = ? AND role = 'rider' AND is_active = 1").get(riderId);

        if (!rider || rider.store_id !== order.store_id) {
            return res.status(400).json({ error: 'Choose an active rider assigned to your store.' });
        }
    }

    db.prepare('UPDATE orders SET rider_id = ?, updated_at = ? WHERE id = ?').run(riderId, new Date().toISOString(), order.id);
    logTracking(order.id, req.user.id, order.status, rider ? `Assigned to ${rider.name}.` : 'Rider assignment removed.', '', order.eta_at);
    res.json({ order: getOrderDetails(order.id) });
});

app.post('/api/orders/:id/ratings', requireAuth, allowRoles('customer'), (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?').get(req.params.id, req.user.id);

    if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
    }

    if (order.status !== 'Delivered') {
        return res.status(400).json({ error: 'You can rate the store after the order is delivered.' });
    }

    const score = Number(req.body.score);
    const review = typeof req.body.review === 'string' ? req.body.review.trim().slice(0, 1000) : '';

    if (!Number.isInteger(score) || score < 1 || score > 5) {
        return res.status(400).json({ error: 'Choose a rating from 1 to 5.' });
    }

    const existing = db.prepare('SELECT id FROM ratings WHERE order_id = ? AND customer_id = ?').get(order.id, req.user.id);

    if (existing) {
        db.prepare('UPDATE ratings SET score = ?, review = ?, created_at = ? WHERE id = ?').run(score, review, new Date().toISOString(), existing.id);
        return res.json({ success: true });
    }

    db.prepare(`
        INSERT INTO ratings (store_id, customer_id, order_id, reviewer_name, score, review, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(order.store_id, req.user.id, order.id, req.user.name, score, review, new Date().toISOString());

    res.status(201).json({ success: true });
});

app.get('/api/manager/riders', requireAuth, allowRoles('store_manager'), (req, res) => {
    const riders = db.prepare("SELECT id, name, email, store_id FROM users WHERE role = 'rider' AND store_id = ? AND is_active = 1 ORDER BY name").all(userStoreId(req.user));
    res.json({ riders });
});

app.get('/api/manager/ratings', requireAuth, allowRoles('store_manager'), (req, res) => {
    const ratings = db.prepare(`
        SELECT id, reviewer_name, score, review, created_at
        FROM ratings
        WHERE store_id = ? AND is_visible = 1
        ORDER BY created_at DESC, id DESC
    `).all(userStoreId(req.user));
    res.json({ ratings, summary: getStoreRatingSummary(userStoreId(req.user)) });
});

app.get('/api/admin/users', requireAuth, allowRoles('superadmin'), (req, res) => {
    const users = db.prepare(`
        SELECT id, name, email, role, store_id, is_active, created_at
        FROM users
        ORDER BY CASE role WHEN 'superadmin' THEN 0 WHEN 'store_manager' THEN 1 WHEN 'rider' THEN 2 ELSE 3 END, name
    `).all();
    res.json({ users });
});

app.post('/api/admin/users', requireAuth, allowRoles('superadmin'), (req, res) => {
    const { name, email, password, role, storeId } = req.body;
    const cleanName = typeof name === 'string' ? name.trim() : '';
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const store_id = storeId === null || storeId === '' || storeId === undefined ? null : Number(storeId);

    if (!cleanName || !isValidEmail(cleanEmail) || typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: 'Enter a name, valid email, and password with at least 8 characters.' });
    }

    if (!['superadmin', 'store_manager', 'customer', 'rider'].includes(role)) {
        return res.status(400).json({ error: 'Choose a valid role.' });
    }

    if (['store_manager', 'rider'].includes(role) && (!store_id || !getStoreById(store_id))) {
        return res.status(400).json({ error: 'Store managers and riders must be assigned to an existing store.' });
    }

    try {
        const result = db.prepare(`
            INSERT INTO users (name, email, password_hash, role, store_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(cleanName, cleanEmail, bcrypt.hashSync(password, 10), role, role === 'store_manager' || role === 'rider' ? store_id : null, new Date().toISOString());
        const user = db.prepare('SELECT id, name, email, role, store_id, is_active, created_at FROM users WHERE id = ?').get(result.lastInsertRowid);
        res.status(201).json({ user });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'That email address is already registered.' });
        }
        throw error;
    }
});

app.patch('/api/admin/users/:id', requireAuth, allowRoles('superadmin'), (req, res) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(req.params.id));

    if (!user) {
        return res.status(404).json({ error: 'Account not found.' });
    }

    const name = Object.hasOwn(req.body, 'name') ? String(req.body.name).trim() : user.name;
    const email = Object.hasOwn(req.body, 'email') ? String(req.body.email).trim().toLowerCase() : user.email;
    const role = Object.hasOwn(req.body, 'role') ? req.body.role : user.role;
    const isActive = Object.hasOwn(req.body, 'isActive') ? Boolean(req.body.isActive) : Boolean(user.is_active);
    const storeIdInput = Object.hasOwn(req.body, 'storeId') ? req.body.storeId : user.store_id;
    const storeId = storeIdInput === null || storeIdInput === '' || storeIdInput === undefined ? null : Number(storeIdInput);

    if (!name || !isValidEmail(email) || !['superadmin', 'store_manager', 'customer', 'rider'].includes(role)) {
        return res.status(400).json({ error: 'Enter a valid name, email, and role.' });
    }

    if (['store_manager', 'rider'].includes(role) && (!storeId || !getStoreById(storeId))) {
        return res.status(400).json({ error: 'Store managers and riders must be assigned to a store.' });
    }

    if (user.role === 'superadmin' && (role !== 'superadmin' || !isActive)) {
        const count = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'superadmin' AND is_active = 1").get().count;
        if (count <= 1) {
            return res.status(400).json({ error: 'At least one active Super Admin must remain.' });
        }
    }

    try {
        const updateUser = db.transaction(() => {
            if (role === 'store_manager' && storeId !== null) {
                db.prepare("UPDATE users SET store_id = NULL WHERE role = 'store_manager' AND store_id = ? AND id != ?").run(storeId, user.id);
            }

            db.prepare('UPDATE users SET name = ?, email = ?, role = ?, store_id = ?, is_active = ? WHERE id = ?')
                .run(name, email, role, role === 'store_manager' || role === 'rider' ? storeId : null, isActive ? 1 : 0, user.id);
        });
        updateUser();
        const updated = db.prepare('SELECT id, name, email, role, store_id, is_active, created_at FROM users WHERE id = ?').get(user.id);
        res.json({ user: updated });
    } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
            return res.status(409).json({ error: 'That email address is already registered.' });
        }
        throw error;
    }
});

app.get('/api/admin/stores', requireAuth, allowRoles('superadmin'), (req, res) => {
    const stores = db.prepare(`
        SELECT s.*, m.id AS manager_id, m.name AS manager_name, m.email AS manager_email,
               ROUND((SELECT AVG(score) FROM ratings r WHERE r.store_id = s.id AND r.is_visible = 1), 1) AS rating,
               (SELECT COUNT(*) FROM ratings r WHERE r.store_id = s.id AND r.is_visible = 1) AS rating_count
        FROM stores s
        LEFT JOIN users m ON m.store_id = s.id AND m.role = 'store_manager'
        ORDER BY s.id
    `).all();
    res.json({ stores });
});

app.post('/api/admin/stores', requireAuth, allowRoles('superadmin'), (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const description = typeof req.body.description === 'string' ? req.body.description.trim() : '';
    const locationName = typeof req.body.locationName === 'string' ? req.body.locationName.trim() : '';
    const mapsUrl = typeof req.body.mapsUrl === 'string' ? req.body.mapsUrl.trim() : '';
    const imageUrl = typeof req.body.imageUrl === 'string' ? req.body.imageUrl.trim() : '/images/hero-food.png';

    if (!name) {
        return res.status(400).json({ error: 'Store name is required.' });
    }

    const result = db.prepare(`
        INSERT INTO stores (name, description, image_url, location_name, maps_url, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(name, description, imageUrl, locationName, mapsUrl, new Date().toISOString());

    res.status(201).json({ store: getStoreById(result.lastInsertRowid) });
});

app.patch('/api/admin/stores/:id', requireAuth, allowRoles('superadmin'), (req, res) => {
    const store = getStoreById(req.params.id);

    if (!store) {
        return res.status(404).json({ error: 'Store not found.' });
    }

    const name = Object.hasOwn(req.body, 'name') ? String(req.body.name).trim() : store.name;
    const description = Object.hasOwn(req.body, 'description') ? String(req.body.description).trim() : store.description;
    const imageUrl = Object.hasOwn(req.body, 'imageUrl') ? String(req.body.imageUrl).trim() : store.image_url;
    const locationName = Object.hasOwn(req.body, 'locationName') ? String(req.body.locationName).trim() : store.location_name;
    const mapsUrl = Object.hasOwn(req.body, 'mapsUrl') ? String(req.body.mapsUrl).trim() : store.maps_url;
    const isActive = Object.hasOwn(req.body, 'isActive') ? Boolean(req.body.isActive) : Boolean(store.is_active);

    if (!name) {
        return res.status(400).json({ error: 'Store name is required.' });
    }

    db.prepare('UPDATE stores SET name = ?, description = ?, image_url = ?, location_name = ?, maps_url = ?, is_active = ? WHERE id = ?')
        .run(name, description, imageUrl, locationName, mapsUrl, isActive ? 1 : 0, store.id);

    res.json({ store: getStoreById(store.id) });
});

app.patch('/api/admin/stores/:id/manager', requireAuth, allowRoles('superadmin'), (req, res) => {
    const store = getStoreById(req.params.id);

    if (!store) {
        return res.status(404).json({ error: 'Store not found.' });
    }

    const managerId = req.body.managerId === null || req.body.managerId === '' ? null : Number(req.body.managerId);
    let manager = null;

    if (managerId !== null) {
        manager = db.prepare("SELECT * FROM users WHERE id = ? AND role = 'store_manager' AND is_active = 1").get(managerId);

        if (!manager) {
            return res.status(400).json({ error: 'Choose an active Store Manager account.' });
        }
    }

    const assignManager = db.transaction(() => {
        if (manager) {
            db.prepare("UPDATE users SET store_id = NULL WHERE role = 'store_manager' AND store_id = ? AND id != ?").run(store.id, manager.id);
            db.prepare("UPDATE users SET store_id = NULL WHERE role = 'store_manager' AND id = ? AND store_id IS NOT NULL").run(manager.id);
            db.prepare('UPDATE users SET store_id = ? WHERE id = ?').run(store.id, manager.id);
        } else {
            db.prepare("UPDATE users SET store_id = NULL WHERE role = 'store_manager' AND store_id = ?").run(store.id);
        }
    });

    assignManager();
    res.json({ success: true });
});

app.delete('/api/admin/stores/:id', requireAuth, allowRoles('superadmin'), (req, res) => {
    const store = getStoreById(req.params.id);

    if (!store) {
        return res.status(404).json({ error: 'Store not found.' });
    }

    const historicOrders = db.prepare('SELECT COUNT(*) AS count FROM orders WHERE store_id = ?').get(store.id).count;

    if (historicOrders > 0) {
        db.prepare('UPDATE stores SET is_active = 0 WHERE id = ?').run(store.id);
        return res.json({ success: true, archived: true });
    }

    db.prepare('DELETE FROM stores WHERE id = ?').run(store.id);
    res.json({ success: true, archived: false });
});

app.get('/api/admin/settings', requireAuth, allowRoles('superadmin'), (req, res) => {
    const settings = Object.fromEntries(db.prepare('SELECT setting_key, setting_value FROM app_settings ORDER BY setting_key').all().map((item) => [item.setting_key, item.setting_value]));
    res.json({ settings });
});

app.patch('/api/admin/settings', requireAuth, allowRoles('superadmin'), (req, res) => {
    const allowed = new Set(['app_name', 'delivery_fee', 'default_eta_minutes', 'campus_location']);
    const now = new Date().toISOString();

    for (const [key, value] of Object.entries(req.body)) {
        if (!allowed.has(key) || value === null || value === undefined) {
            continue;
        }

        if (key === 'delivery_fee' && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
            return res.status(400).json({ error: 'Delivery fee must be a non-negative number.' });
        }

        if (key === 'default_eta_minutes' && (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 240)) {
            return res.status(400).json({ error: 'Default ETA must be between 0 and 240 minutes.' });
        }

        db.prepare('INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES (?, ?, ?) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at')
            .run(key, String(value), now);
    }

    res.json({ success: true });
});

app.get('/api/admin/ratings', requireAuth, allowRoles('superadmin'), (req, res) => {
    const ratings = db.prepare(`
        SELECT r.*, s.name AS store_name
        FROM ratings r JOIN stores s ON s.id = r.store_id
        ORDER BY r.created_at DESC, r.id DESC
    `).all();
    res.json({ ratings });
});

app.patch('/api/admin/ratings/:id', requireAuth, allowRoles('superadmin'), (req, res) => {
    const rating = db.prepare('SELECT * FROM ratings WHERE id = ?').get(Number(req.params.id));

    if (!rating) {
        return res.status(404).json({ error: 'Rating not found.' });
    }

    const visible = Object.hasOwn(req.body, 'isVisible') ? Boolean(req.body.isVisible) : Boolean(rating.is_visible);
    db.prepare('UPDATE ratings SET is_visible = ? WHERE id = ?').run(visible ? 1 : 0, rating.id);
    res.json({ success: true });
});

app.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    if (error.code?.startsWith('SQLITE_CONSTRAINT')) {
        return res.status(400).json({ error: 'That change conflicts with existing data.' });
    }

    console.error(error);
    res.status(500).json({ error: 'Unexpected server error. Check the API terminal for details.' });
});

app.listen(port, '0.0.0.0', () => {
    process.stdout.write(`DormDish API running at http://localhost:${port}/api\n`);
    process.stdout.write(`SQLite database: ${process.env.DORMDISH_DB_PATH || 'server/data/dormdish.sqlite'}\n`);
});
