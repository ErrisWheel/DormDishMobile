import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.join(currentDirectory, 'data');
const databasePath = process.env.DORMDISH_DB_PATH || path.join(dataDirectory, 'dormdish.sqlite');

fs.mkdirSync(path.dirname(databasePath), { recursive: true });

export const db = new Database(databasePath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

export function initializeDatabase() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS stores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            image_url TEXT NOT NULL DEFAULT '',
            location_name TEXT NOT NULL DEFAULT '',
            maps_url TEXT NOT NULL DEFAULT '',
            is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK (role IN ('superadmin', 'store_manager', 'customer', 'rider')),
            store_id INTEGER REFERENCES stores(id) ON DELETE SET NULL,
            is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
            is_online INTEGER NOT NULL DEFAULT 0 CHECK (is_online IN (0, 1)),
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT 'Meals',
            price REAL NOT NULL CHECK (price >= 0),
            old_price REAL CHECK (old_price IS NULL OR old_price >= 0),
            promo_price REAL CHECK (promo_price IS NULL OR promo_price >= 0),
            promo_label TEXT NOT NULL DEFAULT '',
            promo_starts_at TEXT,
            promo_ends_at TEXT,
            is_promoted INTEGER NOT NULL DEFAULT 0 CHECK (is_promoted IN (0, 1)),
            image_url TEXT NOT NULL DEFAULT '/images/hero-food.png',
            stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
            is_available INTEGER NOT NULL DEFAULT 1 CHECK (is_available IN (0, 1)),
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS product_images (
            id TEXT PRIMARY KEY,
            mime_type TEXT NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
            file_name TEXT NOT NULL DEFAULT 'product-image',
            image_data BLOB NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            customer_id INTEGER NOT NULL REFERENCES users(id),
            store_id INTEGER NOT NULL REFERENCES stores(id),
            rider_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            status TEXT NOT NULL CHECK (status IN ('Pending', 'Confirmed', 'Preparing', 'Ready for Pickup', 'Out for Delivery', 'Delivered', 'Cancelled')),
            subtotal REAL NOT NULL CHECK (subtotal >= 0),
            delivery_fee REAL NOT NULL CHECK (delivery_fee >= 0),
            total REAL NOT NULL CHECK (total >= 0),
            discount_total REAL NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
            student_discount REAL NOT NULL DEFAULT 0 CHECK (student_discount >= 0),
            group_discount REAL NOT NULL DEFAULT 0 CHECK (group_discount >= 0),
            group_order_id TEXT,
            payment_method TEXT NOT NULL DEFAULT 'Cash on delivery',
            delivery_address TEXT NOT NULL,
            order_notes TEXT NOT NULL DEFAULT '',
            eta_minutes INTEGER CHECK (eta_minutes IS NULL OR eta_minutes BETWEEN 0 AND 240),
            eta_at TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
            product_name TEXT NOT NULL,
            unit_price REAL NOT NULL CHECK (unit_price >= 0),
            quantity INTEGER NOT NULL CHECK (quantity > 0),
            line_total REAL NOT NULL CHECK (line_total >= 0),
            ordered_by_customer_id INTEGER REFERENCES users(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS tracking_updates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            status TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            location_label TEXT NOT NULL DEFAULT '',
            eta_at TEXT,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ratings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
            customer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
            reviewer_name TEXT NOT NULL,
            score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
            review TEXT NOT NULL DEFAULT '',
            is_visible INTEGER NOT NULL DEFAULT 1 CHECK (is_visible IN (0, 1)),
            created_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_ratings_order_customer
            ON ratings(order_id, customer_id)
            WHERE order_id IS NOT NULL AND customer_id IS NOT NULL;

        CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
        CREATE INDEX IF NOT EXISTS idx_orders_customer ON orders(customer_id);
        CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id);
        CREATE INDEX IF NOT EXISTS idx_tracking_order ON tracking_updates(order_id, created_at);

        CREATE TABLE IF NOT EXISTS app_settings (
            setting_key TEXT PRIMARY KEY,
            setting_value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS group_orders (
            id TEXT PRIMARY KEY,
            join_code TEXT NOT NULL UNIQUE,
            host_customer_id INTEGER NOT NULL REFERENCES users(id),
            store_id INTEGER NOT NULL REFERENCES stores(id),
            delivery_address TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'OPEN'
                CHECK (status IN ('OPEN', 'CLOSED', 'CANCELLED')),
            order_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS group_order_members (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_order_id TEXT NOT NULL REFERENCES group_orders(id) ON DELETE CASCADE,
            customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            joined_at TEXT NOT NULL,
            UNIQUE (group_order_id, customer_id)
        );

        CREATE TABLE IF NOT EXISTS group_order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_order_id TEXT NOT NULL REFERENCES group_orders(id) ON DELETE CASCADE,
            customer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
            product_name TEXT NOT NULL,
            unit_price REAL NOT NULL CHECK (unit_price >= 0),
            quantity INTEGER NOT NULL CHECK (quantity > 0),
            created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_group_order_members_customer
            ON group_order_members(customer_id);

        CREATE INDEX IF NOT EXISTS idx_group_order_items_group
            ON group_order_items(group_order_id);

        CREATE TABLE IF NOT EXISTS rider_job_declines (
            rider_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            PRIMARY KEY (rider_id, order_id)
        );
    `);

    const addColumnsIfMissing = (table, definitions) => {
        const existing = new Set(
            db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name)
        );
        const added = new Set();

        for (const [name, definition] of Object.entries(definitions)) {
            if (!existing.has(name)) {
                db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
                added.add(name);
            }
        }

        return added;
    };

    const productColumnsAdded = addColumnsIfMissing('products', {
        promo_price: 'REAL',
        promo_label: "TEXT NOT NULL DEFAULT ''",
        promo_starts_at: 'TEXT',
        promo_ends_at: 'TEXT',
        is_promoted: 'INTEGER NOT NULL DEFAULT 0'
    });

    addColumnsIfMissing('users', { is_online: 'INTEGER NOT NULL DEFAULT 0' });

    addColumnsIfMissing('orders', {
        order_notes: "TEXT NOT NULL DEFAULT ''",
        discount_total: 'REAL NOT NULL DEFAULT 0',
        student_discount: 'REAL NOT NULL DEFAULT 0',
        group_discount: 'REAL NOT NULL DEFAULT 0',
        group_order_id: 'TEXT'
    });

    addColumnsIfMissing('order_items', {
        ordered_by_customer_id: 'INTEGER REFERENCES users(id) ON DELETE SET NULL'
    });

    if (productColumnsAdded.has('promo_price')) {
        db.exec(`
            UPDATE products
            SET promo_price = price,
                promo_label = 'Special offer',
                is_promoted = 1,
                price = old_price,
                old_price = NULL
            WHERE old_price IS NOT NULL AND old_price > price;
        `);
    }

    seedDatabase();

    const now = new Date().toISOString();
    const defaults = [
        ['student_discount_percent', '5'],
        ['group_discount_percent', '5'],
        ['group_discount_min_members', '3'],
        ['group_discount_min_subtotal', '300']
    ];

    const insertSetting = db.prepare(`
        INSERT OR IGNORE INTO app_settings (setting_key, setting_value, updated_at)
        VALUES (?, ?, ?)
    `);

    for (const [key, value] of defaults) {
        insertSetting.run(key, value, now);
    }
}

function seedDatabase() {
    const storeCount = db.prepare('SELECT COUNT(*) AS count FROM stores').get().count;

    if (storeCount > 0) {
        return;
    }

    const now = new Date().toISOString();

    const insertStore = db.prepare(`
        INSERT INTO stores (name, description, image_url, location_name, maps_url, created_at)
        VALUES (@name, @description, @image_url, @location_name, @maps_url, @created_at)
    `);

    const insertUser = db.prepare(`
        INSERT INTO users (name, email, password_hash, role, store_id, created_at)
        VALUES (@name, @email, @password_hash, @role, @store_id, @created_at)
    `);

    const insertProduct = db.prepare(`
        INSERT INTO products (
            store_id, name, description, category, price, old_price,
            promo_price, promo_label, is_promoted, image_url, stock,
            is_available, created_at
        )
        VALUES (
            @store_id, @name, @description, @category, @price, NULL,
            @promo_price, @promo_label, @is_promoted, @image_url,
            @stock, 1, @created_at
        )
    `);

    const insertRating = db.prepare(`
        INSERT INTO ratings (store_id, customer_id, order_id, reviewer_name, score, review, created_at)
        VALUES (@store_id, NULL, NULL, @reviewer_name, @score, @review, @created_at)
    `);

    const seed = db.transaction(() => {
        const stores = [
            {
                name: 'Store Alpha',
                description: 'Fresh student meals, rice bowls, and campus favorites.',
                image_url: '/images/hero-food.png',
                location_name: 'Store Alpha, Quezon City',
                maps_url: 'https://www.google.com/maps?cid=2385593826430662165&g_mp=CiVnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLkdldFBsYWNlEAMYASAF'
            },
            {
                name: 'Store Beta',
                description: 'Quick snacks and comforting meals between classes.',
                image_url: '/images/cheese-pizza.png',
                location_name: 'TIP Quezon City campus area',
                maps_url: 'https://www.google.com/maps/search/?api=1&query=TIP+Quezon+City'
            },
            {
                name: 'Store Gamma',
                description: 'Affordable student meals with something for every craving.',
                image_url: '/images/tapsilog.png',
                location_name: 'TIP Quezon City campus area',
                maps_url: 'https://www.google.com/maps/search/?api=1&query=TIP+Quezon+City'
            }
        ];

        const storeIds = stores.map((store) =>
            insertStore.run({ ...store, created_at: now }).lastInsertRowid
        );

        const [alphaId, betaId, gammaId] = storeIds;

        const accounts = [
            {
                name: 'System Super Admin',
                email: 'superadmin@dormdish.test',
                password: process.env.DEMO_SUPERADMIN_PASSWORD,
                role: 'superadmin',
                store_id: null
            },
            {
                name: 'Alpha Store Manager',
                email: 'manager.alpha@dormdish.test',
                password: process.env.DEMO_MANAGER_PASSWORD,
                role: 'store_manager',
                store_id: alphaId
            },
            {
                name: 'Beta Store Manager',
                email: 'manager.beta@dormdish.test',
                password: process.env.DEMO_MANAGER_PASSWORD,
                role: 'store_manager',
                store_id: betaId
            },
            {
                name: 'Gamma Store Manager',
                email: 'manager.gamma@dormdish.test',
                password: process.env.DEMO_MANAGER_PASSWORD,
                role: 'store_manager',
                store_id: gammaId
            },
            {
                name: 'Campus Customer',
                email: 'customer@dormdish.test',
                password: process.env.DEMO_CUSTOMER_PASSWORD,
                role: 'customer',
                store_id: null
            },
            {
                name: 'Store Alpha Rider',
                email: 'rider@dormdish.test',
                password: process.env.DEMO_RIDER_PASSWORD,
                role: 'rider',
                store_id: alphaId
            }
        ];

        const accountsWithoutPassword = accounts.filter(
            (account) => typeof account.password !== 'string' || account.password.length < 8
        );

        if (accountsWithoutPassword.length) {
            throw new Error(
                'Set all DEMO_*_PASSWORD values in the root .env file before the first database initialization.'
            );
        }

        const userIds = new Map();

        for (const account of accounts) {
            const result = insertUser.run({
                name: account.name,
                email: account.email,
                password_hash: bcrypt.hashSync(account.password, 10),
                role: account.role,
                store_id: account.store_id,
                created_at: now
            });

            userIds.set(account.email, Number(result.lastInsertRowid));
        }

        const sampleProducts = [
            [alphaId, 'Sizzling Sisig with Rice', 'Crispy, savory pork sisig served with steamed rice.', 'Rice Meals', 100, 120, '/images/sisig.png', 23],
            [alphaId, 'Tapsilog', 'Sweet beef tapa with garlic rice and egg.', 'Rice Meals', 90, null, '/images/tapsilog.png', 23],
            [alphaId, 'Chicken Kare-Kare', 'Comforting kare-kare inspired sauce with tender chicken.', 'Rice Meals', 120, null, '/images/karekare.png', 15],
            [alphaId, 'Beef Tapa Bowl', 'Tender beef tossed in a rich savory sauce.', 'Rice Meals', 115, null, '/images/beef-talpicao.png', 12],
            [betaId, 'Cheese Pizza', 'Golden baked pizza with melted cheese.', 'Snacks', 150, null, '/images/cheese-pizza.png', 8],
            [betaId, 'Pepperoni Pizza', 'A classic cheesy pizza with pepperoni slices.', 'Snacks', 170, null, '/images/pepperoni-pizza.png', 6],
            [betaId, 'Chicken Snack Box', 'Crispy chicken bites with a dip.', 'Snacks', 95, null, '/images/hero-food.png', 14],
            [gammaId, 'Chicken Rice Bowl', 'A filling grilled chicken bowl for busy days.', 'Rice Meals', 105, null, '/images/karekare.png', 18],
            [gammaId, 'Garlic Beef Bowl', 'Garlic beef with rice and fresh toppings.', 'Rice Meals', 125, null, '/images/beef-talpicao.png', 11],
            [gammaId, 'Campus Combo', 'A student combo with a main and side.', 'Combos', 135, null, '/images/tapsilog.png', 9]
        ];

        for (const [store_id, name, description, category, price, old_price, image_url, stock] of sampleProducts) {
            const hasLegacyDiscount =
                old_price !== null &&
                old_price !== undefined &&
                Number(old_price) > Number(price);

            insertProduct.run({
                store_id,
                name,
                description,
                category,
                price: hasLegacyDiscount ? Number(old_price) : Number(price),
                promo_price: hasLegacyDiscount ? Number(price) : null,
                promo_label: hasLegacyDiscount ? 'Campus special' : '',
                is_promoted: hasLegacyDiscount ? 1 : 0,
                image_url,
                stock,
                created_at: now
            });
        }

        const seedRatings = [
            [alphaId, 'Mika R.', 5, 'Quick service and satisfying portions.'],
            [alphaId, 'Jon C.', 5, 'My go-to lunch between classes.'],
            [alphaId, 'Ari S.', 4, 'Good meals at a fair price.'],
            [betaId, 'Sam P.', 4, 'Great snacks to share.'],
            [betaId, 'Lei M.', 4, 'Tasty and easy to order.'],
            [gammaId, 'Nico D.', 5, 'Affordable and filling meals.'],
            [gammaId, 'Bea T.', 3, 'Good portions, sometimes a wait.']
        ];

        for (const [store_id, reviewer_name, score, review] of seedRatings) {
            insertRating.run({ store_id, reviewer_name, score, review, created_at: now });
        }

        const customerId = userIds.get('customer@dormdish.test');
        const riderId = userIds.get('rider@dormdish.test');
        const orderId = 'DD-DEMO-1001';
        const demoProduct = db.prepare(
            'SELECT id, name, price FROM products WHERE store_id = ? ORDER BY id LIMIT 1'
        ).get(alphaId);

        const subtotal = Number(demoProduct.price);
        const etaAt = new Date(Date.now() + 18 * 60 * 1000).toISOString();

        db.prepare(`
            INSERT INTO orders (
                id, customer_id, store_id, rider_id, status, subtotal, delivery_fee,
                total, payment_method, delivery_address, eta_minutes, eta_at, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, 'Out for Delivery', ?, 20, ?, 'Cash on delivery',
                'TIPQC Main Building', 18, ?, ?, ?)
        `).run(orderId, customerId, alphaId, riderId, subtotal, subtotal + 20, etaAt, now, now);

        db.prepare(`
            INSERT INTO order_items (order_id, product_id, product_name, unit_price, quantity, line_total)
            VALUES (?, ?, ?, ?, 1, ?)
        `).run(orderId, demoProduct.id, demoProduct.name, demoProduct.price, demoProduct.price);

        db.prepare(`
            INSERT INTO tracking_updates (order_id, updated_by, status, note, location_label, eta_at, created_at)
            VALUES (?, ?, 'Out for Delivery', 'Your demo order is with the rider.', 'Leaving Store Alpha', ?, ?)
        `).run(orderId, userIds.get('manager.alpha@dormdish.test'), etaAt, now);

        const settings = [
            ['app_name', 'DormDish'],
            ['delivery_fee', '20'],
            ['default_eta_minutes', '25'],
            ['campus_location', 'TIPQC Main Building']
        ];

        const insertSetting = db.prepare(`
            INSERT OR IGNORE INTO app_settings (setting_key, setting_value, updated_at)
            VALUES (?, ?, ?)
        `);

        for (const [setting_key, setting_value] of settings) {
            insertSetting.run(setting_key, setting_value, now);
        }
    });

    seed();
}

export function getStoreRatingSummary(storeId) {
    return db.prepare(`
        SELECT ROUND(AVG(score), 1) AS rating, COUNT(*) AS rating_count
        FROM ratings
        WHERE store_id = ? AND is_visible = 1
    `).get(storeId);
}

export function withEffectiveProductPricing(product) {
    if (!product) {
        return product;
    }

    const now = Date.now();
    const startsAt = product.promo_starts_at ? Date.parse(product.promo_starts_at) : null;
    const endsAt = product.promo_ends_at ? Date.parse(product.promo_ends_at) : null;

    const hasPromo =
        Boolean(product.is_promoted) &&
        product.promo_price !== null &&
        product.promo_price !== undefined &&
        Number(product.promo_price) < Number(product.price);

    const startsInTime = startsAt === null || !Number.isFinite(startsAt) || startsAt <= now;
    const endsInTime = endsAt === null || !Number.isFinite(endsAt) || endsAt > now;
    const promoActive = hasPromo && startsInTime && endsInTime;
    const regularPrice = Number(product.price);

    return {
        ...product,
        regular_price: regularPrice,
        price: promoActive ? Number(product.promo_price) : regularPrice,
        old_price: promoActive ? regularPrice : product.old_price,
        promo_active: promoActive,
        is_promoted: Boolean(product.is_promoted),
        promo_price: product.promo_price === null || product.promo_price === undefined
            ? null
            : Number(product.promo_price)
    };
}

export function getPricingPolicy() {
    const rows = db.prepare(`
        SELECT setting_key, setting_value
        FROM app_settings
        WHERE setting_key IN (
            'student_discount_percent',
            'group_discount_percent',
            'group_discount_min_members',
            'group_discount_min_subtotal',
            'delivery_fee'
        )
    `).all();

    const values = Object.fromEntries(rows.map((row) => [row.setting_key, Number(row.setting_value)]));

    return {
        studentDiscountPercent: Number.isFinite(values.student_discount_percent) ? values.student_discount_percent : 5,
        groupDiscountPercent: Number.isFinite(values.group_discount_percent) ? values.group_discount_percent : 5,
        groupDiscountMinMembers: Number.isFinite(values.group_discount_min_members) ? values.group_discount_min_members : 3,
        groupDiscountMinSubtotal: Number.isFinite(values.group_discount_min_subtotal) ? values.group_discount_min_subtotal : 300,
        deliveryFee: Number.isFinite(values.delivery_fee) ? values.delivery_fee : 20
    };
}

export function calculateOrderDiscounts(lines, groupMemberCount = 1) {
    const policy = getPricingPolicy();

    const subtotal = Math.round(
        lines.reduce((sum, line) => sum + Number(line.product.price) * Number(line.quantity), 0) * 100
    ) / 100;

    const studentEligibleSubtotal = lines.reduce(
        (sum, line) => sum + (!line.product.promo_active
            ? Number(line.product.price) * Number(line.quantity)
            : 0),
        0
    );

    const studentDiscount = Math.round(studentEligibleSubtotal * policy.studentDiscountPercent) / 100;
    const groupEligible = groupMemberCount >= policy.groupDiscountMinMembers
        && subtotal >= policy.groupDiscountMinSubtotal;

    const groupDiscount = groupEligible
        ? Math.round(Math.max(0, subtotal - studentDiscount) * policy.groupDiscountPercent) / 100
        : 0;

    const discountTotal = Math.round((studentDiscount + groupDiscount) * 100) / 100;

    return {
        subtotal,
        studentDiscount: Math.round(studentDiscount * 100) / 100,
        groupDiscount: Math.round(groupDiscount * 100) / 100,
        discountTotal,
        groupEligible,
        policy
    };
}

export function getProduct(productId) {
    const product = db.prepare(`
        SELECT p.*, s.name AS store_name, s.is_active AS store_active
        FROM products p
        JOIN stores s ON s.id = p.store_id
        WHERE p.id = ?
    `).get(productId);

    return withEffectiveProductPricing(product);
}

export function getOrderDetails(orderId) {
    const order = db.prepare(`
        SELECT o.*, c.name AS customer_name,
               s.name AS store_name, s.location_name, s.maps_url,
               r.name AS rider_name
        FROM orders o
        JOIN users c ON c.id = o.customer_id
        JOIN stores s ON s.id = o.store_id
        LEFT JOIN users r ON r.id = o.rider_id
        WHERE o.id = ?
    `).get(orderId);

    if (!order) {
        return null;
    }

    order.items = db.prepare(`
        SELECT oi.*, u.name AS ordered_by_name
        FROM order_items oi
        LEFT JOIN users u ON u.id = oi.ordered_by_customer_id
        WHERE oi.order_id = ?
        ORDER BY oi.id
    `).all(orderId);

    order.tracking = db.prepare(`
        SELECT t.*, u.name AS updated_by_name
        FROM tracking_updates t
        LEFT JOIN users u ON u.id = t.updated_by
        WHERE t.order_id = ?
        ORDER BY t.created_at DESC, t.id DESC
    `).all(orderId);

    order.rating = db.prepare(`
        SELECT id, score, review, created_at
        FROM ratings
        WHERE order_id = ? AND customer_id = ? AND is_visible = 1
    `).get(orderId, order.customer_id) || null;

    return order;
}