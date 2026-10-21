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
    customerToken = await login('customer@dormdish.test', process.env.DEMO_CUSTOMER_PASSWORD);
    alphaManagerToken = await login('manager.alpha@dormdish.test', process.env.DEMO_MANAGER_PASSWORD);
    betaManagerToken = await login('manager.beta@dormdish.test', process.env.DEMO_MANAGER_PASSWORD);
    superadminToken = await login('superadmin@dormdish.test', process.env.DEMO_SUPERADMIN_PASSWORD);
    riderToken = await login('rider@dormdish.test', process.env.DEMO_RIDER_PASSWORD);
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

    const outForDelivery = await request(`/orders/${encodeURIComponent(orderId)}/progress`, {
        method: 'PATCH',
        body: { status: 'Out for Delivery', etaMinutes: 12, note: 'Rider has picked up your order.', locationLabel: 'Leaving Store Alpha' }
    }, alphaManagerToken);
    assert.equal(outForDelivery.status, 200);
    assert.ok(outForDelivery.body.order.eta_at);
    assert.equal(outForDelivery.body.order.eta_minutes, 12);

    const riderUpdate = await request(`/orders/${encodeURIComponent(orderId)}/progress`, {
        method: 'PATCH',
        body: { status: 'Out for Delivery', etaMinutes: 8, note: 'Approaching the main gate.', locationLabel: 'Campus Main Gate' }
    }, riderToken);
    assert.equal(riderUpdate.status, 200);
    assert.ok(riderUpdate.body.order.tracking.some((update) => update.location_label === 'Campus Main Gate'));

    const delivered = await request(`/orders/${encodeURIComponent(orderId)}/progress`, {
        method: 'PATCH',
        body: { status: 'Delivered', note: 'Handed to customer.', locationLabel: 'Delivery destination' }
    }, riderToken);
    assert.equal(delivered.status, 200);
    assert.equal(delivered.body.order.status, 'Delivered');

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
