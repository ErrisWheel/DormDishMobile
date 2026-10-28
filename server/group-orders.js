import crypto from 'node:crypto';

export function registerGroupOrderRoutes(app, { db, requireAuth, allowRoles, getProduct, getOrderDetails, calculateOrderDiscounts, logTracking }) {
    function loadGroupOrder(groupId) {
        const group = db.prepare(`
            SELECT g.*, s.name AS store_name, s.location_name, h.name AS host_name
            FROM group_orders g
            JOIN stores s ON s.id = g.store_id
            JOIN users h ON h.id = g.host_customer_id
            WHERE g.id = ?
        `).get(groupId);

        if (!group) {
            return null;
        }

        const members = db.prepare(`
            SELECT u.id, u.name, gm.joined_at
            FROM group_order_members gm
            JOIN users u ON u.id = gm.customer_id
            WHERE gm.group_order_id = ?
            ORDER BY gm.joined_at, u.id
        `).all(groupId);

        const storedItems = db.prepare(`
            SELECT gi.*, u.name AS member_name
            FROM group_order_items gi
            JOIN users u ON u.id = gi.customer_id
            WHERE gi.group_order_id = ?
            ORDER BY gi.id
        `).all(groupId);

        const items = storedItems.map((item) => {
            const latestProduct = item.product_id ? getProduct(item.product_id) : null;

            return {
                ...item,
                current_price: latestProduct && latestProduct.store_id === group.store_id
                    ? Number(latestProduct.price)
                    : Number(item.unit_price),
                promo_active: latestProduct && latestProduct.store_id === group.store_id
                    ? Boolean(latestProduct.promo_active)
                    : false,
                promo_label: latestProduct?.promo_label || '',
                stock: latestProduct?.stock ?? 0,
                is_available: Boolean(latestProduct?.is_available && latestProduct?.store_active)
            };
        });

        const lines = items.map((item) => ({
            product: {
                price: item.current_price,
                promo_active: item.promo_active
            },
            quantity: Number(item.quantity)
        }));

        const estimate = calculateOrderDiscounts(lines, members.length);
        const feeSetting = db.prepare(
            "SELECT setting_value FROM app_settings WHERE setting_key = 'delivery_fee'"
        ).get();
        const deliveryFee = group.status === 'OPEN' ? Number(feeSetting?.setting_value || 20) : 0;

        return {
            ...group,
            members,
            items,
            member_count: members.length,
            subtotal: estimate.subtotal,
            student_discount: estimate.studentDiscount,
            group_discount: estimate.groupDiscount,
            discount_total: estimate.discountTotal,
            group_discount_eligible: estimate.groupEligible,
            delivery_fee: deliveryFee,
            estimated_total: Math.max(0, estimate.subtotal - estimate.discountTotal) + deliveryFee,
            discount_policy: {
                student_discount_percent: estimate.policy.studentDiscountPercent,
                group_discount_percent: estimate.policy.groupDiscountPercent,
                group_discount_min_members: estimate.policy.groupDiscountMinMembers,
                group_discount_min_subtotal: estimate.policy.groupDiscountMinSubtotal
            },
            order: group.order_id ? getOrderDetails(group.order_id) : null
        };
    }

    function requireGroupMember(req, res, group) {
        const member = db.prepare(`
            SELECT id FROM group_order_members
            WHERE group_order_id = ? AND customer_id = ?
        `).get(group.id, req.user.id);

        if (!member) {
            res.status(403).json({ error: 'You are not a member of this group order.' });
            return false;
        }

        return true;
    }

    function readAndValidateItems(storeId, items) {
        if (!Array.isArray(items) || items.length === 0) {
            throw new Error('Add at least one item before submitting your cart to the group.');
        }

        const quantities = new Map();

        for (const item of items) {
            const productId = Number(item.productId);
            const quantity = Number(item.quantity);

            if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
                throw new Error('Each group item must have a valid product and quantity.');
            }

            quantities.set(productId, (quantities.get(productId) || 0) + quantity);
        }

        const rows = [];

        for (const [productId, quantity] of quantities) {
            const product = getProduct(productId);

            if (!product || Number(product.store_id) !== Number(storeId) || !product.store_active || !product.is_available) {
                throw new Error('All group-order items must be available from the same store.');
            }

            if (Number(product.stock) < quantity) {
                throw new Error(`${product.name} does not have enough stock for this quantity.`);
            }

            rows.push({ product, quantity });
        }

        return rows;
    }

    function insertGroupItems(groupId, customerId, products) {
        const insert = db.prepare(`
            INSERT INTO group_order_items (
                group_order_id, customer_id, product_id, product_name, unit_price, quantity, created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const now = new Date().toISOString();

        for (const { product, quantity } of products) {
            insert.run(groupId, customerId, product.id, product.name, product.price, quantity, now);
        }
    }

    app.get('/api/group-orders/mine', requireAuth, allowRoles('customer'), (req, res) => {
        const row = db.prepare(`
            SELECT g.id
            FROM group_orders g
            JOIN group_order_members gm ON gm.group_order_id = g.id
            WHERE gm.customer_id = ? AND g.status = 'OPEN'
            ORDER BY g.updated_at DESC
            LIMIT 1
        `).get(req.user.id);

        res.json({ groupOrder: row ? loadGroupOrder(row.id) : null });
    });

    app.post('/api/group-orders', requireAuth, allowRoles('customer'), (req, res) => {
        const storeId = Number(req.body.storeId);
        const deliveryAddress = typeof req.body.deliveryAddress === 'string'
            ? req.body.deliveryAddress.trim()
            : '';
        const store = db.prepare(
            'SELECT * FROM stores WHERE id = ? AND is_active = 1'
        ).get(storeId);

        if (!store) {
            return res.status(400).json({ error: 'Choose an active store for the group order.' });
        }

        if (deliveryAddress.length < 3 || deliveryAddress.length > 300) {
            return res.status(400).json({
                error: 'Enter a shared delivery location between 3 and 300 characters.'
            });
        }

        const alreadyInGroup = db.prepare(`
            SELECT g.id
            FROM group_orders g
            JOIN group_order_members gm ON gm.group_order_id = g.id
            WHERE gm.customer_id = ? AND g.status = 'OPEN'
            LIMIT 1
        `).get(req.user.id);

        if (alreadyInGroup) {
            return res.status(409).json({
                error: 'You are already in an open group order. Open your cart to continue it.'
            });
        }

        let products;

        try {
            products = readAndValidateItems(storeId, req.body.items);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }

        let groupId;
        let joinCode;

        do {
            groupId = `DG-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
            joinCode = crypto.randomBytes(3).toString('hex').toUpperCase();
        } while (db.prepare('SELECT 1 FROM group_orders WHERE join_code = ?').get(joinCode));

        const now = new Date().toISOString();

        const create = db.transaction(() => {
            db.prepare(`
                INSERT INTO group_orders (
                    id, join_code, host_customer_id, store_id, delivery_address,
                    status, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?)
            `).run(groupId, joinCode, req.user.id, storeId, deliveryAddress, now, now);

            db.prepare(`
                INSERT INTO group_order_members (group_order_id, customer_id, joined_at)
                VALUES (?, ?, ?)
            `).run(groupId, req.user.id, now);

            insertGroupItems(groupId, req.user.id, products);
        });

        try {
            create();
            res.status(201).json({ groupOrder: loadGroupOrder(groupId) });
        } catch (error) {
            res.status(400).json({ error: error.message || 'Could not create the group order.' });
        }
    });

    app.post('/api/group-orders/join', requireAuth, allowRoles('customer'), (req, res) => {
        const joinCode = typeof req.body.joinCode === 'string'
            ? req.body.joinCode.trim().toUpperCase()
            : '';

        if (!/^[A-F0-9]{6}$/.test(joinCode)) {
            return res.status(400).json({ error: 'Enter the 6-character group code.' });
        }

        const group = db.prepare(
            "SELECT * FROM group_orders WHERE join_code = ? AND status = 'OPEN'"
        ).get(joinCode);

        if (!group) {
            return res.status(404).json({
                error: 'That group code was not found or the group is already closed.'
            });
        }

        if (Number(group.host_customer_id) === Number(req.user.id)) {
            return res.status(400).json({ error: 'You created this group order already.' });
        }

        if (db.prepare(`
            SELECT 1 FROM group_order_members
            WHERE group_order_id = ? AND customer_id = ?
        `).get(group.id, req.user.id)) {
            return res.json({ groupOrder: loadGroupOrder(group.id) });
        }

        const active = db.prepare(`
            SELECT g.id
            FROM group_orders g
            JOIN group_order_members gm ON gm.group_order_id = g.id
            WHERE gm.customer_id = ? AND g.status = 'OPEN'
            LIMIT 1
        `).get(req.user.id);

        if (active) {
            return res.status(409).json({
                error: 'Leave your current group order before joining another.'
            });
        }

        const count = db.prepare(`
            SELECT COUNT(*) AS count FROM group_order_members WHERE group_order_id = ?
        `).get(group.id).count;

        if (count >= 20) {
            return res.status(400).json({
                error: 'This group order has reached the 20-student limit.'
            });
        }

        db.prepare(`
            INSERT INTO group_order_members (group_order_id, customer_id, joined_at)
            VALUES (?, ?, ?)
        `).run(group.id, req.user.id, new Date().toISOString());

        db.prepare('UPDATE group_orders SET updated_at = ? WHERE id = ?')
            .run(new Date().toISOString(), group.id);

        res.json({ groupOrder: loadGroupOrder(group.id) });
    });

    app.get('/api/group-orders/:id', requireAuth, allowRoles('customer'), (req, res) => {
        const group = db.prepare('SELECT * FROM group_orders WHERE id = ?').get(req.params.id);

        if (!group) {
            return res.status(404).json({ error: 'Group order not found.' });
        }

        if (!requireGroupMember(req, res, group)) {
            return;
        }

        res.json({ groupOrder: loadGroupOrder(group.id) });
    });

    app.post('/api/group-orders/:id/items', requireAuth, allowRoles('customer'), (req, res) => {
        const group = db.prepare(
            "SELECT * FROM group_orders WHERE id = ? AND status = 'OPEN'"
        ).get(req.params.id);

        if (!group) {
            return res.status(404).json({ error: 'This group order is closed.' });
        }

        if (!requireGroupMember(req, res, group)) {
            return;
        }

        let products;

        try {
            const quantities = new Map();

            if (!Array.isArray(req.body.items) || !req.body.items.length) {
                throw new Error('Your cart is empty. Add items before submitting to the group.');
            }

            for (const item of req.body.items) {
                const productId = Number(item.productId);
                const quantity = Number(item.quantity);

                if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
                    throw new Error('Each group item must have a valid product and quantity.');
                }

                quantities.set(productId, (quantities.get(productId) || 0) + quantity);
            }

            products = [];

            for (const [productId, quantity] of quantities) {
                const product = getProduct(productId);

                if (!product || Number(product.store_id) !== Number(group.store_id) || !product.store_active || !product.is_available) {
                    throw new Error('All group-order items must be available from the same store as the group.');
                }

                const currentGroupQuantity = db.prepare(`
                    SELECT COALESCE(SUM(quantity), 0) AS quantity
                    FROM group_order_items
                    WHERE group_order_id = ? AND product_id = ?
                `).get(group.id, productId).quantity;

                if (Number(product.stock) < Number(currentGroupQuantity) + quantity) {
                    throw new Error(`${product.name} does not have enough stock for the group's combined quantity.`);
                }

                products.push({ product, quantity });
            }
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }

        try {
            const add = db.transaction(() => {
                insertGroupItems(group.id, req.user.id, products);
                db.prepare('UPDATE group_orders SET updated_at = ? WHERE id = ?')
                    .run(new Date().toISOString(), group.id);
            });

            add();
            res.json({ groupOrder: loadGroupOrder(group.id) });
        } catch (error) {
            res.status(400).json({ error: error.message || 'Could not add items to this group.' });
        }
    });

    app.post('/api/group-orders/:id/checkout', requireAuth, allowRoles('customer'), (req, res) => {
        const group = db.prepare(
            "SELECT * FROM group_orders WHERE id = ? AND status = 'OPEN'"
        ).get(req.params.id);

        if (!group) {
            return res.status(404).json({ error: 'This group order is already closed.' });
        }

        if (Number(group.host_customer_id) !== Number(req.user.id)) {
            return res.status(403).json({ error: 'Only the group host can place the combined order.' });
        }

        if (!requireGroupMember(req, res, group)) {
            return;
        }

        try {
            const orderId = db.transaction(() => {
                const memberCount = db.prepare(`
                    SELECT COUNT(*) AS count FROM group_order_members WHERE group_order_id = ?
                `).get(group.id).count;

                const groupItems = db.prepare(`
                    SELECT * FROM group_order_items WHERE group_order_id = ? ORDER BY id
                `).all(group.id);

                if (!groupItems.length) {
                    throw new Error('Add items before checking out the group order.');
                }

                const quantities = new Map();
                const orderLines = [];

                for (const item of groupItems) {
                    if (item.product_id === null) {
                        throw new Error(`${item.product_name} is no longer available. Remove it before checking out.`);
                    }

                    const product = getProduct(item.product_id);

                    if (!product || Number(product.store_id) !== Number(group.store_id) || !product.store_active || !product.is_available) {
                        throw new Error(`${item.product_name} is no longer available. Ask the group to refresh its items.`);
                    }

                    quantities.set(
                        Number(product.id),
                        (quantities.get(Number(product.id)) || 0) + Number(item.quantity)
                    );

                    orderLines.push({ item, product, quantity: Number(item.quantity) });
                }

                for (const [productId, quantity] of quantities) {
                    const product = getProduct(productId);

                    if (!product || Number(product.stock) < quantity) {
                        throw new Error(`${product?.name || 'A product'} does not have enough stock for the combined group quantity.`);
                    }
                }

                const pricing = calculateOrderDiscounts(
                    orderLines.map((line) => ({ product: line.product, quantity: line.quantity })),
                    memberCount
                );

                const deliveryFee = pricing.policy.deliveryFee;
                const total = Math.max(0, pricing.subtotal - pricing.discountTotal) + deliveryFee;
                // Group orders also enter the rider offer pool without a preassigned rider.
                const now = new Date().toISOString();
                const orderId = `DD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
                const paymentMethod = typeof req.body.paymentMethod === 'string' && req.body.paymentMethod.trim()
                    ? req.body.paymentMethod.trim()
                    : 'Cash on delivery';
                const orderNotes = typeof req.body.orderNotes === 'string' && req.body.orderNotes.trim()
                    ? req.body.orderNotes.trim().slice(0, 500)
                    : `Group order with ${memberCount} students.`;

                db.prepare(`
                    INSERT INTO orders (
                        id, customer_id, store_id, rider_id, status, subtotal, delivery_fee, total,
                        discount_total, student_discount, group_discount, group_order_id,
                        payment_method, delivery_address, order_notes, created_at, updated_at
                    )
                    VALUES (?, ?, ?, NULL, 'Pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    orderId, group.host_customer_id, group.store_id,
                    pricing.subtotal, deliveryFee, total, pricing.discountTotal,
                    pricing.studentDiscount, pricing.groupDiscount, group.id, paymentMethod,
                    group.delivery_address, orderNotes, now, now
                );

                const insertOrderItem = db.prepare(`
                    INSERT INTO order_items (
                        order_id, product_id, product_name, unit_price,
                        quantity, line_total, ordered_by_customer_id
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `);

                for (const line of orderLines) {
                    insertOrderItem.run(
                        orderId,
                        line.product.id,
                        line.item.product_name,
                        line.product.price,
                        line.quantity,
                        line.product.price * line.quantity,
                        line.item.customer_id
                    );
                }

                const decreaseStock = db.prepare(
                    'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?'
                );

                for (const [productId, quantity] of quantities) {
                    if (decreaseStock.run(quantity, productId, quantity).changes !== 1) {
                        throw new Error('Stock changed while the group order was being placed. Refresh and try again.');
                    }
                }

                logTracking(
                    orderId,
                    req.user.id,
                    'Pending',
                    `Group order placed by ${req.user.name} for ${memberCount} students. Waiting for store confirmation.`,
                    group.delivery_address,
                    null
                );

                db.prepare(`
                    UPDATE group_orders SET status = 'CLOSED', order_id = ?, updated_at = ? WHERE id = ?
                `).run(orderId, now, group.id);

                return orderId;
            })();

            res.status(201).json({
                order: getOrderDetails(orderId),
                groupOrder: loadGroupOrder(group.id)
            });
        } catch (error) {
            res.status(400).json({ error: error.message || 'Could not place the group order.' });
        }
    });

    app.post('/api/group-orders/:id/leave', requireAuth, allowRoles('customer'), (req, res) => {
        const group = db.prepare(
            "SELECT * FROM group_orders WHERE id = ? AND status = 'OPEN'"
        ).get(req.params.id);

        if (!group) {
            return res.status(404).json({ error: 'This group order is closed.' });
        }

        if (!requireGroupMember(req, res, group)) {
            return;
        }

        if (Number(group.host_customer_id) === Number(req.user.id)) {
            return res.status(400).json({ error: 'The host must cancel the group instead of leaving it.' });
        }

        const leave = db.transaction(() => {
            db.prepare('DELETE FROM group_order_items WHERE group_order_id = ? AND customer_id = ?')
                .run(group.id, req.user.id);
            db.prepare('DELETE FROM group_order_members WHERE group_order_id = ? AND customer_id = ?')
                .run(group.id, req.user.id);
            db.prepare('UPDATE group_orders SET updated_at = ? WHERE id = ?')
                .run(new Date().toISOString(), group.id);
        });

        leave();
        res.json({ success: true });
    });

    app.delete('/api/group-orders/:id', requireAuth, allowRoles('customer'), (req, res) => {
        const group = db.prepare(
            "SELECT * FROM group_orders WHERE id = ? AND status = 'OPEN'"
        ).get(req.params.id);

        if (!group) {
            return res.status(404).json({ error: 'This group order is closed.' });
        }

        if (Number(group.host_customer_id) !== Number(req.user.id)) {
            return res.status(403).json({ error: 'Only the group host can cancel this group order.' });
        }

        db.prepare("UPDATE group_orders SET status = 'CANCELLED', updated_at = ? WHERE id = ?")
            .run(new Date().toISOString(), group.id);

        res.json({ success: true });
    });
}