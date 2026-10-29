// API tests
import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'dormdish-api-test-'));
const databasePath = path.join(temporaryDirectory, 'test.sqlite');
const port = 42000 + Math.floor(Math.random() * 10000);
const baseUrl = `http://127.0.0.1:${port}/api`;
const childEnvironment = {
    ...process.env,
    PORT: String(port),
    DATABASE_URL: '',
    SMTP_USER: '',
    SMTP_PASS: '',
    RESEND_API_KEY: '',
    EMAIL_PROVIDER: 'smtp',
    EMAIL_FROM: '',
    RESEND_API_KEY: '',
    EMAIL_PROVIDER: 'smtp',
    EMAIL_FROM: '',
    DEMO_SUPERADMIN_PASSWORD: process.env.DEMO_SUPERADMIN_PASSWORD || 'Admin123!',
    DEMO_MANAGER_PASSWORD: process.env.DEMO_MANAGER_PASSWORD || 'Manager123!',
    DEMO_CUSTOMER_PASSWORD: process.env.DEMO_CUSTOMER_PASSWORD || 'Customer123!',
    DEMO_RIDER_PASSWORD: process.env.DEMO_RIDER_PASSWORD || 'Rider123!',
    JWT_SECRET: 'automated-test-secret-value-with-over-24-characters',
    DORMDISH_DB_PATH: databasePath
};
let apiProcess;
let customerToken;
let alphaManagerToken;
let betaManagerToken;
let superadminToken;
let riderToken;
let betaProductId;
let alphaProductId;

async function request(pathname, options = {}, token = '') {
    const response = await fetch(`${baseUrl}${pathname}`, {
        ...options,
        headers: {
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...options.headers
        },
        body: options.body ? JSON.stringify(options.body) : undefined
    });
    const body = await response.json();
    return { status: response.status, body };
}

async function login(email, password) {
    const result = await request('/auth/login', {
        method: 'POST',
        body: { email, password }
    });
    assert.equal(result.status, 200);
    return result.body.token;
}

before(async () => {
    apiProcess = spawn(process.execPath, ['server/index.js'], {
        cwd: projectRoot,
        env: childEnvironment,
        stdio: 'ignore'
    });

    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (apiProcess.exitCode !== null) {
            throw new Error(`API exited with code ${apiProcess.exitCode}`);
        }

        try {
            const result = await fetch(`${baseUrl}/health`);
            if (result.ok) {
                ready = true;
                break;
            }
        } catch {}

        await new Promise((resolve) => setTimeout(resolve, 100));
    }

    assert.equal(ready, true, 'API should become ready');
    customerToken = await login('customer@dormdish.test', childEnvironment.DEMO_CUSTOMER_PASSWORD);
    alphaManagerToken = await login('manager.alpha@dormdish.test', childEnvironment.DEMO_MANAGER_PASSWORD);
    betaManagerToken = await login('manager.beta@dormdish.test', childEnvironment.DEMO_MANAGER_PASSWORD);
    superadminToken = await login('superadmin@dormdish.test', childEnvironment.DEMO_SUPERADMIN_PASSWORD);
    riderToken = await login('rider@dormdish.test', childEnvironment.DEMO_RIDER_PASSWORD);
    const betaProducts = await request('/products?storeId=2');
    const alphaProducts = await request('/products?storeId=1');
    betaProductId = betaProducts.body.products[0].id;
    alphaProductId = alphaProducts.body.products[0].id;
});

after(async () => {
    if (apiProcess && apiProcess.exitCode === null) {
        await new Promise((resolve) => {
            apiProcess.once('exit', resolve);
            apiProcess.kill('SIGTERM');
        });
    }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('seed data includes three rated stores sorted by rating', async () => {
    const result = await request('/stores');
    assert.equal(result.status, 200);
    assert.equal(result.body.stores.length, 3);
    assert.ok(Number(result.body.stores[0].rating) >= Number(result.body.stores[1].rating));
    assert.ok(result.body.stores.every((store) => store.rating_count > 0));
});

test('superadmin is blocked from product mutation and order records', async () => {
    const products = await request('/products?storeId=1');
    const createProduct = await request('/products', {
        method: 'POST',
        body: { name: 'Blocked Product', category: 'Meals', price: 1, stock: 1 }
    }, superadminToken);
    const orders = await request('/orders', {}, superadminToken);
    assert.equal(products.status, 200);
    assert.equal(createProduct.status, 403);
    assert.equal(orders.status, 403);
});

test('store managers cannot update another store products', async () => {
    const result = await request(`/products/${betaProductId}`, {
        method: 'PUT',
        body: { name: 'Unauthorized Update', description: '', category: 'Meals', price: 99, oldPrice: null, imageUrl: '/images/hero-food.png', stock: 1, isAvailable: true }
    }, alphaManagerToken);
    assert.equal(result.status, 403);
});

test('store managers cannot manage another store in either direction', async () => {
    const result = await request(`/products/${alphaProductId}`, {
        method: 'PUT',
        body: { name: 'Unauthorized Update', description: '', category: 'Meals', price: 99, oldPrice: null, imageUrl: '/images/hero-food.png', stock: 1, isAvailable: true }
    }, betaManagerToken);
    assert.equal(result.status, 403);
});

test('store managers cannot read or update another store orders', async () => {
    const readOrder = await request('/orders/DD-DEMO-1001', {}, betaManagerToken);
    const updateOrder = await request('/orders/DD-DEMO-1001/progress', {
        method: 'PATCH',
        body: { status: 'Preparing', etaMinutes: 15, note: 'Unauthorized test', locationLabel: 'Other store' }
    }, betaManagerToken);
    assert.equal(readOrder.status, 403);
    assert.equal(updateOrder.status, 403);
});

test('only store managers can create products', async () => {
    const result = await request('/products', {
        method: 'POST',
        body: { name: 'Automated Test Product', description: 'temporary test product', category: 'Meals', price: 17, oldPrice: null, imageUrl: '/images/hero-food.png', stock: 5, isAvailable: true }
    }, alphaManagerToken);
    assert.equal(result.status, 201);
    assert.equal(result.body.product.name, 'Automated Test Product');
});

test('customer can view only their own orders and rider cannot view manager tools', async () => {
    const customerOrders = await request('/orders', {}, customerToken);
    const riderOrders = await request('/orders', {}, riderToken);
    const managerTools = await request('/manager/riders', {}, riderToken);
    assert.equal(customerOrders.status, 200);
    assert.ok(customerOrders.body.orders.some((order) => order.id === 'DD-DEMO-1001'));
    assert.equal(riderOrders.status, 200);
    assert.ok(riderOrders.body.orders.every((order) => order.rider_id !== null));
    assert.equal(managerTools.status, 403);
});


test('media uploads require an authenticated user and allowed image payload', async () => {
    const noAuth = await request('/uploads/profile', { method: 'POST', body: { filename: 'x.jpg', mimeType: 'image/jpeg', data: 'data:image/jpeg;base64,/9j/2Q==' } });
    assert.equal(noAuth.status, 401);
    const uploaded = await request('/uploads/profile', { method: 'POST', body: { filename: 'profile.jpg', mimeType: 'image/jpeg', data: 'data:image/jpeg;base64,/9j/2Q==' } }, customerToken);
    assert.equal(uploaded.status, 201);
    assert.match(uploaded.body.url, /\/media\/[0-9a-f-]{36}$/i);
});

test('API rejects unauthenticated protected access', async () => {
    const result = await request('/admin/users');
    assert.equal(result.status, 401);
});

test('customer order lifecycle persists ETA, tracking, and store rating', async () => {
    const productResponse = await request('/products?storeId=1');
    const product = productResponse.body.products[0];
    const placed = await request('/orders', {
        method: 'POST',
        body: {
            storeId: 1,
            items: [{ productId: product.id, quantity: 1 }],
            deliveryAddress: 'TIPQC Library Entrance',
            paymentMethod: 'Cash on delivery'
        }
    }, customerToken);
    assert.equal(placed.status, 201);
    const orderId = placed.body.order.id;
    assert.equal(placed.body.order.status, 'Pending');
    assert.equal(placed.body.order.tracking.length, 1);

    for (const status of ['Confirmed', 'Preparing', 'Ready for Pickup']) {
        const updated = await request(`/orders/${encodeURIComponent(orderId)}/progress`, {
            method: 'PATCH',
            body: { status, etaMinutes: 20, note: `${status} test update`, locationLabel: 'Store Alpha' }
        }, alphaManagerToken);
        assert.equal(updated.status, 200);
        assert.equal(updated.body.order.status, status);
    }

    const managerPickupAttempt = await request(`/orders/${encodeURIComponent(orderId)}/progress`, {
        method: 'PATCH',
        body: { status: 'Out for Delivery', etaMinutes: 12, note: 'Rider has picked up your order.', locationLabel: 'Leaving Store Alpha' }
    }, alphaManagerToken);
    assert.equal(managerPickupAttempt.status, 403, 'a store manager cannot confirm physical rider pickup');

    const online = await request('/rider/availability', { method: 'PATCH', body: { isOnline: true } }, riderToken);
    assert.equal(online.status, 200);
    const accepted = await request(`/orders/${encodeURIComponent(orderId)}/accept-rider`, { method: 'POST', body: {} }, riderToken);
    assert.equal(accepted.status, 200);
    const outForDelivery = await request(`/orders/${encodeURIComponent(orderId)}/progress`, {
        method: 'PATCH',
        body: { status: 'Out for Delivery', etaMinutes: 12, note: 'Rider picked up the order.' }
    }, riderToken);
    assert.equal(outForDelivery.status, 200);
    assert.ok(outForDelivery.body.order.eta_at);
    assert.equal(outForDelivery.body.order.eta_minutes, 12);

    const gps = await request(`/orders/${encodeURIComponent(orderId)}/location`, {
        method: 'POST', body: { latitude: 14.6195, longitude: 121.0008, accuracyM: 8 }
    }, riderToken);
    assert.equal(gps.status, 200);
    assert.equal(Number(gps.body.location.latitude), 14.6195);
    const customerGps = await request(`/orders/${encodeURIComponent(orderId)}/location`, {}, customerToken);
    assert.equal(customerGps.status, 200);
    assert.equal(Number(customerGps.body.location.longitude), 121.0008);

    const riderUpdate = await request(`/orders/${encodeURIComponent(orderId)}/progress`, {
        method: 'PATCH',
        body: { status: 'Out for Delivery', etaMinutes: 8, note: 'Approaching the main gate.', locationLabel: 'Campus Main Gate' }
    }, riderToken);
    assert.equal(riderUpdate.status, 200);
    assert.ok(riderUpdate.body.order.tracking.some((update) => update.location_label === 'Campus Main Gate'));

    const blockedDelivery = await request(`/orders/${encodeURIComponent(orderId)}/progress`, {
        method: 'PATCH', body: { status: 'Delivered' }
    }, riderToken);
    assert.equal(blockedDelivery.status, 403, 'delivery requires an uploaded proof photo');

    const delivered = await request(`/orders/${encodeURIComponent(orderId)}/delivery-proof`, {
        method: 'POST',
        body: { filename: 'proof.jpg', mimeType: 'image/jpeg', data: 'data:image/jpeg;base64,/9j/2Q==' }
    }, riderToken);
    assert.equal(delivered.status, 200);
    assert.equal(delivered.body.order.status, 'Delivered');
    assert.ok(delivered.body.order.delivery_proof_url);

    const rating = await request(`/orders/${encodeURIComponent(orderId)}/ratings`, {
        method: 'POST',
        body: { score: 5, review: 'Automated delivery test.' }
    }, customerToken);
    assert.equal(rating.status, 201);

    const orderDetails = await request(`/orders/${encodeURIComponent(orderId)}`, {}, customerToken);
    assert.equal(orderDetails.status, 200);
    assert.equal(orderDetails.body.order.rating.score, 5);
    assert.ok(orderDetails.body.order.tracking.length >= 6);
});


test('public support form validates required contact fields', async () => {
    const result = await request('/support', {
        method: 'POST',
        body: { name: 'A Student', contactNumber: '', email: 'student@example.com', message: 'I need help with my order.' }
    });
    assert.equal(result.status, 400);
    assert.match(result.body.error, /contact number/i);
});

test('support form reports missing SMTP configuration instead of pretending to send', async () => {
    const result = await request('/support', {
        method: 'POST',
        body: { name: 'A Student', contactNumber: '09123456789', email: 'student@example.com', message: 'I need help with my order.' }
    });
    assert.equal(result.status, 503);
    assert.match(result.body.error, /SMTP_USER or SMTP_PASS/i);
});

test('admin cannot create customer accounts through staff account creation', async () => {
    const result = await request('/admin/users', {
        method: 'POST',
        body: { name: 'Blocked Customer', email: 'blocked-customer@example.com', password: 'TestPassword123!', role: 'customer', storeId: null }
    }, superadminToken);
    assert.equal(result.status, 400);
    assert.match(result.body.error, /New accounts must be/i);
});


test('public signup creates a customer with a saved delivery address', async () => {
    const email = `signup-${Date.now()}@example.test`;
    const created = await request('/auth/register', {
        method: 'POST',
        body: {
            name: 'Signup Test Customer',
            email,
            password: 'TestSignup123!',
            contactNumber: '09123456789',
            recipientName: 'Signup Test Customer',
            addressLabel: 'Dorm',
            addressText: 'Building A, Room 201, Quezon City',
            deliveryInstructions: 'Meet at lobby and call on arrival.'
        }
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.user.role, 'customer');
    assert.ok(created.body.token);

    const list = await request('/customer/addresses', {}, created.body.token);
    assert.equal(list.status, 200);
    assert.equal(list.body.addresses.length, 1);
    assert.equal(list.body.addresses[0].address_label, 'Dorm');
    assert.equal(list.body.addresses[0].delivery_instructions, 'Meet at lobby and call on arrival.');

    const added = await request('/customer/addresses', {
        method: 'POST',
        body: {
            addressLabel: 'Campus Gate',
            recipientName: 'Signup Test Customer',
            contactNumber: '09123456789',
            addressText: 'Main campus gate, Quezon City',
            deliveryInstructions: 'Meet beside the guardhouse.'
        }
    }, created.body.token);
    assert.equal(added.status, 201);
    const reloaded = await request('/customer/addresses', {}, created.body.token);
    assert.equal(reloaded.status, 200);
    assert.equal(reloaded.body.addresses.length, 2);

    const mapOnly = await request('/customer/addresses', {
        method: 'POST',
        body: {
            addressLabel: 'Map Pin Only',
            recipientName: 'Signup Test Customer',
            contactNumber: '09123456789',
            addressText: '',
            latitude: 14.6236,
            longitude: 121.0614,
            deliveryInstructions: 'Meet at the lobby.'
        }
    }, created.body.token);
    assert.equal(mapOnly.status, 201);
    assert.match(mapOnly.body.address.address_text, /^14\.623600, 121\.061400$/);

    const forbiddenStaffCreation = await request('/admin/users', {
        method: 'POST',
        body: { name: 'Not Admin', email: `staff-${Date.now()}@example.test`, password: 'TestSignup123!', role: 'store_manager' }
    }, created.body.token);
    assert.equal(forbiddenStaffCreation.status, 403);
});
