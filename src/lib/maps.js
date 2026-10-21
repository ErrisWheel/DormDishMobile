const storeLocationFallback = 'https://www.google.com/maps?cid=2385593826430662165&g_mp=CiVnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLkdldFBsYWNlEAMYASAF';

export function storeMapUrl(order) {
    return order?.maps_url || storeLocationFallback;
}

export function deliveryDirectionsUrl(order) {
    const origin = storeMapUrl(order);
    const destination = String(order?.delivery_address || '').trim();
    const params = new URLSearchParams({
        api: '1',
        origin,
        destination,
        travelmode: 'driving'
    });

    return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function deliveryDestinationUrl(address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(String(address || '').trim())}`;
}
