import assert from 'node:assert/strict';
import test from 'node:test';
import { orderStatusLabel } from '../src/lib/order-status.js';

test('order status labels match the customer-friendly workflow', () => {
    assert.equal(orderStatusLabel('Pending'), 'Order Received');
    assert.equal(orderStatusLabel('Confirmed'), 'Processed');
    assert.equal(orderStatusLabel('Preparing'), 'In Kitchen');
    assert.equal(orderStatusLabel('Ready for Pickup'), 'Ready for Pickup');
    assert.equal(orderStatusLabel('Out for Delivery'), 'On Delivery');
    assert.equal(orderStatusLabel('Delivered'), 'Delivered');
});
