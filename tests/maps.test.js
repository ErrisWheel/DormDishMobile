import test from 'node:test';
import assert from 'node:assert/strict';
import { deliveryDirectionsUrl, deliveryDestinationUrl, storeMapUrl } from '../src/lib/maps.js';

const storeLink = 'https://www.google.com/maps?cid=2385593826430662165&g_mp=CiVnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLkdldFBsYWNlEAMYASAF';

test('delivery directions include the store location and customer address', () => {
    const url = new URL(deliveryDirectionsUrl({
        maps_url: storeLink,
        delivery_address: 'Dormitory Building A, Quezon City'
    }));

    assert.equal(url.origin, 'https://www.google.com');
    assert.equal(url.pathname, '/maps/dir/');
    assert.equal(url.searchParams.get('api'), '1');
    assert.equal(url.searchParams.get('origin'), storeLink);
    assert.equal(url.searchParams.get('destination'), 'Dormitory Building A, Quezon City');
    assert.equal(url.searchParams.get('travelmode'), 'driving');
});

test('store map link falls back to the requested Store Alpha pin', () => {
    assert.equal(storeMapUrl({}), storeLink);
});

test('delivery destination lookup encodes a saved address', () => {
    const url = new URL(deliveryDestinationUrl('Dormitory Building A, Quezon City'));
    assert.equal(url.searchParams.get('query'), 'Dormitory Building A, Quezon City');
});
