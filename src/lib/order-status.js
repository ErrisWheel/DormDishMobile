// Order status labels
const labels = {
    Pending: 'Order Received',
    Confirmed: 'Processed',
    Preparing: 'In Kitchen',
    'Ready for Pickup': 'Ready for Pickup',
    'Out for Delivery': 'On Delivery',
    Delivered: 'Delivered',
    Cancelled: 'Cancelled'
};

export function orderStatusLabel(status) {
    return labels[status] || status || 'Unknown';
}
