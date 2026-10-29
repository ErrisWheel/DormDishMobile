import 'dotenv/config';
import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import {
    calculateOrderDiscounts,
    db,
    getOrderDetails,
    getProduct,
    getStoreRatingSummary,
    initializeDatabase,
    withEffectiveProductPricing
} from './database.js';
import { registerGroupOrderRoutes } from './group-orders.js';
import { allowRoles, createToken, requireAuth } from './auth.js';

initializeDatabase();

const app = express();
app.set('trust proxy', 1);
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
app.use(express.json({ limit: '10mb' }));


// Email provider
const smtpUser = String(process.env.SMTP_USER || '').trim();
const smtpPass = String(process.env.SMTP_PASS || '').replace(/\s+/g, '');
const smtpPort = Number(process.env.SMTP_PORT || 465);
const smtpSecure = process.env.SMTP_SECURE === undefined ? smtpPort === 465 : String(process.env.SMTP_SECURE).toLowerCase() !== 'false';
const resendApiKey = String(process.env.RESEND_API_KEY || '').trim();
const emailProvider = String(process.env.EMAIL_PROVIDER || (resendApiKey ? 'resend' : 'smtp')).trim().toLowerCase();
const emailFrom = String(emailProvider === 'resend'
    ? (process.env.EMAIL_FROM || process.env.RESEND_FROM || '')
    : (process.env.EMAIL_FROM || process.env.SMTP_FROM || (smtpUser ? `DormDish Delivery <${smtpUser}>` : ''))).trim();
const mailer = smtpUser && smtpPass ? nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: smtpPort,
    secure: smtpSecure,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    auth: { user: smtpUser, pass: smtpPass }
}) : null;
const publicWebUrl = String(process.env.PUBLIC_WEB_URL || process.env.FRONTEND_URL || 'https://dormdishmobile-static.onrender.com').trim().replace(/\/+$/, '');
const supportEmail = String(process.env.SUPPORT_EMAIL || 'dormdishdelivery@gmail.com').trim();
const smtpTestTo = String(process.env.SMTP_TEST_TO || supportEmail || smtpUser).trim();
function emailConfigured() {
    if (emailProvider === 'resend') return Boolean(resendApiKey && emailFrom);
    return Boolean(mailer);
}
async function sendEmail(message) {
    if (!emailConfigured()) {
        throw new Error(emailProvider === 'resend'
            ? 'Email delivery is not configured. Set RESEND_API_KEY and EMAIL_FROM.'
            : 'SMTP is not configured. Set SMTP_USER and SMTP_PASS.');
    }
    if (emailProvider === 'resend') {
        const payload = {
            from: message.from || emailFrom,
            to: Array.isArray(message.to) ? message.to : [message.to],
            subject: message.subject,
            ...(message.text ? { text: message.text } : {}),
            ...(message.html ? { html: message.html } : {}),
            ...((message.replyTo || message.reply_to) ? { reply_to: message.replyTo || message.reply_to } : {})
        };
        const response = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(15000)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(result.message || result.error || `Email provider returned HTTP ${response.status}.`);
            error.code = 'RESEND_API_ERROR';
            error.responseCode = response.status;
            error.command = 'HTTPS';
            throw error;
        }
        return result;
    }
    return mailer.sendMail({ ...message, from: message.from || emailFrom });
}
async function verifyEmailTransport() {
    if (!emailConfigured()) throw new Error(emailProvider === 'resend' ? 'Set RESEND_API_KEY and EMAIL_FROM.' : 'Set SMTP_USER and SMTP_PASS.');
    if (emailProvider === 'smtp') await mailer.verify();
}
function normalizePublicApiUrl(value = '') {
    const raw = String(value || '').trim().replace(/\/+$/, '');
    if (!raw) return '';
    try {
        const url = new URL(raw);
        if (url.hostname.toLowerCase() === 'dormdish-api.onrender.com') url.hostname = 'dormdishmobile.onrender.com';
        const pathname = url.pathname.replace(/\/+$/, '');
        url.pathname = /\/api$/i.test(pathname) ? pathname : `${pathname}/api`;
        return url.toString().replace(/\/+$/, '');
    } catch {
        return raw;
    }
}
const publicApiUrl = normalizePublicApiUrl(process.env.PUBLIC_API_URL || '');
function getPublicApiUrl(_req) { return publicApiUrl || '/api'; }
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const verificationConfigured = () => Boolean(emailConfigured() && publicWebUrl);
async function sendVerificationMessage(user, rawToken) {
    if (!verificationConfigured()) throw new Error('Email verification is not configured. Set RESEND_API_KEY and EMAIL_FROM (recommended on Render Free), or SMTP_USER, SMTP_PASS, and PUBLIC_WEB_URL on a host that permits SMTP.');
    const link = `${publicWebUrl}/?verify=${encodeURIComponent(rawToken)}`;
    const safeName = String(user.name || 'there').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    await sendEmail({
        from: emailFrom,
        to: user.email,
        subject: 'Verify your DormDish account',
        text: `Hi ${user.name},\n\nVerify your DormDish account using this link (expires in 24 hours):\n${link}\n\nIf you did not request this email, you can ignore it.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#17231c"><h1>Verify your DormDish account</h1><p>Hi ${safeName},</p><p>Confirm your email address using the secure link below.</p><p><a href="${link}" style="display:inline-block;background:#176b45;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Verify account</a></p><p>This link expires in 24 hours. If you did not request it, ignore this email.</p></div>`
    });
}

function cleanUser(user) {
    if (!user) return user;
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
    if (req.user.role === 'store_manager' && order.store_id === userStoreId(req.user)) return true;
    res.status(403).json({ error: 'You can only manage orders from your assigned store.' });
    return false;
}

function canViewOrder(user, order) {
    if (user.role === 'customer') {
        return order.customer_id === user.id || Boolean(
            order.group_order_id &&
            db.prepare('SELECT 1 FROM group_order_members WHERE group_order_id = ? AND customer_id = ?')
                .get(order.group_order_id, user.id)
        );
    }

    if (user.role === 'store_manager') return order.store_id === userStoreId(user);
    if (user.role === 'rider') return order.rider_id === user.id && order.store_id === userStoreId(user);
    return false;
}

function parseProductPayload(body, partial = false) {
    const values = {};
    const allowed = [
        'name', 'description', 'category', 'price', 'oldPrice',
        'imageUrl', 'stock', 'isAvailable', 'promoPrice', 'promoLabel',
        'promoStartsAt', 'promoEndsAt', 'isPromoted'
    ];

    for (const field of allowed) {
        if (partial && !Object.hasOwn(body, field)) continue;
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

    if (!partial || Object.hasOwn(body, 'promoPrice')) {
        values.promoPrice = values.promoPrice === '' || values.promoPrice === null || values.promoPrice === undefined
            ? null
            : Number(values.promoPrice);
        if (values.promoPrice !== null && (!Number.isFinite(values.promoPrice) || values.promoPrice < 0)) {
            throw new Error('Enter a valid promotional price.');
        }
    }

    if (!partial || Object.hasOwn(body, 'promoLabel')) {
        values.promoLabel = typeof values.promoLabel === 'string' ? values.promoLabel.trim().slice(0, 80) : '';
    }

    for (const field of ['promoStartsAt', 'promoEndsAt']) {
        if (!partial || Object.hasOwn(body, field)) {
            const raw = values[field];
            if (raw === '' || raw === null || raw === undefined) {
                values[field] = null;
            } else {
                const parsed = Date.parse(raw);
                if (!Number.isFinite(parsed)) {
                    throw new Error('Enter a valid promotional start/end date.');
                }
                values[field] = new Date(parsed).toISOString();
            }
        }
    }

    if (!partial || Object.hasOwn(body, 'isPromoted')) {
        values.isPromoted = values.isPromoted === undefined ? values.promoPrice !== null : Boolean(values.isPromoted);
    }

    if (values.isPromoted && values.promoPrice === null) {
        throw new Error('Enter a promotional price or disable the promotion.');
    }

    if (values.promoPrice !== null && values.price !== undefined && values.promoPrice >= values.price) {
        throw new Error('Promotional price must be lower than the regular price.');
    }

    if (values.promoStartsAt && values.promoEndsAt && Date.parse(values.promoStartsAt) >= Date.parse(values.promoEndsAt)) {
        throw new Error('Promotion end time must be after its start time.');
    }

    return values;
}

function logTracking(orderId, updatedBy, status, note, locationLabel, etaAt) {
    db.prepare(`
        INSERT INTO tracking_updates (order_id, updated_by, status, note, location_label, eta_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(orderId, updatedBy, status, note, locationLabel || '', etaAt || null, new Date().toISOString());
}

const API_BUILD = 'dormdish-signup-addressbook-resend-https-2026-10-29';
app.get('/api/health', (req, res) => {
    res.json({
        ok: true,
        database: 'sqlite',
        service: 'dormdish-api',
        build: API_BUILD,
        loginRoutes: ['POST /api/auth/login', 'POST /auth/login'],
        signupRoutes: ['POST /api/auth/register', 'POST /auth/register'],
        features: ['demo-account-seeding','email-verification','email-provider-resend-api','customer-signup','saved-customer-addresses','address-map-picker','image-upload','rider-live-gps','rider-delivery-proof','rider-pickup-claims','store-manager-assignment','support-email','email-delivery-test','staff-account-creation','order-status-labels'],
        emailVerification: { configured: verificationConfigured(), emailProvider, emailConfigured: emailConfigured(), smtpConfigured: Boolean(mailer), publicWebUrlConfigured: Boolean(publicWebUrl), smtpHost: process.env.SMTP_HOST || 'smtp.gmail.com', smtpPort },
        supportEmail: { configured: Boolean(emailConfigured() && supportEmail), destination: supportEmail },
        timestamp: new Date().toISOString()
    });
});

// Auth
const loginHandler = (req, res) => {
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
};
app.post('/api/auth/login', loginHandler);
app.post('/auth/login', loginHandler);

// Customer signup
async function registerCustomer(req, res) {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const addressLabel = typeof req.body.addressLabel === 'string' ? req.body.addressLabel.trim().slice(0, 40) : 'Home';
    const recipientName = typeof req.body.recipientName === 'string' && req.body.recipientName.trim() ? req.body.recipientName.trim().slice(0, 100) : name;
    const contactNumber = typeof req.body.contactNumber === 'string' ? req.body.contactNumber.trim().slice(0, 30) : '';
    let addressText = typeof req.body.addressText === 'string' ? req.body.addressText.trim().slice(0, 300) : '';
    const instructions = typeof req.body.deliveryInstructions === 'string' ? req.body.deliveryInstructions.trim().slice(0, 500) : '';
    const latitude = req.body.latitude === '' || req.body.latitude == null ? null : Number(req.body.latitude);
    const longitude = req.body.longitude === '' || req.body.longitude == null ? null : Number(req.body.longitude);
    const hasCoordinates = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
    if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Enter your name (2–100 characters).' });
    if (!isValidEmail(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'Password must contain 8–128 characters.' });
    if (contactNumber.length < 5) return res.status(400).json({ error: 'Enter a valid contact number.' });
    if (!addressLabel) return res.status(400).json({ error: 'Give this address a name, such as Home or Dorm.' });
    if (addressText.length < 5 && !hasCoordinates) return res.status(400).json({ error: 'Enter your delivery address or choose a point on the map.' });
    if (!addressText && hasCoordinates) addressText = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    const createdAt = new Date().toISOString();
    let user;
    try {
        const create = db.transaction(() => {
            const insert = db.prepare(`INSERT INTO users(name,email,password_hash,role,store_id,created_at) VALUES(?,?,?,'customer',NULL,?)`)
                .run(name, email, bcrypt.hashSync(password, 12), createdAt);
            const userId = Number(insert.lastInsertRowid);
            db.prepare(`INSERT INTO customer_addresses(customer_id,address_label,recipient_name,contact_number,address_text,delivery_instructions,latitude,longitude,is_default,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,1,?,?)`).run(userId,addressLabel,recipientName,contactNumber,addressText,instructions,hasCoordinates?latitude:null,hasCoordinates?longitude:null,createdAt,createdAt);
            return db.prepare('SELECT id,name,email,role,store_id,is_active,is_online,profile_image_url,email_verified,created_at FROM users WHERE id=?').get(userId);
        });
        user = create();
    } catch (error) {
        if (String(error.message).toLowerCase().includes('unique')) return res.status(409).json({ error: 'That email address is already registered. Try signing in instead.' });
        console.error('Customer signup failed:', error.message);
        return res.status(500).json({ error: 'Could not create your account. Please try again.' });
    }
    let verificationEmailSent = false;
    let verificationMessage = 'Account created. Sign in and request an email verification link from your profile.';
    if (verificationConfigured()) {
        const rawToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        db.prepare('UPDATE users SET email_verification_token_hash=?,email_verification_expires_at=?,email_verification_sent_at=? WHERE id=?').run(sha256(rawToken),expiresAt,createdAt,user.id);
        try {
            await sendVerificationMessage(user, rawToken);
            verificationEmailSent = true;
            verificationMessage = `Verification email sent to ${user.email}.`;
        } catch (error) {
            db.prepare('UPDATE users SET email_verification_token_hash=NULL,email_verification_expires_at=NULL,email_verification_sent_at=NULL WHERE id=?').run(user.id);
            console.error('Signup verification email failed:', { provider: emailProvider, code: error.code || '', responseCode: error.responseCode || '', command: error.command || '', message: error.message || 'Unknown email error' });
            verificationMessage = `Account created, but verification email could not be sent (${error.code || 'EMAIL_ERROR'}). You can request another link from your profile after email delivery is configured.`;
        }
    }
    return res.status(201).json({ token: createToken(user), user, verificationEmailSent, verificationMessage });
}
app.post('/api/auth/register', registerCustomer);
app.post('/auth/register', registerCustomer);

app.get('/api/auth/me', requireAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ user: req.user });
});

app.patch('/api/auth/profile', requireAuth, (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : req.user.name;
    const profileImageUrl = Object.hasOwn(req.body, 'profileImageUrl') ? String(req.body.profileImageUrl || '').trim() : (req.user.profile_image_url || '');
    if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Name must contain between 2 and 100 characters.' });
    if (profileImageUrl.length > 500 || (profileImageUrl && !/^https:\/\//i.test(profileImageUrl) && !profileImageUrl.startsWith('/'))) return res.status(400).json({ error: 'Choose a valid profile photo.' });
    db.prepare('UPDATE users SET name = ?, profile_image_url = ? WHERE id = ?').run(name, profileImageUrl, req.user.id);
    const user = db.prepare('SELECT id,name,email,role,store_id,is_active,is_online,profile_image_url,email_verified,created_at FROM users WHERE id = ?').get(req.user.id);
    res.json({ user });
});

// Customer address book
function parseAddressPayload(body, fallback = {}) {
    const label = Object.hasOwn(body, 'addressLabel') ? String(body.addressLabel || '').trim().slice(0, 40) : fallback.address_label;
    const recipient = Object.hasOwn(body, 'recipientName') ? String(body.recipientName || '').trim().slice(0, 100) : fallback.recipient_name;
    const phone = Object.hasOwn(body, 'contactNumber') ? String(body.contactNumber || '').trim().slice(0, 30) : fallback.contact_number;
    const addressText = Object.hasOwn(body, 'addressText') ? String(body.addressText || '').trim().slice(0, 300) : fallback.address_text;
    const instructions = Object.hasOwn(body, 'deliveryInstructions') ? String(body.deliveryInstructions || '').trim().slice(0, 500) : fallback.delivery_instructions || '';
    const latRaw = Object.hasOwn(body, 'latitude') ? body.latitude : fallback.latitude;
    const lngRaw = Object.hasOwn(body, 'longitude') ? body.longitude : fallback.longitude;
    const latitude = latRaw === '' || latRaw == null ? null : Number(latRaw);
    const longitude = lngRaw === '' || lngRaw == null ? null : Number(lngRaw);
    const noCoordinates = latitude == null && longitude == null;
    const hasCoordinates = Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
    const coordinatesValid = noCoordinates || hasCoordinates;
    const savedAddressText = addressText.length >= 5 ? addressText : (hasCoordinates ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}` : addressText);
    if (!label || !recipient || phone.length < 5 || savedAddressText.length < 5 || !coordinatesValid) return { error: 'Enter an address name, recipient, valid contact number, delivery address or map pin, and valid coordinates.' };
    return { value: { address_label: label, recipient_name: recipient, contact_number: phone, address_text: savedAddressText, delivery_instructions: instructions, latitude: hasCoordinates ? latitude : null, longitude: hasCoordinates ? longitude : null, is_default: Object.hasOwn(body, 'isDefault') ? (body.isDefault ? 1 : 0) : Number(fallback.is_default || 0) } };
}
app.get('/api/customer/addresses', requireAuth, allowRoles('customer'), (req, res) => {
    const addresses = db.prepare('SELECT * FROM customer_addresses WHERE customer_id=? ORDER BY is_default DESC, id ASC').all(req.user.id);
    res.json({ addresses });
});
app.post('/api/customer/addresses', requireAuth, allowRoles('customer'), (req, res) => {
    const parsed = parseAddressPayload(req.body || {}, { address_label: 'Home', recipient_name: req.user.name, contact_number: '', address_text: '', delivery_instructions: '' });
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const value = parsed.value;
    const currentCount = Number(db.prepare('SELECT COUNT(*) AS count FROM customer_addresses WHERE customer_id=?').get(req.user.id).count);
    const makeDefault = value.is_default || currentCount === 0;
    const createdAt = new Date().toISOString();
    const create = db.transaction(() => {
        if (makeDefault) db.prepare('UPDATE customer_addresses SET is_default=0 WHERE customer_id=?').run(req.user.id);
        const info = db.prepare(`INSERT INTO customer_addresses(customer_id,address_label,recipient_name,contact_number,address_text,delivery_instructions,latitude,longitude,is_default,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(req.user.id,value.address_label,value.recipient_name,value.contact_number,value.address_text,value.delivery_instructions,value.latitude,value.longitude,makeDefault?1:0,createdAt,createdAt);
        return db.prepare('SELECT * FROM customer_addresses WHERE id=?').get(info.lastInsertRowid);
    });
    res.status(201).json({ address: create() });
});
app.patch('/api/customer/addresses/:id', requireAuth, allowRoles('customer'), (req, res) => {
    const current = db.prepare('SELECT * FROM customer_addresses WHERE id=? AND customer_id=?').get(Number(req.params.id),req.user.id);
    if (!current) return res.status(404).json({ error: 'Saved address not found.' });
    const parsed = parseAddressPayload(req.body || {}, current);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const value = parsed.value;
    const updatedAt = new Date().toISOString();
    const save = db.transaction(() => {
        if (value.is_default) db.prepare('UPDATE customer_addresses SET is_default=0 WHERE customer_id=?').run(req.user.id);
        db.prepare(`UPDATE customer_addresses SET address_label=?,recipient_name=?,contact_number=?,address_text=?,delivery_instructions=?,latitude=?,longitude=?,is_default=?,updated_at=? WHERE id=? AND customer_id=?`)
            .run(value.address_label,value.recipient_name,value.contact_number,value.address_text,value.delivery_instructions,value.latitude,value.longitude,value.is_default,updatedAt,current.id,req.user.id);
        return db.prepare('SELECT * FROM customer_addresses WHERE id=?').get(current.id);
    });
    res.json({ address: save() });
});
app.delete('/api/customer/addresses/:id', requireAuth, allowRoles('customer'), (req, res) => {
    const current = db.prepare('SELECT * FROM customer_addresses WHERE id=? AND customer_id=?').get(Number(req.params.id),req.user.id);
    if (!current) return res.status(404).json({ error: 'Saved address not found.' });
    const remove = db.transaction(() => {
        db.prepare('DELETE FROM customer_addresses WHERE id=? AND customer_id=?').run(current.id,req.user.id);
        if (Number(current.is_default)) {
            const next = db.prepare('SELECT id FROM customer_addresses WHERE customer_id=? ORDER BY id LIMIT 1').get(req.user.id);
            if (next) db.prepare('UPDATE customer_addresses SET is_default=1 WHERE id=?').run(next.id);
        }
    });
    remove();
    res.json({ success: true });
});

app.post('/api/auth/verification/send', requireAuth, async (req, res) => {
    const user = db.prepare('SELECT id,name,email,email_verified,email_verification_sent_at FROM users WHERE id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'Account not found.' });
    if (Number(user.email_verified)) return res.json({ success: true, alreadyVerified: true, message: 'Your email is already verified.' });
    if (!verificationConfigured()) return res.status(503).json({ error: 'Email verification is not configured. Set RESEND_API_KEY and EMAIL_FROM (recommended on Render Free), or SMTP_USER and SMTP_PASS on a host that permits SMTP.' });
    if (user.email_verification_sent_at && Date.now() - Date.parse(user.email_verification_sent_at) < 60000) return res.status(429).json({ error: 'Wait one minute before requesting another verification email.' });
    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE users SET email_verification_token_hash = ?, email_verification_expires_at = ?, email_verification_sent_at = ? WHERE id = ?').run(sha256(rawToken), expiresAt, new Date().toISOString(), user.id);
    try { await sendVerificationMessage(user, rawToken); }
    catch (error) {
        db.prepare('UPDATE users SET email_verification_token_hash = NULL, email_verification_expires_at = NULL, email_verification_sent_at = NULL WHERE id = ?').run(user.id);
        console.error('Could not send verification email:', { code: error.code || '', responseCode: error.responseCode || '', command: error.command || '', message: error.message || 'Unknown SMTP error' });
        const diagnostic = error.code || (error.responseCode ? `EMAIL_${error.responseCode}` : 'EMAIL_ERROR');
        return res.status(502).json({ error: `Could not send verification email (${diagnostic}). Check the email provider configuration and Render logs.` });
    }
    return res.json({ success: true, message: `Verification email sent to ${user.email}.` });
});

app.get('/api/auth/verify', (req, res) => {
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ error: 'That verification link is invalid or incomplete.' });
    const user = db.prepare('SELECT id,email,email_verification_expires_at FROM users WHERE email_verification_token_hash = ?').get(sha256(token));
    if (!user) return res.status(400).json({ error: 'This verification link is invalid or has already been used. Request a fresh link.' });
    if (!user.email_verification_expires_at || Date.parse(user.email_verification_expires_at) < Date.now()) {
        db.prepare('UPDATE users SET email_verification_token_hash = NULL, email_verification_expires_at = NULL WHERE id = ?').run(user.id);
        return res.status(410).json({ error: 'This verification link has expired. Sign in and request a new one.' });
    }
    db.prepare('UPDATE users SET email_verified = 1,email_verification_token_hash = NULL,email_verification_expires_at = NULL WHERE id = ?').run(user.id);
    const verifiedUser = db.prepare('SELECT id,name,email,role,store_id,is_active,is_online,profile_image_url,email_verified,created_at FROM users WHERE id = ?').get(user.id);
    res.set('Cache-Control', 'no-store');
    return res.json({
        success: true,
        emailVerified: Boolean(Number(verifiedUser?.email_verified)),
        user: verifiedUser,
        message: `Email ${user.email} verified successfully. Your account status is now updated.`
    });
});

// Support mail
function escapeMailHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}
app.post('/api/support', async (req, res) => {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const contactNumber = typeof req.body.contactNumber === 'string' ? req.body.contactNumber.trim() : '';
    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Enter your name (2–100 characters).' });
    if (contactNumber.length < 5 || contactNumber.length > 30) return res.status(400).json({ error: 'Enter a valid contact number.' });
    if (!isValidEmail(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (message.length < 10 || message.length > 4000) return res.status(400).json({ error: 'Your message must contain 10–4000 characters.' });
    if (!emailConfigured()) return res.status(503).json({ error: emailProvider === 'resend' ? 'Email is unavailable. Configure RESEND_API_KEY and EMAIL_FROM on the backend.' : 'Email is unavailable because SMTP_USER or SMTP_PASS is missing.' });
    if (!supportEmail || !isValidEmail(supportEmail)) return res.status(503).json({ error: 'SUPPORT_EMAIL must contain a valid email address.' });
    const safeName = escapeMailHtml(name);
    const safeEmail = escapeMailHtml(email);
    const safeNumber = escapeMailHtml(contactNumber);
    const safeMessage = escapeMailHtml(message).replace(/\r?\n/g, '<br>');
    try {
        await sendEmail({
            from: emailFrom,
            to: supportEmail,
            replyTo: email,
            subject: `[DormDish Support] ${name.replace(/[\r\n]+/g, ' ').slice(0, 80)}`,
            text: `DormDish support message\n\nName: ${name}\nContact number: ${contactNumber}\nEmail: ${email}\n\nMessage:\n${message}`,
            html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#17231c"><h2>DormDish Support Message</h2><p><strong>Name:</strong> ${safeName}</p><p><strong>Contact number:</strong> ${safeNumber}</p><p><strong>Email:</strong> ${safeEmail}</p><hr><p>${safeMessage}</p></div>`
        });
        return res.status(202).json({ success: true, message: 'Your message was sent to DormDish Support. We can reply to the email you provided.' });
    } catch (error) {
        const diagnostic = error.code || (error.responseCode ? `EMAIL_${error.responseCode}` : 'EMAIL_ERROR');
        console.error('Could not send support message:', { code: error.code || '', responseCode: error.responseCode || '', command: error.command || '', message: error.message || 'Unknown SMTP error' });
        return res.status(502).json({ error: `Could not send your message (${diagnostic}). Check the configured email provider and Render logs.` });
    }
});

// Email test
app.post('/api/admin/smtp-test', requireAuth, allowRoles('superadmin'), async (req, res) => {
    if (!emailConfigured()) return res.status(503).json({ error: emailProvider === 'resend' ? 'Set RESEND_API_KEY and EMAIL_FROM on the backend.' : 'Set SMTP_USER and SMTP_PASS on the backend, or configure Resend HTTPS API.' });
    if (!isValidEmail(smtpTestTo)) return res.status(503).json({ error: 'SMTP_TEST_TO or SUPPORT_EMAIL must be a valid email address.' });
    try {
        await verifyEmailTransport();
        await sendEmail({
            from: emailFrom,
            to: smtpTestTo,
            subject: `DormDish ${emailProvider.toUpperCase()} delivery test`,
            text: `This is a test email from DormDish using ${emailProvider} at ${new Date().toISOString()}.`
        });
        return res.json({ success: true, message: `${emailProvider.toUpperCase()} test email sent to ${smtpTestTo}. Check that inbox and spam folder.` });
    } catch (error) {
        const diagnostic = error.code || (error.responseCode ? `EMAIL_${error.responseCode}` : 'EMAIL_ERROR');
        const detail = String(error.message || 'Unknown email error').replace(/[\r\n]+/g, ' ').slice(0, 240);
        console.error('Email delivery test failed:', { provider: emailProvider, code: error.code || '', responseCode: error.responseCode || '', command: error.command || '', message: detail });
        return res.status(502).json({ error: `${emailProvider.toUpperCase()} test failed (${diagnostic}): ${detail}.` });
    }
});

app.get('/api/settings/public', (req, res) => {
    const rows = db.prepare(`
        SELECT setting_key, setting_value FROM app_settings
        WHERE setting_key IN (
            'delivery_fee', 'default_eta_minutes', 'campus_location',
            'student_discount_percent', 'group_discount_percent',
            'group_discount_min_members', 'group_discount_min_subtotal'
        )
    `).all();

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
        SELECT p.*, s.name AS store_name,
               (SELECT COALESCE(SUM(oi.quantity), 0)
                FROM order_items oi JOIN orders o ON o.id = oi.order_id
                WHERE oi.product_id = p.id AND o.status <> 'Cancelled') AS sold_count
        FROM products p JOIN stores s ON s.id = p.store_id
        WHERE p.store_id = ? AND p.is_available = 1 AND s.is_active = 1
        ORDER BY p.name COLLATE NOCASE
    `).all(store.id).map(withEffectiveProductPricing);

    res.json({ store, products });
});

app.get('/api/products', (req, res) => {
    const storeId = req.query.storeId ? Number(req.query.storeId) : null;
    const where = storeId ? 'WHERE p.store_id = ? AND s.is_active = 1' : 'WHERE s.is_active = 1';

    const products = db.prepare(`
        SELECT p.*, s.name AS store_name,
               (SELECT COALESCE(SUM(oi.quantity), 0)
                FROM order_items oi JOIN orders o ON o.id = oi.order_id
                WHERE oi.product_id = p.id AND o.status <> 'Cancelled') AS sold_count
        FROM products p JOIN stores s ON s.id = p.store_id
        ${where}
        ORDER BY p.store_id, p.name COLLATE NOCASE
    `).all(...(storeId ? [storeId] : [])).map(withEffectiveProductPricing);

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
        INSERT INTO products (
            store_id, name, description, category, price, old_price, promo_price,
            promo_label, promo_starts_at, promo_ends_at, is_promoted,
            image_url, stock, is_available, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        userStoreId(req.user), values.name, values.description, values.category || 'Meals',
        values.price, values.oldPrice, values.promoPrice, values.promoLabel || '',
        values.promoStartsAt, values.promoEndsAt, values.isPromoted ? 1 : 0,
        values.imageUrl || '/images/hero-food.png', values.stock,
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
        SET name = ?, description = ?, category = ?, price = ?, old_price = ?,
            promo_price = ?, promo_label = ?, promo_starts_at = ?, promo_ends_at = ?,
            is_promoted = ?, image_url = ?, stock = ?, is_available = ?
        WHERE id = ?
    `).run(
        values.name, values.description, values.category || 'Meals', values.price, values.oldPrice,
        values.promoPrice, values.promoLabel || '', values.promoStartsAt, values.promoEndsAt,
        values.isPromoted ? 1 : 0, values.imageUrl || '/images/hero-food.png',
        values.stock, values.isAvailable ? 1 : 0, product.id
    );

    res.json({ product: getProduct(product.id) });
});

app.get('/api/product-images/:id', (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'Product image not found.' });
    const image = db.prepare('SELECT mime_type, image_data FROM product_images WHERE id = ?').get(req.params.id);
    if (!image) return res.status(404).json({ error: 'Product image not found.' });
    res.set('Content-Type', image.mime_type);
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(image.image_data);
});

app.post('/api/uploads/products', requireAuth, allowRoles('store_manager'), (req, res) => {
    const { filename, mimeType, data } = req.body || {};
    const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
    if (typeof data !== 'string' || typeof mimeType !== 'string' || !supportedTypes.includes(mimeType)) {
        return res.status(400).json({ error: 'Choose a JPG, PNG, WEBP, or AVIF image.' });
    }
    const base64 = data.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
    if (!base64 || base64.length > 7 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
        return res.status(400).json({ error: 'Image must be smaller than 5 MB and use valid image data.' });
    }
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) {
        return res.status(400).json({ error: 'Image must be smaller than 5 MB.' });
    }
    const id = crypto.randomUUID();
    const safeName = String(filename || 'product-image').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || 'product-image';
    db.prepare('INSERT INTO product_images(id,mime_type,file_name,image_data,created_at) VALUES(?,?,?,?,?)').run(id, mimeType, safeName, bytes, new Date().toISOString());
    const apiBase = getPublicApiUrl(req);
    return res.status(201).json({ url: `${apiBase}/product-images/${id}`, imageId: id, storage: 'sqlite' });
});


// Media
app.get('/api/media/:id', (req, res) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'Image not found.' });
    const media = db.prepare('SELECT mime_type,image_data FROM uploaded_media WHERE id = ?').get(req.params.id);
    if (!media) return res.status(404).json({ error: 'Image not found.' });
    res.set('Content-Type', media.mime_type);
    res.set('Cache-Control', 'public, max-age=86400, immutable');
    res.set('X-Content-Type-Options', 'nosniff');
    return res.send(media.image_data);
});

app.post('/api/uploads/:kind', requireAuth, (req, res) => {
    const kind = req.params.kind === 'products' ? 'product' : req.params.kind;
    const rolesByKind = {
        product: ['store_manager'],
        store: ['superadmin', 'store_manager'],
        profile: ['superadmin', 'store_manager', 'customer', 'rider']
    };
    if (!rolesByKind[kind]) return res.status(404).json({ error: 'Unknown image upload type.' });
    if (!rolesByKind[kind].includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to upload this type of image.' });
    const { filename, mimeType, data } = req.body || {};
    const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
    if (typeof data !== 'string' || !supportedTypes.includes(mimeType)) return res.status(400).json({ error: 'Choose a JPG, PNG, WEBP, or AVIF image.' });
    const base64 = data.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
    if (!base64 || base64.length > 7 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return res.status(400).json({ error: 'Image must be smaller than 5 MB and use valid image data.' });
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Image must be smaller than 5 MB.' });
    const id = crypto.randomUUID();
    const safeName = String(filename || `${kind}-image`).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100) || `${kind}-image`;
    db.prepare('INSERT INTO uploaded_media(id,purpose,mime_type,file_name,image_data,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(id, kind, mimeType, safeName, bytes, req.user.id, new Date().toISOString());
    const apiBase = getPublicApiUrl(req);
    return res.status(201).json({ url: `${apiBase}/media/${id}`, imageId: id, storage: 'sqlite', purpose: kind });
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
        query = `
            SELECT id FROM orders
            WHERE customer_id = ?
               OR group_order_id IN (
                    SELECT gm.group_order_id
                    FROM group_order_members gm
                    WHERE gm.customer_id = ?
               )
            ORDER BY created_at DESC
        `;
        parameters = [req.user.id, req.user.id];
    } else if (req.user.role === 'store_manager') {
        query = 'SELECT id FROM orders WHERE store_id = ? ORDER BY created_at DESC';
        parameters = [userStoreId(req.user)];
    } else {
        query = 'SELECT id FROM orders WHERE rider_id = ? AND store_id = ? ORDER BY created_at DESC';
        parameters = [req.user.id, userStoreId(req.user)];
    }

    const orders = db.prepare(query).all(...parameters).map(({ id }) => {
        const order = getOrderDetails(id);

        if (req.user.role === 'customer') {
            order.rating = db.prepare(`
                SELECT id, score, review, created_at FROM ratings
                WHERE order_id = ? AND customer_id = ? AND is_visible = 1
            `).get(id, req.user.id) || null;
            order.can_rate = Number(order.customer_id) === Number(req.user.id);
        }

        return order;
    });

    res.json({ orders });
});

app.post('/api/orders', requireAuth, allowRoles('customer'), (req, res) => {
    const { storeId, items, deliveryAddress, paymentMethod, orderNotes } = req.body;
    const cleanOrderNotes = typeof orderNotes === 'string' ? orderNotes.trim().slice(0, 500) : '';
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

    const createOrder = db.transaction(() => {
        const selectedProducts = [];

        for (const [productId, quantity] of groupedItems) {
            const product = getProduct(productId);

            if (!product || product.store_id !== numericStoreId || !product.store_active || !product.is_available) {
                throw new Error('Your cart contains an unavailable item or an item from a different store.');
            }

            if (product.stock < quantity) {
                throw new Error(`${product.name} does not have enough stock for this quantity.`);
            }

            selectedProducts.push({ product, quantity });
        }

        const pricing = calculateOrderDiscounts(
            selectedProducts.map(({ product, quantity }) => ({ product, quantity }))
        );

        const deliveryFee = pricing.policy.deliveryFee;
        const total = Math.max(0, pricing.subtotal - pricing.discountTotal) + deliveryFee;
        // Pickup
        const orderId = `DD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
        const now = new Date().toISOString();

        db.prepare(`
            INSERT INTO orders (
                id, customer_id, store_id, rider_id, status, subtotal, delivery_fee,
                total, discount_total, student_discount, group_discount, group_order_id,
                payment_method, delivery_address, order_notes, created_at, updated_at
            )
            VALUES (?, ?, ?, NULL, 'Pending', ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
        `).run(
            orderId, req.user.id, numericStoreId,
            pricing.subtotal, deliveryFee, total, pricing.discountTotal,
            pricing.studentDiscount, pricing.groupDiscount,
            typeof paymentMethod === 'string' && paymentMethod.trim() ? paymentMethod.trim() : 'Cash on delivery',
            deliveryAddress.trim(), cleanOrderNotes, now, now
        );

        const insertItem = db.prepare(`
            INSERT INTO order_items (
                order_id, product_id, product_name, unit_price, quantity, line_total, ordered_by_customer_id
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        const decrementStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?');

        for (const { product, quantity } of selectedProducts) {
            insertItem.run(orderId, product.id, product.name, product.price, quantity, product.price * quantity, req.user.id);

            if (decrementStock.run(quantity, product.id, quantity).changes !== 1) {
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

    if (req.user.role === 'customer') {
        order.rating = db.prepare(`
            SELECT id, score, review, created_at FROM ratings
            WHERE order_id = ? AND customer_id = ? AND is_visible = 1
        `).get(order.id, req.user.id) || null;
        order.can_rate = Number(order.customer_id) === Number(req.user.id);
    }

    res.json({ order });
});


app.get('/api/orders/:id/location', requireAuth, (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (!canViewOrder(req.user, order)) return res.status(403).json({ error: 'You do not have access to this order.' });
    const location = db.prepare('SELECT order_id,rider_id,latitude,longitude,accuracy_m,recorded_at FROM rider_locations WHERE order_id = ?').get(order.id) || null;
    return res.json({ location, active: order.status === 'Out for Delivery' });
});

app.post('/api/orders/:id/location', requireAuth, allowRoles('rider'), (req, res) => {
    const order = db.prepare('SELECT id,rider_id,store_id,status FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (Number(order.rider_id) !== Number(req.user.id) || Number(order.store_id) !== userStoreId(req.user)) return res.status(403).json({ error: 'You can only share GPS for a delivery assigned to you.' });
    if (order.status !== 'Out for Delivery') return res.status(409).json({ error: 'Start the delivery before sharing your live location.' });
    const latitude = Number(req.body.latitude), longitude = Number(req.body.longitude);
    const accuracy = req.body.accuracyM == null ? null : Number(req.body.accuracyM);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) return res.status(400).json({ error: 'The device did not send valid GPS coordinates.' });
    const recordedAt = new Date().toISOString();
    db.prepare(`INSERT INTO rider_locations(order_id,rider_id,latitude,longitude,accuracy_m,recorded_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(order_id) DO UPDATE SET rider_id=excluded.rider_id,latitude=excluded.latitude,longitude=excluded.longitude,accuracy_m=excluded.accuracy_m,recorded_at=excluded.recorded_at`)
        .run(order.id, req.user.id, latitude, longitude, Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null, recordedAt);
    return res.json({ location: db.prepare('SELECT order_id,rider_id,latitude,longitude,accuracy_m,recorded_at FROM rider_locations WHERE order_id = ?').get(order.id) });
});

app.post('/api/orders/:id/delivery-proof', requireAuth, allowRoles('rider'), (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (Number(order.rider_id) !== Number(req.user.id) || Number(order.store_id) !== userStoreId(req.user)) return res.status(403).json({ error: 'Only the assigned rider can confirm this delivery.' });
    if (order.status !== 'Out for Delivery') return res.status(409).json({ error: 'Only an order already out for delivery can be completed.' });
    if (db.prepare('SELECT order_id FROM delivery_proofs WHERE order_id = ?').get(order.id)) return res.status(409).json({ error: 'This delivery already has a proof photo.' });
    const { filename, mimeType, data } = req.body || {};
    const supportedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];
    if (typeof data !== 'string' || !supportedTypes.includes(mimeType)) return res.status(400).json({ error: 'Take or choose a JPG, PNG, WEBP, or AVIF delivery photo.' });
    const base64 = data.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
    if (!base64 || base64.length > 7 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return res.status(400).json({ error: 'Delivery proof photo must be smaller than 5 MB.' });
    const bytes = Buffer.from(base64, 'base64');
    if (!bytes.length || bytes.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Delivery proof photo must be smaller than 5 MB.' });
    const mediaId = crypto.randomUUID(), now = new Date().toISOString();
    const safeName = String(filename || 'delivery-proof.jpg').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
    const update = db.transaction(() => {
        const latest = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
        if (!latest || latest.status !== 'Out for Delivery' || Number(latest.rider_id) !== Number(req.user.id)) throw new Error('The order changed. Refresh before confirming delivery.');
        db.prepare('INSERT INTO uploaded_media(id,purpose,mime_type,file_name,image_data,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?)').run(mediaId, 'delivery-proof', mimeType, safeName, bytes, req.user.id, now);
        db.prepare('INSERT INTO delivery_proofs(order_id,rider_id,media_id,delivered_at) VALUES(?,?,?,?)').run(order.id, req.user.id, mediaId, now);
        db.prepare("UPDATE orders SET status='Delivered',eta_minutes=0,eta_at=NULL,updated_at=? WHERE id=?").run(now, order.id);
        logTracking(order.id, req.user.id, 'Delivered', 'The rider confirmed delivery with a photo proof.', '', null);
    });
    try { update(); } catch (error) { return res.status(409).json({ error: error.message || 'Could not confirm delivery.' }); }
    const apiBase = getPublicApiUrl(req);
    return res.json({ success: true, deliveryProofUrl: `${apiBase}/media/${mediaId}`, order: getOrderDetails(order.id) });
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

    if (req.user.role === 'store_manager' && status === 'Out for Delivery' && order.status !== 'Out for Delivery') {
        return res.status(403).json({ error: 'Only the assigned rider can confirm pickup and start live GPS tracking.' });
    }

    if (status === 'Delivered') {
        return res.status(403).json({ error: 'Only the assigned rider can mark a delivery complete, and a photo proof is required.' });
    }

    if (req.user.role === 'rider') {
        const riderNext = order.status === 'Ready for Pickup' ? ['Out for Delivery'] : order.status === 'Out for Delivery' ? ['Out for Delivery'] : [];
        if (!riderNext.includes(status)) {
            return res.status(403).json({ error: 'Riders can move an assigned job from Ready for Pickup to Out for Delivery, then Delivered.' });
        }
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
                if (item.product_id !== null) restoreStock.run(item.quantity, item.product_id);
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

        logTracking(
            order.id,
            req.user.id,
            status,
            typeof note === 'string' && note.trim() ? note.trim() : defaultNotes[status] || 'Order progress updated.',
            typeof locationLabel === 'string' ? locationLabel.trim() : '',
            etaAt
        );
    });

    try {
        update();
        res.json({ order: getOrderDetails(order.id) });
    } catch (error) {
        res.status(400).json({ error: error.message || 'Could not update order progress.' });
    }
});

app.patch('/api/orders/:id/assign-rider', requireAuth, (req, res) => {
    return res.status(403).json({ error: 'Store staff cannot assign riders. Riders claim available pickups themselves.' });
});
app.post('/api/orders/:id/ratings', requireAuth, allowRoles('customer'), (req, res) => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND customer_id = ?')
        .get(req.params.id, req.user.id);

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

    const existing = db.prepare('SELECT id FROM ratings WHERE order_id = ? AND customer_id = ?')
        .get(order.id, req.user.id);

    if (existing) {
        db.prepare('UPDATE ratings SET score = ?, review = ?, created_at = ? WHERE id = ?')
            .run(score, review, new Date().toISOString(), existing.id);
        return res.json({ success: true });
    }

    db.prepare(`
        INSERT INTO ratings (store_id, customer_id, order_id, reviewer_name, score, review, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(order.store_id, req.user.id, order.id, req.user.name, score, review, new Date().toISOString());

    res.status(201).json({ success: true });
});

// Rider jobs
app.get('/api/rider/jobs', requireAuth, allowRoles('rider'), (req, res) => {
    const riderStoreId = userStoreId(req.user);
    const availableIds = db.prepare(`
        SELECT o.id FROM orders o
        WHERE o.store_id = ? AND o.status = 'Ready for Pickup' AND o.rider_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM rider_job_declines d WHERE d.order_id = o.id AND d.rider_id = ?)
        ORDER BY o.created_at
    `).all(riderStoreId, req.user.id);
    const activeIds = db.prepare("SELECT id FROM orders WHERE rider_id = ? AND store_id = ? AND status IN ('Ready for Pickup','Out for Delivery') ORDER BY created_at")
        .all(req.user.id, riderStoreId);
    const historyIds = db.prepare("SELECT id FROM orders WHERE rider_id = ? AND store_id = ? AND status IN ('Delivered','Cancelled') ORDER BY updated_at DESC LIMIT 100")
        .all(req.user.id, riderStoreId);
    res.json({
        isOnline: Boolean(req.user.is_online),
        available: availableIds.map(({ id }) => getOrderDetails(id)),
        active: activeIds.map(({ id }) => getOrderDetails(id)),
        history: historyIds.map(({ id }) => getOrderDetails(id))
    });
});

app.patch('/api/rider/availability', requireAuth, allowRoles('rider'), (req, res) => {
    const isOnline = Boolean(req.body.isOnline);
    db.prepare('UPDATE users SET is_online = ? WHERE id = ?').run(isOnline ? 1 : 0, req.user.id);
    const user = db.prepare('SELECT id, name, email, role, store_id, is_active, is_online, created_at FROM users WHERE id = ?').get(req.user.id);
    res.json({ isOnline: Boolean(user.is_online), user });
});

app.post('/api/orders/:id/accept-rider', requireAuth, allowRoles('rider'), (req, res) => {
    if (!req.user.is_online) return res.status(409).json({ error: 'Go online before accepting a delivery.' });
    const order = db.prepare("SELECT * FROM orders WHERE id = ? AND store_id = ? AND status = 'Ready for Pickup' AND rider_id IS NULL")
        .get(req.params.id, userStoreId(req.user));
    if (!order) return res.status(409).json({ error: 'This delivery is no longer available. Refresh your job list.' });
    const claim = db.prepare("UPDATE orders SET rider_id = ?, updated_at = ? WHERE id = ? AND rider_id IS NULL AND status = 'Ready for Pickup'")
        .run(req.user.id, new Date().toISOString(), order.id);
    if (claim.changes !== 1) return res.status(409).json({ error: 'This delivery was accepted by another rider. Refresh your job list.' });
    db.prepare('DELETE FROM rider_job_declines WHERE rider_id = ? AND order_id = ?').run(req.user.id, order.id);
    logTracking(order.id, req.user.id, 'Ready for Pickup', 'A rider accepted this delivery.', '', null);
    res.json({ order: getOrderDetails(order.id) });
});

app.post('/api/orders/:id/decline-rider', requireAuth, allowRoles('rider'), (req, res) => {
    const order = db.prepare("SELECT id, store_id, status, rider_id FROM orders WHERE id = ?").get(req.params.id);
    if (!order || order.store_id !== userStoreId(req.user) || order.status !== 'Ready for Pickup' || order.rider_id !== null) {
        return res.status(404).json({ error: 'This delivery is no longer available.' });
    }
    db.prepare('INSERT OR IGNORE INTO rider_job_declines (rider_id, order_id, created_at) VALUES (?, ?, ?)')
        .run(req.user.id, order.id, new Date().toISOString());
    res.json({ success: true });
});

app.get('/api/manager/riders', requireAuth, allowRoles('store_manager'), (req, res) => {
    const riders = db.prepare(`
        SELECT id, name, email, store_id
        FROM users
        WHERE role = 'rider' AND store_id = ? AND is_active = 1
        ORDER BY name
    `).all(userStoreId(req.user));

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
        ORDER BY CASE role
            WHEN 'superadmin' THEN 0
            WHEN 'store_manager' THEN 1
            WHEN 'rider' THEN 2
            ELSE 3
        END, name
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

    if (!['superadmin', 'store_manager', 'rider'].includes(role)) {
        return res.status(400).json({ error: 'New accounts must be Super Admin, Store Manager, or Delivery Rider accounts.' });
    }

    if (['store_manager', 'rider'].includes(role) && (!store_id || !getStoreById(store_id))) {
        return res.status(400).json({ error: 'Store managers and riders must be assigned to an existing store.' });
    }

    try {
        const result = db.prepare(`
            INSERT INTO users (name, email, password_hash, role, store_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(cleanName, cleanEmail, bcrypt.hashSync(password, 10), role, role === 'store_manager' || role === 'rider' ? store_id : null, new Date().toISOString());

        const user = db.prepare('SELECT id, name, email, role, store_id, is_active, created_at FROM users WHERE id = ?')
            .get(result.lastInsertRowid);

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
                db.prepare("UPDATE users SET store_id = NULL WHERE role = 'store_manager' AND store_id = ? AND id != ?")
                    .run(storeId, user.id);
            }

            db.prepare('UPDATE users SET name = ?, email = ?, role = ?, store_id = ?, is_active = ? WHERE id = ?')
                .run(name, email, role, role === 'store_manager' || role === 'rider' ? storeId : null, isActive ? 1 : 0, user.id);
        });

        updateUser();

        const updated = db.prepare('SELECT id, name, email, role, store_id, is_active, created_at FROM users WHERE id = ?')
            .get(user.id);

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
            db.prepare("UPDATE users SET store_id = NULL WHERE role = 'store_manager' AND store_id = ? AND id != ?")
                .run(store.id, manager.id);
            db.prepare("UPDATE users SET store_id = NULL WHERE role = 'store_manager' AND id = ? AND store_id IS NOT NULL")
                .run(manager.id);
            db.prepare('UPDATE users SET store_id = ? WHERE id = ?').run(store.id, manager.id);
        } else {
            db.prepare("UPDATE users SET store_id = NULL WHERE role = 'store_manager' AND store_id = ?")
                .run(store.id);
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

    const historicOrders = db.prepare('SELECT COUNT(*) AS count FROM orders WHERE store_id = ?')
        .get(store.id).count;

    if (historicOrders > 0) {
        db.prepare('UPDATE stores SET is_active = 0 WHERE id = ?').run(store.id);
        return res.json({ success: true, archived: true });
    }

    db.prepare('DELETE FROM stores WHERE id = ?').run(store.id);
    res.json({ success: true, archived: false });
});

app.get('/api/admin/settings', requireAuth, allowRoles('superadmin'), (req, res) => {
    const settings = Object.fromEntries(
        db.prepare('SELECT setting_key, setting_value FROM app_settings ORDER BY setting_key')
            .all()
            .map((item) => [item.setting_key, item.setting_value])
    );

    res.json({ settings });
});

app.patch('/api/admin/settings', requireAuth, allowRoles('superadmin'), (req, res) => {
    const allowed = new Set(['app_name', 'delivery_fee', 'default_eta_minutes', 'campus_location']);
    const now = new Date().toISOString();

    for (const [key, value] of Object.entries(req.body)) {
        if (!allowed.has(key) || value === null || value === undefined) continue;

        if (key === 'delivery_fee' && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
            return res.status(400).json({ error: 'Delivery fee must be a non-negative number.' });
        }

        if (key === 'default_eta_minutes' && (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 240)) {
            return res.status(400).json({ error: 'Default ETA must be between 0 and 240 minutes.' });
        }

        db.prepare(`
            INSERT INTO app_settings (setting_key, setting_value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(setting_key)
            DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at
        `).run(key, String(value), now);
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

registerGroupOrderRoutes(app, {
    db,
    requireAuth,
    allowRoles,
    getProduct,
    getOrderDetails,
    calculateOrderDiscounts,
    logTracking
});

// Fallback routes
app.use((req, res, next) => {
    if (/^\/(?:api|auth)(?:\/|$)/.test(req.path)) {
        return res.status(404).json({
            error: `API route not found: ${req.method} ${req.path}`,
            service: 'dormdish-api',
            build: API_BUILD
        });
    }
    return next();
});

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);

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