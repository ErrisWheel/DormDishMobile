import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4000);
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 24) {
  throw new Error('JWT_SECRET must be configured and contain at least 24 characters.');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for PostgreSQL mode.');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false },
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});
pool.on('error', (error) => console.error('Unexpected idle PostgreSQL client error:', error));

const app = express();
app.set('trust proxy', 1);
const statuses = ['Pending', 'Confirmed', 'Preparing', 'Ready for Pickup', 'Out for Delivery', 'Delivered', 'Cancelled'];
const nextStatuses = {
  Pending: ['Confirmed', 'Cancelled'], Confirmed: ['Preparing', 'Cancelled'],
  Preparing: ['Ready for Pickup', 'Cancelled'], 'Ready for Pickup': ['Out for Delivery', 'Cancelled'],
  'Out for Delivery': ['Delivered', 'Cancelled'], Delivered: [], Cancelled: []
};
const allowedRoles = new Set(['superadmin', 'store_manager', 'customer', 'rider']);
const roleOrder = "CASE role WHEN 'superadmin' THEN 0 WHEN 'store_manager' THEN 1 WHEN 'rider' THEN 2 ELSE 3 END";
const allowedSettings = new Set(['app_name', 'delivery_fee', 'default_eta_minutes', 'campus_location', 'student_discount_percent', 'group_discount_percent', 'group_discount_min_members', 'group_discount_min_subtotal']);

function normalizeOrigin(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  try {
    // CORS compares origins, not full URLs. URL.origin removes trailing paths, slashes, and query strings.
    return new URL(input).origin;
  } catch {
    return input.split(/[/?#]/, 1)[0].replace(/\/+$/, '');
  }
}

const configuredOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);
const corsOptions = {
  origin(origin, callback) {
    const requestOrigin = normalizeOrigin(origin);
    if (!origin || configuredOrigins.length === 0 || configuredOrigins.includes(requestOrigin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin is not allowed by CORS: ${requestOrigin}`));
  },
  credentials: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '8mb' }));

const run = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const query = (text, values = [], client = pool) => client.query(text, values);
const one = async (text, values = [], client = pool) => (await query(text, values, client)).rows[0] || null;
const many = async (text, values = [], client = pool) => (await query(text, values, client)).rows;
const nowIso = () => new Date().toISOString();
const idToken = () => `DD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
const groupToken = () => `DG-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

async function initializeSchema() {
  await pool.query(await fs.readFile(path.join(here, 'schema.postgres.sql'), 'utf8'));
  const defaults = [
    ['student_discount_percent', '5'], ['group_discount_percent', '5'],
    ['group_discount_min_members', '3'], ['group_discount_min_subtotal', '300'],
    ['delivery_fee', '20'], ['default_eta_minutes', '30'], ['campus_location', 'TIP Quezon City campus area']
  ];
  for (const [key, value] of defaults) {
    await query('INSERT INTO app_settings(setting_key, setting_value, updated_at) VALUES($1,$2,$3) ON CONFLICT(setting_key) DO NOTHING', [key, value, nowIso()]);
  }
  await seedInitialAdmin();
  if (process.env.SEED_SAMPLE_DATA === 'true') await seedSampleData();
}

async function seedInitialAdmin() {
  const email = String(process.env.INITIAL_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.INITIAL_ADMIN_PASSWORD || '';
  if (!email && !password) return;
  if (!email || !password || password.length < 12 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('INITIAL_ADMIN_EMAIL must be valid and INITIAL_ADMIN_PASSWORD must contain at least 12 characters.');
  }
  const exists = await one("SELECT id FROM users WHERE role='superadmin' AND is_active=1 LIMIT 1");
  if (exists) return;
  await query(
    'INSERT INTO users(name,email,password_hash,role,store_id,is_active,created_at) VALUES($1,$2,$3,$4,NULL,1,$5) ON CONFLICT(email) DO NOTHING',
    [String(process.env.INITIAL_ADMIN_NAME || 'DormDish Administrator').trim(), email, await bcrypt.hash(password, 12), 'superadmin', nowIso()]
  );
}

async function seedSampleData() {
  const count = Number((await one('SELECT COUNT(*)::int AS count FROM stores')).count);
  if (count > 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const now = nowIso();
    const stores = [
      ['Store Alpha', 'Fresh student meals, rice bowls, and campus favorites.', '/images/hero-food.png', 'Store Alpha, Quezon City', 'https://www.google.com/maps?cid=2385593826430662165&g_mp=CiVnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLkdldFBsYWNlEAMYASAF'],
      ['Store Beta', 'Quick snacks and comforting meals between classes.', '/images/cheese-pizza.png', 'TIP Quezon City campus area', 'https://www.google.com/maps/search/?api=1&query=TIP+Quezon+City'],
      ['Store Gamma', 'Affordable student meals with something for every craving.', '/images/tapsilog.png', 'TIP Quezon City campus area', 'https://www.google.com/maps/search/?api=1&query=TIP+Quezon+City']
    ];
    const storeIds = [];
    for (const item of stores) {
      const result = await client.query('INSERT INTO stores(name,description,image_url,location_name,maps_url,created_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [...item, now]);
      storeIds.push(result.rows[0].id);
    }
    const sampleProducts = [
      [0, 'Sizzling Sisig with Rice', 'Crispy, savory pork sisig served with steamed rice.', 'Rice Meals', 100, null, '/images/sisig.png', 23],
      [0, 'Tapsilog', 'Sweet beef tapa with garlic rice and egg.', 'Rice Meals', 90, null, '/images/tapsilog.png', 23],
      [0, 'Chicken Kare-Kare', 'Comforting kare-kare inspired sauce with tender chicken.', 'Rice Meals', 120, null, '/images/karekare.png', 15],
      [0, 'Beef Tapa Bowl', 'Tender beef tossed in a rich savory sauce.', 'Rice Meals', 115, null, '/images/beef-talpicao.png', 12],
      [1, 'Cheese Pizza', 'Golden baked pizza with melted cheese.', 'Snacks', 150, null, '/images/cheese-pizza.png', 8],
      [1, 'Pepperoni Pizza', 'A classic cheesy pizza with pepperoni slices.', 'Snacks', 170, null, '/images/pepperoni-pizza.png', 6],
      [1, 'Chicken Snack Box', 'Crispy chicken bites with a dip.', 'Snacks', 95, null, '/images/hero-food.png', 14],
      [2, 'Chicken Rice Bowl', 'A filling grilled chicken bowl for busy days.', 'Rice Meals', 105, null, '/images/karekare.png', 18],
      [2, 'Garlic Beef Bowl', 'Garlic beef with rice and fresh toppings.', 'Rice Meals', 125, null, '/images/beef-talpicao.png', 11],
      [2, 'Campus Combo', 'A student combo with a main and side.', 'Combos', 135, null, '/images/tapsilog.png', 9]
    ];
    for (const p of sampleProducts) {
      await client.query('INSERT INTO products(store_id,name,description,category,price,old_price,image_url,stock,is_available,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,1,$9)', [storeIds[p[0]], p[1], p[2], p[3], p[4], p[5], p[6], p[7], now]);
    }
    const initialRatings = [
      [0, 'Mika R.', 5, 'Quick service and satisfying portions.'], [0, 'Jon C.', 5, 'My go-to lunch between classes.'], [0, 'Ari S.', 4, 'Good meals at a fair price.'],
      [1, 'Sam P.', 4, 'Great snacks to share.'], [1, 'Lei M.', 4, 'Tasty and easy to order.'], [2, 'Nico D.', 5, 'Affordable and filling meals.'], [2, 'Bea T.', 3, 'Good portions, sometimes a wait.']
    ];
    for (const r of initialRatings) await client.query('INSERT INTO ratings(store_id,reviewer_name,score,review,created_at) VALUES($1,$2,$3,$4,$5)', [storeIds[r[0]], r[1], r[2], r[3], now]);
    const demoAccounts = [
      ['Alpha Store Manager', process.env.DEMO_MANAGER_ALPHA_EMAIL || 'manager.alpha@dormdish.test', process.env.DEMO_MANAGER_PASSWORD, 'store_manager', storeIds[0]],
      ['Beta Store Manager', process.env.DEMO_MANAGER_BETA_EMAIL || 'manager.beta@dormdish.test', process.env.DEMO_MANAGER_PASSWORD, 'store_manager', storeIds[1]],
      ['Gamma Store Manager', process.env.DEMO_MANAGER_GAMMA_EMAIL || 'manager.gamma@dormdish.test', process.env.DEMO_MANAGER_PASSWORD, 'store_manager', storeIds[2]],
      ['Campus Customer', process.env.DEMO_CUSTOMER_EMAIL || 'customer@dormdish.test', process.env.DEMO_CUSTOMER_PASSWORD, 'customer', null],
      ['Store Alpha Rider', process.env.DEMO_RIDER_EMAIL || 'rider@dormdish.test', process.env.DEMO_RIDER_PASSWORD, 'rider', storeIds[0]]
    ];
    for (const a of demoAccounts) {
      if (a[2] && a[2].length >= 8) {
        await client.query('INSERT INTO users(name,email,password_hash,role,store_id,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(email) DO NOTHING', [a[0], a[1].toLowerCase(), await bcrypt.hash(a[2], 10), a[3], a[4], now]);
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function cleanUser(user) {
  if (!user) return user;
  const { password_hash, ...safe } = user;
  return safe;
}
function validEmail(value) { return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()); }
function userStoreId(user) { return Number(user.store_id); }
function tokenFor(user) { return jwt.sign({ sub: user.id, role: user.role }, jwtSecret, { expiresIn: '12h' }); }
function auth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
  let payload;
  try { payload = jwt.verify(token, jwtSecret); } catch { return res.status(401).json({ error: 'Your session expired. Sign in again.' }); }
  return run(async (request, response, nextMiddleware) => {
    const user = await one('SELECT id,name,email,role,store_id,is_active,is_online,created_at FROM users WHERE id=$1', [payload.sub]);
    if (!user || !Number(user.is_active)) return response.status(401).json({ error: 'This account is unavailable.' });
    request.user = user;
    nextMiddleware();
  })(req, res, next);
}
function role(...roles) { return (req, res, next) => !req.user || !roles.includes(req.user.role) ? res.status(403).json({ error: 'You do not have permission to perform this action.' }) : next(); }
async function getStore(id, client = pool) { return one('SELECT * FROM stores WHERE id=$1', [Number(id)], client); }
async function getProduct(id, client = pool) {
  const product = await one('SELECT p.*, s.name AS store_name, s.is_active AS store_active FROM products p JOIN stores s ON s.id=p.store_id WHERE p.id=$1', [Number(id)], client);
  return effectiveProduct(product);
}
function effectiveProduct(product) {
  if (!product) return product;
  const now = Date.now();
  const starts = product.promo_starts_at ? Date.parse(product.promo_starts_at) : null;
  const ends = product.promo_ends_at ? Date.parse(product.promo_ends_at) : null;
  const hasPromo = Boolean(Number(product.is_promoted)) && product.promo_price != null && Number(product.promo_price) < Number(product.price);
  const active = hasPromo && (starts === null || !Number.isFinite(starts) || starts <= now) && (ends === null || !Number.isFinite(ends) || ends > now);
  const regular = Number(product.price);
  return { ...product, regular_price: regular, price: active ? Number(product.promo_price) : regular, old_price: active ? regular : product.old_price, promo_active: active, is_promoted: Boolean(Number(product.is_promoted)), is_available: Boolean(Number(product.is_available)), store_active: Boolean(Number(product.store_active)), promo_price: product.promo_price == null ? null : Number(product.promo_price) };
}
async function getPolicy(client = pool) {
  const rows = await many("SELECT setting_key,setting_value FROM app_settings WHERE setting_key IN ('student_discount_percent','group_discount_percent','group_discount_min_members','group_discount_min_subtotal','delivery_fee')", [], client);
  const v = Object.fromEntries(rows.map((r) => [r.setting_key, Number(r.setting_value)]));
  return { studentDiscountPercent: Number.isFinite(v.student_discount_percent) ? v.student_discount_percent : 5, groupDiscountPercent: Number.isFinite(v.group_discount_percent) ? v.group_discount_percent : 5, groupDiscountMinMembers: Number.isFinite(v.group_discount_min_members) ? v.group_discount_min_members : 3, groupDiscountMinSubtotal: Number.isFinite(v.group_discount_min_subtotal) ? v.group_discount_min_subtotal : 300, deliveryFee: Number.isFinite(v.delivery_fee) ? v.delivery_fee : 20 };
}
async function discounts(lines, members = 1, client = pool) {
  const policy = await getPolicy(client);
  const subtotal = Math.round(lines.reduce((sum, line) => sum + Number(line.product.price) * Number(line.quantity), 0) * 100) / 100;
  const eligible = lines.reduce((sum, line) => sum + (!line.product.promo_active ? Number(line.product.price) * Number(line.quantity) : 0), 0);
  const studentDiscount = Math.round(eligible * policy.studentDiscountPercent) / 100;
  const groupEligible = members >= policy.groupDiscountMinMembers && subtotal >= policy.groupDiscountMinSubtotal;
  const groupDiscount = groupEligible ? Math.round(Math.max(0, subtotal - studentDiscount) * policy.groupDiscountPercent) / 100 : 0;
  return { subtotal, studentDiscount: Math.round(studentDiscount * 100) / 100, groupDiscount: Math.round(groupDiscount * 100) / 100, discountTotal: Math.round((studentDiscount + groupDiscount) * 100) / 100, groupEligible, policy };
}
async function ratingSummary(storeId) {
  const r = await one('SELECT ROUND(AVG(score)::numeric,1) AS rating, COUNT(*)::int AS rating_count FROM ratings WHERE store_id=$1 AND is_visible=1', [storeId]);
  return { rating: r?.rating === null ? null : r?.rating, rating_count: Number(r?.rating_count || 0) };
}
async function getOrderDetails(id, client = pool) {
  const order = await one(`SELECT o.*, c.name AS customer_name, s.name AS store_name, s.location_name, s.maps_url, r.name AS rider_name
    FROM orders o JOIN users c ON c.id=o.customer_id JOIN stores s ON s.id=o.store_id LEFT JOIN users r ON r.id=o.rider_id WHERE o.id=$1`, [id], client);
  if (!order) return null;
  const [items, tracking, rating] = await Promise.all([
    many('SELECT oi.*, u.name AS ordered_by_name FROM order_items oi LEFT JOIN users u ON u.id=oi.ordered_by_customer_id WHERE oi.order_id=$1 ORDER BY oi.id', [id], client),
    many('SELECT t.*, u.name AS updated_by_name FROM tracking_updates t LEFT JOIN users u ON u.id=t.updated_by WHERE t.order_id=$1 ORDER BY t.created_at DESC,t.id DESC', [id], client),
    one('SELECT id,score,review,created_at FROM ratings WHERE order_id=$1 AND customer_id=$2 AND is_visible=1', [id, order.customer_id], client)
  ]);
  return { ...order, items, tracking, rating: rating || null };
}
async function logTracking(orderId, updatedBy, status, note, locationLabel = '', etaAt = null, client = pool) {
  await query('INSERT INTO tracking_updates(order_id,updated_by,status,note,location_label,eta_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [orderId, updatedBy, status, note || '', locationLabel || '', etaAt || null, nowIso()], client);
}
function parseProductPayload(body, partial = false) {
  const fields = ['name','description','category','price','oldPrice','imageUrl','stock','isAvailable','promoPrice','promoLabel','promoStartsAt','promoEndsAt','isPromoted'];
  const v = {};
  for (const k of fields) if (!partial || Object.hasOwn(body, k)) v[k] = body[k];
  if (!partial || Object.hasOwn(body,'name')) { if (typeof v.name !== 'string' || !v.name.trim()) throw new Error('Product name is required.'); v.name = v.name.trim(); }
  for (const k of ['description','category','imageUrl']) if (!partial || Object.hasOwn(body,k)) v[k] = typeof v[k] === 'string' ? v[k].trim() : '';
  if (!partial || Object.hasOwn(body,'price')) { v.price=Number(v.price); if (!Number.isFinite(v.price)||v.price<0) throw new Error('Enter a valid product price.'); }
  if (!partial || Object.hasOwn(body,'oldPrice')) { v.oldPrice=v.oldPrice===''||v.oldPrice==null?null:Number(v.oldPrice); if(v.oldPrice!==null&&(!Number.isFinite(v.oldPrice)||v.oldPrice<0)) throw new Error('Enter a valid old price.'); }
  if (!partial || Object.hasOwn(body,'stock')) { v.stock=Number(v.stock); if(!Number.isInteger(v.stock)||v.stock<0) throw new Error('Stock must be a whole number greater than or equal to zero.'); }
  if (!partial || Object.hasOwn(body,'isAvailable')) v.isAvailable = v.isAvailable === undefined ? true : Boolean(v.isAvailable);
  if (!partial || Object.hasOwn(body,'promoPrice')) { v.promoPrice=v.promoPrice===''||v.promoPrice==null?null:Number(v.promoPrice); if(v.promoPrice!==null&&(!Number.isFinite(v.promoPrice)||v.promoPrice<0)) throw new Error('Enter a valid promotional price.'); }
  if (!partial || Object.hasOwn(body,'promoLabel')) v.promoLabel=typeof v.promoLabel==='string'?v.promoLabel.trim().slice(0,80):'';
  for (const k of ['promoStartsAt','promoEndsAt']) if(!partial||Object.hasOwn(body,k)){const raw=v[k]; if(raw===''||raw==null)v[k]=null;else{const parsed=Date.parse(raw);if(!Number.isFinite(parsed))throw new Error('Enter a valid promotional start/end date.');v[k]=new Date(parsed).toISOString();}}
  if (!partial || Object.hasOwn(body,'isPromoted')) v.isPromoted=v.isPromoted===undefined?v.promoPrice!==null:Boolean(v.isPromoted);
  if(v.isPromoted&&v.promoPrice===null)throw new Error('Enter a promotional price or disable the promotion.');
  if(v.promoPrice!==null&&v.price!==undefined&&v.promoPrice>=v.price)throw new Error('Promotional price must be lower than the regular price.');
  if(v.promoStartsAt&&v.promoEndsAt&&Date.parse(v.promoStartsAt)>=Date.parse(v.promoEndsAt))throw new Error('Promotion end time must be after its start time.');
  return v;
}
async function canViewOrder(user, order) {
  if (user.role === 'customer') {
    if (Number(order.customer_id) === Number(user.id)) return true;
    if (order.group_order_id) return Boolean(await one('SELECT id FROM group_order_members WHERE group_order_id=$1 AND customer_id=$2', [order.group_order_id,user.id]));
    return false;
  }
  if (user.role === 'store_manager') return Number(order.store_id) === userStoreId(user);
  if (user.role === 'rider') return Number(order.rider_id) === Number(user.id) && Number(order.store_id) === userStoreId(user);
  return false;
}
async function requireManagerOrder(req,res,order) {
  if (req.user.role === 'store_manager' && Number(order.store_id) === userStoreId(req.user)) return true;
  res.status(403).json({ error: 'You can only manage orders from your assigned store.' });
  return false;
}

// Health and authentication.
app.get('/api/health', run(async (_req,res) => {
  await query('SELECT 1');
  res.json({ ok: true, database: 'postgresql', timestamp: nowIso() });
}));
app.post('/api/auth/login', run(async (req,res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!email || !password) return res.status(400).json({ error: 'Enter your email and password.' });
  const user = await one('SELECT * FROM users WHERE lower(email)=$1', [email]);
  if (!user || !Number(user.is_active) || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
  res.json({ token: tokenFor(user), user: cleanUser(user) });
}));
app.get('/api/auth/me', auth, run(async (req,res) => res.json({ user: req.user })));
app.patch('/api/auth/profile', auth, role('customer'), run(async (req,res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Name must contain between 2 and 100 characters.' });
  const user = await one('UPDATE users SET name=$1 WHERE id=$2 RETURNING id,name,email,role,store_id,is_active,is_online,created_at', [name,req.user.id]);
  res.json({ user });
}));
app.get('/api/settings/public', run(async (_req,res) => {
  const rows = await many("SELECT setting_key,setting_value FROM app_settings WHERE setting_key=ANY($1::text[])", [['delivery_fee','default_eta_minutes','campus_location','student_discount_percent','group_discount_percent','group_discount_min_members','group_discount_min_subtotal']]);
  res.json({ settings: Object.fromEntries(rows.map((r) => [r.setting_key,r.setting_value])) });
}));

app.get('/api/stores', run(async (_req,res) => {
  const stores = await many(`SELECT s.id,s.name,s.description,s.image_url,s.location_name,s.maps_url,s.is_active,
    ROUND(AVG(r.score)::numeric,1) AS rating,COUNT(DISTINCT r.id)::int AS rating_count,
    COUNT(DISTINCT CASE WHEN p.is_available=1 AND p.stock>0 THEN p.id END)::int AS product_count
    FROM stores s LEFT JOIN ratings r ON r.store_id=s.id AND r.is_visible=1 LEFT JOIN products p ON p.store_id=s.id
    WHERE s.is_active=1 GROUP BY s.id ORDER BY COALESCE(AVG(r.score),0) DESC,s.name`);
  res.json({ stores });
}));
app.get('/api/stores/:id/products', run(async (req,res) => {
  const store = await getStore(req.params.id);
  if (!store || !Number(store.is_active)) return res.status(404).json({ error: 'Store not found.' });
  const rows = await many(`SELECT p.*,s.name AS store_name,(SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=p.id AND o.status<>'Cancelled')::int AS sold_count
    FROM products p JOIN stores s ON s.id=p.store_id WHERE p.store_id=$1 AND p.is_available=1 AND s.is_active=1 ORDER BY p.name`, [store.id]);
  res.json({ store, products: rows.map(effectiveProduct) });
}));
app.get('/api/products', run(async (req,res) => {
  const storeId = req.query.storeId ? Number(req.query.storeId) : null;
  const rows = await many(`SELECT p.*,s.name AS store_name,(SELECT COALESCE(SUM(oi.quantity),0) FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE oi.product_id=p.id AND o.status<>'Cancelled')::int AS sold_count
    FROM products p JOIN stores s ON s.id=p.store_id WHERE s.is_active=1 AND ($1::bigint IS NULL OR p.store_id=$1) ORDER BY p.store_id,p.name`, [storeId]);
  res.json({ products: rows.map(effectiveProduct) });
}));
app.post('/api/products', auth, role('store_manager'), run(async (req,res) => {
  let v; try { v = parseProductPayload(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  const product = await one(`INSERT INTO products(store_id,name,description,category,price,old_price,promo_price,promo_label,promo_starts_at,promo_ends_at,is_promoted,image_url,stock,is_available,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [userStoreId(req.user),v.name,v.description,v.category||'Meals',v.price,v.oldPrice,v.promoPrice,v.promoLabel||'',v.promoStartsAt,v.promoEndsAt,v.isPromoted?1:0,v.imageUrl||'/images/hero-food.png',v.stock,v.isAvailable?1:0,nowIso()]);
  res.status(201).json({ product: await getProduct(product.id) });
}));
app.put('/api/products/:id', auth, role('store_manager'), run(async (req,res) => {
  const current = await getProduct(req.params.id);
  if (!current) return res.status(404).json({ error: 'Product not found.' });
  if (Number(current.store_id) !== userStoreId(req.user)) return res.status(403).json({ error: 'You can only manage products from your assigned store.' });
  let v; try { v = parseProductPayload(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
  await query(`UPDATE products SET name=$1,description=$2,category=$3,price=$4,old_price=$5,promo_price=$6,promo_label=$7,promo_starts_at=$8,promo_ends_at=$9,is_promoted=$10,image_url=$11,stock=$12,is_available=$13 WHERE id=$14`, [v.name,v.description,v.category||'Meals',v.price,v.oldPrice,v.promoPrice,v.promoLabel||'',v.promoStartsAt,v.promoEndsAt,v.isPromoted?1:0,v.imageUrl||'/images/hero-food.png',v.stock,v.isAvailable?1:0,current.id]);
  res.json({ product: await getProduct(current.id) });
}));
app.delete('/api/products/:id', auth, role('store_manager'), run(async (req,res) => {
  const current = await getProduct(req.params.id);
  if (!current) return res.status(404).json({ error: 'Product not found.' });
  if (Number(current.store_id) !== userStoreId(req.user)) return res.status(403).json({ error: 'You can only remove products from your assigned store.' });
  await query('DELETE FROM products WHERE id=$1', [current.id]);
  res.json({ success: true });
}));

// Public product-photo reads come directly from PostgreSQL BYTEA storage.
app.get('/api/product-images/:id', run(async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'Product image not found.' });
  const image = await one('SELECT mime_type, image_data FROM product_images WHERE id=$1', [req.params.id]);
  if (!image) return res.status(404).json({ error: 'Product image not found.' });
  res.set('Content-Type', image.mime_type);
  res.set('Cache-Control', 'public, max-age=86400');
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(image.image_data);
}));

// Product photos are stored as binary data in Neon PostgreSQL, not on Render's ephemeral disk.
app.post('/api/uploads/products', auth, role('store_manager'), run(async (req,res) => {
  const { filename, mimeType, data } = req.body || {};
  const supportedTypes = ['image/jpeg','image/png','image/webp','image/avif'];
  if (typeof data !== 'string' || typeof mimeType !== 'string' || !supportedTypes.includes(mimeType)) return res.status(400).json({ error: 'Choose a JPG, PNG, WEBP, or AVIF image.' });
  const base64 = data.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!base64 || base64.length > 7 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) return res.status(400).json({ error: 'Image must be smaller than 5 MB and use valid image data.' });
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Image must be smaller than 5 MB.' });
  const id = crypto.randomUUID();
  const safeName = String(filename || 'product-image').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0,100) || 'product-image';
  await query('INSERT INTO product_images(id,mime_type,file_name,image_data,created_at) VALUES($1,$2,$3,$4,$5)', [id, mimeType, safeName, bytes, nowIso()]);
  const apiBase = String(process.env.PUBLIC_API_URL || `${req.protocol}://${req.get('host')}/api`).replace(/\/+$/, '');
  res.status(201).json({ url: `${apiBase}/product-images/${id}`, imageId: id, storage: 'postgresql' });
}));

// Customer orders, manager orders, and rider jobs.
app.get('/api/orders', auth, run(async (req,res) => {
  if (req.user.role === 'superadmin') return res.status(403).json({ error: 'Super Admin does not have order-management access.' });
  let rows;
  if (req.user.role === 'customer') rows = await many(`SELECT id FROM orders WHERE customer_id=$1 OR group_order_id IN(SELECT group_order_id FROM group_order_members WHERE customer_id=$1) ORDER BY created_at DESC`, [req.user.id]);
  else if (req.user.role === 'store_manager') rows = await many('SELECT id FROM orders WHERE store_id=$1 ORDER BY created_at DESC', [userStoreId(req.user)]);
  else rows = await many('SELECT id FROM orders WHERE rider_id=$1 AND store_id=$2 ORDER BY created_at DESC', [req.user.id,userStoreId(req.user)]);
  const orders = await Promise.all(rows.map(async ({id}) => {
    const o = await getOrderDetails(id);
    if (req.user.role === 'customer') { o.rating = await one('SELECT id,score,review,created_at FROM ratings WHERE order_id=$1 AND customer_id=$2 AND is_visible=1',[id,req.user.id]); o.can_rate = Number(o.customer_id) === Number(req.user.id); }
    return o;
  }));
  res.json({ orders });
}));
app.post('/api/orders', auth, role('customer'), run(async (req,res) => {
  const storeId = Number(req.body.storeId); const address = typeof req.body.deliveryAddress==='string'?req.body.deliveryAddress.trim():'';
  const store = await getStore(storeId);
  if (!store || !Number(store.is_active)) return res.status(400).json({ error: 'Choose an available store.' });
  if (!Array.isArray(req.body.items) || !req.body.items.length) return res.status(400).json({ error: 'Add at least one item before placing an order.' });
  if (address.length < 3) return res.status(400).json({ error: 'Enter a delivery location.' });
  const grouped = new Map();
  for (const item of req.body.items) { const pid=Number(item.productId), qty=Number(item.quantity); if(!Number.isInteger(pid)||!Number.isInteger(qty)||qty<1||qty>50)return res.status(400).json({error:'Each item must have a valid product and quantity.'}); grouped.set(pid,(grouped.get(pid)||0)+qty); }
  const client = await pool.connect(); let orderId;
  try {
    await client.query('BEGIN'); const selected=[];
    for (const [pid,qty] of grouped) {
      const product = await getProduct(pid,client);
      if(!product||Number(product.store_id)!==storeId||!product.store_active||!product.is_available) throw new Error('Your cart contains an unavailable item or an item from a different store.');
      const locked = await one('SELECT stock FROM products WHERE id=$1 FOR UPDATE',[pid],client);
      if(!locked||Number(locked.stock)<qty)throw new Error(`${product.name} does not have enough stock for this quantity.`);
      selected.push({product,quantity:qty});
    }
    const pricing = await discounts(selected.map(({product,quantity})=>({product,quantity})),1,client);
    const deliveryFee=pricing.policy.deliveryFee, total=Math.max(0,pricing.subtotal-pricing.discountTotal)+deliveryFee;
    // Leave new orders unassigned so online riders can accept the offer.
    orderId=idToken(); const now=nowIso();
    await query(`INSERT INTO orders(id,customer_id,store_id,rider_id,status,subtotal,delivery_fee,total,discount_total,student_discount,group_discount,group_order_id,payment_method,delivery_address,order_notes,created_at,updated_at)
      VALUES($1,$2,$3,NULL,'Pending',$4,$5,$6,$7,$8,$9,NULL,$10,$11,$12,$13,$13)`,[orderId,req.user.id,storeId,pricing.subtotal,deliveryFee,total,pricing.discountTotal,pricing.studentDiscount,pricing.groupDiscount,typeof req.body.paymentMethod==='string'&&req.body.paymentMethod.trim()?req.body.paymentMethod.trim():'Cash on delivery',address,typeof req.body.orderNotes==='string'?req.body.orderNotes.trim().slice(0,500):'',now],client);
    for(const {product,quantity} of selected){await query('INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity,line_total,ordered_by_customer_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[orderId,product.id,product.name,product.price,quantity,product.price*quantity,req.user.id],client); const updated=await query('UPDATE products SET stock=stock-$1 WHERE id=$2 AND stock >= $1',[quantity,product.id],client); if(updated.rowCount!==1)throw new Error(`${product.name} has just run out of stock. Refresh and try again.`);}
    await logTracking(orderId,req.user.id,'Pending','Order placed. Waiting for store confirmation.',store.location_name,null,client);
    await client.query('COMMIT'); res.status(201).json({order:await getOrderDetails(orderId)});
  } catch(error){ await client.query('ROLLBACK'); return res.status(400).json({error:error.message||'The order could not be placed.'}); } finally {client.release();}
}));
app.get('/api/orders/:id', auth, run(async (req,res) => {
  if(req.user.role==='superadmin')return res.status(403).json({error:'Super Admin does not have order-management access.'});
  const order=await getOrderDetails(req.params.id); if(!order)return res.status(404).json({error:'Order not found.'});
  if(!await canViewOrder(req.user,order))return res.status(403).json({error:'You do not have access to this order.'});
  if(req.user.role==='customer'){order.rating=await one('SELECT id,score,review,created_at FROM ratings WHERE order_id=$1 AND customer_id=$2 AND is_visible=1',[order.id,req.user.id]);order.can_rate=Number(order.customer_id)===Number(req.user.id);}
  res.json({order});
}));
app.patch('/api/orders/:id/progress', auth, role('store_manager','rider'), run(async(req,res)=>{
  const order=await one('SELECT * FROM orders WHERE id=$1',[req.params.id]);if(!order)return res.status(404).json({error:'Order not found.'});
  if(req.user.role==='store_manager'&&!await requireManagerOrder(req,res,order))return;
  if(req.user.role==='rider'&&(Number(order.rider_id)!==Number(req.user.id)||Number(order.store_id)!==userStoreId(req.user)))return res.status(403).json({error:'You can only update deliveries assigned to you at your store.'});
  const {status,note,locationLabel}=req.body;const etaWasIncluded=Object.hasOwn(req.body,'etaMinutes');const etaMinutes=etaWasIncluded&&req.body.etaMinutes!==null&&req.body.etaMinutes!==''?Number(req.body.etaMinutes):null;
  if(!statuses.includes(status))return res.status(400).json({error:'Choose a valid order status.'});
  if(req.user.role==='rider'){
    const riderTransitions = order.status==='Ready for Pickup' ? ['Out for Delivery'] : order.status==='Out for Delivery' ? ['Delivered'] : [];
    if(!riderTransitions.includes(status))return res.status(403).json({error:'Riders can move an assigned job from Ready for Pickup to Out for Delivery, then Delivered.'});
  } else if(!nextStatuses[order.status].includes(status)&&order.status!==status)return res.status(400).json({error:`Status cannot move from ${order.status} to ${status}.`});
  if(etaMinutes!==null&&(!Number.isInteger(etaMinutes)||etaMinutes<0||etaMinutes>240))return res.status(400).json({error:'ETA must be between 0 and 240 minutes.'});
  if(status!==order.status&&order.status==='Cancelled')return res.status(400).json({error:'Cancelled orders cannot be changed.'});
  const client=await pool.connect();
  try{await client.query('BEGIN');
    const lockedOrder=await one('SELECT * FROM orders WHERE id=$1 FOR UPDATE',[req.params.id],client);
    if(!lockedOrder){await client.query('ROLLBACK');return res.status(404).json({error:'Order not found.'});}
    if(lockedOrder.status!==order.status||String(lockedOrder.rider_id??'')!==String(order.rider_id??'')||Number(lockedOrder.store_id)!==Number(order.store_id)){
      await client.query('ROLLBACK');return res.status(409).json({error:'This order changed while you were updating it. Refresh and try again.'});
    }
    let etaAt=etaWasIncluded?(etaMinutes===null?null:new Date(Date.now()+etaMinutes*60000).toISOString()):lockedOrder.eta_at;let storedEta=etaWasIncluded?etaMinutes:lockedOrder.eta_minutes;if(status==='Delivered'){etaAt=null;storedEta=0;}
    await query('UPDATE orders SET status=$1,eta_minutes=$2,eta_at=$3,updated_at=$4 WHERE id=$5',[status,storedEta,etaAt,nowIso(),lockedOrder.id],client);
    if(status==='Cancelled'&&order.status!=='Cancelled'){const items=await many('SELECT product_id,quantity FROM order_items WHERE order_id=$1',[order.id],client);for(const item of items)if(item.product_id!==null)await query('UPDATE products SET stock=stock+$1 WHERE id=$2',[item.quantity,item.product_id],client);}
    const notes={Confirmed:'The store confirmed your order.',Preparing:'The store is preparing your order.','Ready for Pickup':'Your order is ready for the rider.','Out for Delivery':'Your order is on the way.',Delivered:'Your delivery has been marked complete.',Cancelled:'The order was cancelled.'};
    await logTracking(order.id,req.user.id,status,typeof note==='string'&&note.trim()?note.trim():notes[status]||'Order progress updated.',typeof locationLabel==='string'?locationLabel.trim():'',etaAt,client);await client.query('COMMIT');res.json({order:await getOrderDetails(order.id)});
  }catch(error){await client.query('ROLLBACK');res.status(400).json({error:error.message||'Could not update order progress.'});}finally{client.release();}
}));
app.patch('/api/orders/:id/assign-rider', auth, role('store_manager'), run(async(req,res)=>{
  const order=await one('SELECT * FROM orders WHERE id=$1',[req.params.id]);if(!order)return res.status(404).json({error:'Order not found.'});if(!await requireManagerOrder(req,res,order))return;
  const riderId=req.body.riderId===null||req.body.riderId===''?null:Number(req.body.riderId);let rider=null;
  if(riderId!==null){rider=await one("SELECT id,name,store_id FROM users WHERE id=$1 AND role='rider' AND is_active=1",[riderId]);if(!rider||Number(rider.store_id)!==Number(order.store_id))return res.status(400).json({error:'Choose an active rider assigned to your store.'});}
  await query('UPDATE orders SET rider_id=$1,updated_at=$2 WHERE id=$3',[riderId,nowIso(),order.id]);await logTracking(order.id,req.user.id,order.status,rider?`Assigned to ${rider.name}.`:'Rider assignment removed.','',order.eta_at);res.json({order:await getOrderDetails(order.id)});
}));
app.post('/api/orders/:id/ratings', auth, role('customer'), run(async(req,res)=>{
  const order=await one('SELECT * FROM orders WHERE id=$1 AND customer_id=$2',[req.params.id,req.user.id]);if(!order)return res.status(404).json({error:'Order not found.'});if(order.status!=='Delivered')return res.status(400).json({error:'You can rate the store after the order is delivered.'});
  const score=Number(req.body.score), review=typeof req.body.review==='string'?req.body.review.trim().slice(0,1000):'';if(!Number.isInteger(score)||score<1||score>5)return res.status(400).json({error:'Choose a rating from 1 to 5.'});
  await query(`INSERT INTO ratings(store_id,customer_id,order_id,reviewer_name,score,review,created_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(order_id,customer_id) WHERE order_id IS NOT NULL AND customer_id IS NOT NULL DO UPDATE SET score=EXCLUDED.score,review=EXCLUDED.review,created_at=EXCLUDED.created_at`,[order.store_id,req.user.id,order.id,req.user.name,score,review,nowIso()]);res.status(201).json({success:true});
}));
app.get('/api/rider/jobs', auth, role('rider'), run(async(req,res)=>{
  const available=await many(`SELECT o.id FROM orders o WHERE o.store_id=$1 AND o.status='Ready for Pickup' AND o.rider_id IS NULL AND NOT EXISTS(SELECT 1 FROM rider_job_declines d WHERE d.order_id=o.id AND d.rider_id=$2) ORDER BY o.created_at`,[userStoreId(req.user),req.user.id]);
  const active=await many("SELECT id FROM orders WHERE rider_id=$1 AND store_id=$2 AND status IN ('Ready for Pickup','Out for Delivery') ORDER BY created_at",[req.user.id,userStoreId(req.user)]);
  const history=await many("SELECT id FROM orders WHERE rider_id=$1 AND store_id=$2 AND status IN ('Delivered','Cancelled') ORDER BY updated_at DESC LIMIT 100",[req.user.id,userStoreId(req.user)]);
  res.json({isOnline:Boolean(Number(req.user.is_online)),available:await Promise.all(available.map(x=>getOrderDetails(x.id))),active:await Promise.all(active.map(x=>getOrderDetails(x.id))),history:await Promise.all(history.map(x=>getOrderDetails(x.id)))});
}));
app.patch('/api/rider/availability', auth, role('rider'), run(async(req,res)=>{
  const isOnline=Boolean(req.body.isOnline);await query('UPDATE users SET is_online=$1 WHERE id=$2',[isOnline?1:0,req.user.id]);const user=await one('SELECT id,name,email,role,store_id,is_active,is_online,created_at FROM users WHERE id=$1',[req.user.id]);res.json({isOnline:Boolean(Number(user.is_online)),user});
}));
app.post('/api/orders/:id/accept-rider', auth, role('rider'), run(async(req,res)=>{
  const client=await pool.connect();try{await client.query('BEGIN');const rider=await one('SELECT * FROM users WHERE id=$1 FOR UPDATE',[req.user.id],client);if(!rider||!Number(rider.is_online)) {await client.query('ROLLBACK');return res.status(409).json({error:'Go online before accepting a delivery.'});}
    const assigned=await query("UPDATE orders SET rider_id=$1,updated_at=$2 WHERE id=$3 AND store_id=$4 AND status='Ready for Pickup' AND rider_id IS NULL RETURNING id",[req.user.id,nowIso(),req.params.id,rider.store_id],client);
    if(!assigned.rowCount){await client.query('ROLLBACK');return res.status(409).json({error:'This delivery is no longer available. Refresh your job list.'});}
    await query('DELETE FROM rider_job_declines WHERE rider_id=$1 AND order_id=$2',[req.user.id,req.params.id],client);await logTracking(req.params.id,req.user.id,'Ready for Pickup','A rider accepted this delivery.','',null,client);await client.query('COMMIT');res.json({order:await getOrderDetails(req.params.id)});
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}));
app.post('/api/orders/:id/decline-rider', auth, role('rider'), run(async(req,res)=>{
  const order=await one("SELECT id,store_id,status,rider_id FROM orders WHERE id=$1",[req.params.id]);if(!order||Number(order.store_id)!==userStoreId(req.user)||order.status!=='Ready for Pickup'||order.rider_id!==null)return res.status(404).json({error:'This delivery is no longer available.'});
  await query('INSERT INTO rider_job_declines(rider_id,order_id,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[req.user.id,order.id,nowIso()]);res.json({success:true});
}));
app.get('/api/manager/riders', auth, role('store_manager'), run(async(req,res)=>{const riders=await many("SELECT id,name,email,store_id,is_online FROM users WHERE role='rider' AND store_id=$1 AND is_active=1 ORDER BY name",[userStoreId(req.user)]);res.json({riders});}));
app.get('/api/manager/ratings', auth, role('store_manager'), run(async(req,res)=>{const ratings=await many('SELECT id,reviewer_name,score,review,created_at FROM ratings WHERE store_id=$1 AND is_visible=1 ORDER BY created_at DESC,id DESC',[userStoreId(req.user)]);res.json({ratings,summary:await ratingSummary(userStoreId(req.user))});}));

// Super-admin account and store management.
app.get('/api/admin/users', auth, role('superadmin'), run(async(_req,res)=>{res.json({users:await many(`SELECT id,name,email,role,store_id,is_active,is_online,created_at FROM users ORDER BY ${roleOrder},name`)});}));
app.post('/api/admin/users', auth, role('superadmin'), run(async(req,res)=>{
  const name=typeof req.body.name==='string'?req.body.name.trim():'';const email=typeof req.body.email==='string'?req.body.email.trim().toLowerCase():'';const password=req.body.password;const roleName=req.body.role;const storeId=req.body.storeId==null||req.body.storeId===''?null:Number(req.body.storeId);
  if(!name||!validEmail(email)||typeof password!=='string'||password.length<8)return res.status(400).json({error:'Enter a name, valid email, and password with at least 8 characters.'});if(!allowedRoles.has(roleName))return res.status(400).json({error:'Choose a valid role.'});
  if(['store_manager','rider'].includes(roleName)&&(!storeId||!await getStore(storeId)))return res.status(400).json({error:'Store managers and riders must be assigned to an existing store.'});
  try{const user=await one('INSERT INTO users(name,email,password_hash,role,store_id,created_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,name,email,role,store_id,is_active,is_online,created_at',[name,email,await bcrypt.hash(password,10),roleName,['store_manager','rider'].includes(roleName)?storeId:null,nowIso()]);res.status(201).json({user});}catch(e){if(e.code==='23505')return res.status(409).json({error:'That email address is already registered.'});throw e;}
}));
app.patch('/api/admin/users/:id', auth, role('superadmin'), run(async(req,res)=>{
  const current=await one('SELECT * FROM users WHERE id=$1',[Number(req.params.id)]);if(!current)return res.status(404).json({error:'Account not found.'});
  const name=Object.hasOwn(req.body,'name')?String(req.body.name).trim():current.name;const email=Object.hasOwn(req.body,'email')?String(req.body.email).trim().toLowerCase():current.email;const newRole=Object.hasOwn(req.body,'role')?req.body.role:current.role;const active=Object.hasOwn(req.body,'isActive')?Boolean(req.body.isActive):Boolean(Number(current.is_active));const rawStore=Object.hasOwn(req.body,'storeId')?req.body.storeId:current.store_id;const storeId=rawStore==null||rawStore===''?null:Number(rawStore);
  if(!name||!validEmail(email)||!allowedRoles.has(newRole))return res.status(400).json({error:'Enter a valid name, email, and role.'});if(['store_manager','rider'].includes(newRole)&&(!storeId||!await getStore(storeId)))return res.status(400).json({error:'Store managers and riders must be assigned to an existing store.'});
  if(current.role==='superadmin'&&(newRole!=='superadmin'||!active)){const cnt=Number((await one("SELECT COUNT(*)::int AS count FROM users WHERE role='superadmin' AND is_active=1")).count);if(cnt<=1)return res.status(400).json({error:'At least one active Super Admin must remain.'});}
  const client=await pool.connect();try{await client.query('BEGIN');if(newRole==='store_manager'&&storeId!==null)await query("UPDATE users SET store_id=NULL WHERE role='store_manager' AND store_id=$1 AND id<>$2",[storeId,current.id],client);await query('UPDATE users SET name=$1,email=$2,role=$3,store_id=$4,is_active=$5 WHERE id=$6',[name,email,newRole,['store_manager','rider'].includes(newRole)?storeId:null,active?1:0,current.id],client);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');if(e.code==='23505')return res.status(409).json({error:'That email address is already registered.'});throw e;}finally{client.release();}
  res.json({user:await one('SELECT id,name,email,role,store_id,is_active,is_online,created_at FROM users WHERE id=$1',[current.id])});
}));
app.get('/api/admin/stores', auth, role('superadmin'), run(async(_req,res)=>{const stores=await many(`SELECT s.*,m.id AS manager_id,m.name AS manager_name,m.email AS manager_email,ROUND((SELECT AVG(score) FROM ratings r WHERE r.store_id=s.id AND r.is_visible=1)::numeric,1) AS rating,(SELECT COUNT(*)::int FROM ratings r WHERE r.store_id=s.id AND r.is_visible=1) AS rating_count FROM stores s LEFT JOIN users m ON m.store_id=s.id AND m.role='store_manager' ORDER BY s.id`);res.json({stores});}));
app.post('/api/admin/stores', auth, role('superadmin'), run(async(req,res)=>{const name=typeof req.body.name==='string'?req.body.name.trim():'';if(!name)return res.status(400).json({error:'Store name is required.'});const s=await one('INSERT INTO stores(name,description,image_url,location_name,maps_url,created_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[name,String(req.body.description||'').trim(),String(req.body.imageUrl||'/images/hero-food.png').trim(),String(req.body.locationName||'').trim(),String(req.body.mapsUrl||'').trim(),nowIso()]);res.status(201).json({store:s});}));
app.patch('/api/admin/stores/:id', auth, role('superadmin'), run(async(req,res)=>{const s=await getStore(req.params.id);if(!s)return res.status(404).json({error:'Store not found.'});const name=Object.hasOwn(req.body,'name')?String(req.body.name).trim():s.name;if(!name)return res.status(400).json({error:'Store name is required.'});const v=[name,Object.hasOwn(req.body,'description')?String(req.body.description).trim():s.description,Object.hasOwn(req.body,'imageUrl')?String(req.body.imageUrl).trim():s.image_url,Object.hasOwn(req.body,'locationName')?String(req.body.locationName).trim():s.location_name,Object.hasOwn(req.body,'mapsUrl')?String(req.body.mapsUrl).trim():s.maps_url,Object.hasOwn(req.body,'isActive')?(req.body.isActive?1:0):s.is_active,s.id];const out=await one('UPDATE stores SET name=$1,description=$2,image_url=$3,location_name=$4,maps_url=$5,is_active=$6 WHERE id=$7 RETURNING *',v);res.json({store:out});}));
app.patch('/api/admin/stores/:id/manager', auth, role('superadmin'), run(async(req,res)=>{const store=await getStore(req.params.id);if(!store)return res.status(404).json({error:'Store not found.'});const id=req.body.managerId==null||req.body.managerId===''?null:Number(req.body.managerId);let manager=null;if(id!==null){manager=await one("SELECT * FROM users WHERE id=$1 AND role='store_manager' AND is_active=1",[id]);if(!manager)return res.status(400).json({error:'Choose an active Store Manager account.'});}const client=await pool.connect();try{await client.query('BEGIN');if(manager){await query("UPDATE users SET store_id=NULL WHERE role='store_manager' AND store_id=$1 AND id<>$2",[store.id,manager.id],client);await query("UPDATE users SET store_id=NULL WHERE role='store_manager' AND id=$1 AND store_id IS NOT NULL",[manager.id],client);await query('UPDATE users SET store_id=$1 WHERE id=$2',[store.id,manager.id],client);}else await query("UPDATE users SET store_id=NULL WHERE role='store_manager' AND store_id=$1",[store.id],client);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}res.json({success:true});}));
app.delete('/api/admin/stores/:id', auth, role('superadmin'), run(async(req,res)=>{const s=await getStore(req.params.id);if(!s)return res.status(404).json({error:'Store not found.'});const count=Number((await one('SELECT COUNT(*)::int AS count FROM orders WHERE store_id=$1',[s.id])).count);if(count>0){await query('UPDATE stores SET is_active=0 WHERE id=$1',[s.id]);return res.json({success:true,archived:true});}await query('DELETE FROM stores WHERE id=$1',[s.id]);res.json({success:true,archived:false});}));
app.get('/api/admin/settings', auth, role('superadmin'), run(async(_req,res)=>{const rows=await many('SELECT setting_key,setting_value FROM app_settings ORDER BY setting_key');res.json({settings:Object.fromEntries(rows.map(x=>[x.setting_key,x.setting_value]))});}));
app.patch('/api/admin/settings', auth, role('superadmin'), run(async(req,res)=>{for(const [key,value] of Object.entries(req.body)){if(!allowedSettings.has(key)||value==null)continue;if(key==='delivery_fee'&&(!Number.isFinite(Number(value))||Number(value)<0))return res.status(400).json({error:'Delivery fee must be a non-negative number.'});if(key==='default_eta_minutes'&&(!Number.isInteger(Number(value))||Number(value)<0||Number(value)>240))return res.status(400).json({error:'Default ETA must be between 0 and 240 minutes.'});await query('INSERT INTO app_settings(setting_key,setting_value,updated_at) VALUES($1,$2,$3) ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value,updated_at=EXCLUDED.updated_at',[key,String(value),nowIso()]);}res.json({success:true});}));
app.get('/api/admin/ratings', auth, role('superadmin'), run(async(_req,res)=>{res.json({ratings:await many('SELECT r.*,s.name AS store_name FROM ratings r JOIN stores s ON s.id=r.store_id ORDER BY r.created_at DESC,r.id DESC')});}));
app.patch('/api/admin/ratings/:id', auth, role('superadmin'), run(async(req,res)=>{const rating=await one('SELECT * FROM ratings WHERE id=$1',[Number(req.params.id)]);if(!rating)return res.status(404).json({error:'Rating not found.'});const visible=Object.hasOwn(req.body,'isVisible')?Boolean(req.body.isVisible):Boolean(Number(rating.is_visible));await query('UPDATE ratings SET is_visible=$1 WHERE id=$2',[visible?1:0,rating.id]);res.json({success:true});}));

// Group ordering remains available on PostgreSQL, including membership, item accumulation and checkout.
async function loadGroupOrder(groupId) {
  const g=await one('SELECT g.*,s.name AS store_name,s.location_name,h.name AS host_name FROM group_orders g JOIN stores s ON s.id=g.store_id JOIN users h ON h.id=g.host_customer_id WHERE g.id=$1',[groupId]);if(!g)return null;
  const [members,stored]=await Promise.all([many('SELECT u.id,u.name,gm.joined_at FROM group_order_members gm JOIN users u ON u.id=gm.customer_id WHERE gm.group_order_id=$1 ORDER BY gm.joined_at,u.id',[groupId]),many('SELECT gi.*,u.name AS member_name FROM group_order_items gi JOIN users u ON u.id=gi.customer_id WHERE gi.group_order_id=$1 ORDER BY gi.id',[groupId])]);
  const items=[];for(const item of stored){const p=item.product_id?await getProduct(item.product_id):null;items.push({...item,current_price:p&&Number(p.store_id)===Number(g.store_id)?Number(p.price):Number(item.unit_price),promo_active:p&&Number(p.store_id)===Number(g.store_id)?Boolean(p.promo_active):false,promo_label:p?.promo_label||'',stock:p?.stock??0,is_available:Boolean(p?.is_available&&p?.store_active)});}
  const estimate=await discounts(items.map(i=>({product:{price:i.current_price,promo_active:i.promo_active},quantity:Number(i.quantity)})),members.length);const fee=await one("SELECT setting_value FROM app_settings WHERE setting_key='delivery_fee'");const deliveryFee=g.status==='OPEN'?Number(fee?.setting_value||20):0;
  return {...g,members,items,member_count:members.length,subtotal:estimate.subtotal,student_discount:estimate.studentDiscount,group_discount:estimate.groupDiscount,discount_total:estimate.discountTotal,group_discount_eligible:estimate.groupEligible,delivery_fee:deliveryFee,estimated_total:Math.max(0,estimate.subtotal-estimate.discountTotal)+deliveryFee,discount_policy:{student_discount_percent:estimate.policy.studentDiscountPercent,group_discount_percent:estimate.policy.groupDiscountPercent,group_discount_min_members:estimate.policy.groupDiscountMinMembers,group_discount_min_subtotal:estimate.policy.groupDiscountMinSubtotal},order:g.order_id?await getOrderDetails(g.order_id):null};
}
async function validateGroupItems(storeId, input, client=pool) {
  if(!Array.isArray(input)||!input.length)throw new Error('Add at least one item before submitting your cart to the group.');const quantities=new Map();for(const item of input){const id=Number(item.productId),qty=Number(item.quantity);if(!Number.isInteger(id)||!Number.isInteger(qty)||qty<1||qty>50)throw new Error('Each group item must have a valid product and quantity.');quantities.set(id,(quantities.get(id)||0)+qty);}const rows=[];for(const [id,qty] of quantities){const p=await getProduct(id,client);if(!p||Number(p.store_id)!==Number(storeId)||!p.store_active||!p.is_available)throw new Error('All group-order items must be available from the same store.');if(Number(p.stock)<qty)throw new Error(`${p.name} does not have enough stock for this quantity.`);rows.push({product:p,quantity:qty});}return rows;
}
async function insertGroupItems(groupId, customerId, products, client=pool){for(const {product,quantity} of products)await query('INSERT INTO group_order_items(group_order_id,customer_id,product_id,product_name,unit_price,quantity,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[groupId,customerId,product.id,product.name,product.price,quantity,nowIso()],client);}
async function assertGroupMember(groupId,userId){return Boolean(await one('SELECT id FROM group_order_members WHERE group_order_id=$1 AND customer_id=$2',[groupId,userId]));}
app.get('/api/group-orders/mine',auth,role('customer'),run(async(req,res)=>{const g=await one("SELECT g.id FROM group_orders g JOIN group_order_members gm ON gm.group_order_id=g.id WHERE gm.customer_id=$1 AND g.status='OPEN' ORDER BY g.updated_at DESC LIMIT 1",[req.user.id]);res.json({groupOrder:g?await loadGroupOrder(g.id):null});}));
app.post('/api/group-orders',auth,role('customer'),run(async(req,res)=>{
  const storeId=Number(req.body.storeId),address=typeof req.body.deliveryAddress==='string'?req.body.deliveryAddress.trim():'';const store=await one('SELECT * FROM stores WHERE id=$1 AND is_active=1',[storeId]);if(!store)return res.status(400).json({error:'Choose an active store for the group order.'});if(address.length<3||address.length>300)return res.status(400).json({error:'Enter a shared delivery location between 3 and 300 characters.'});
  if(await one("SELECT g.id FROM group_orders g JOIN group_order_members gm ON gm.group_order_id=g.id WHERE gm.customer_id=$1 AND g.status='OPEN' LIMIT 1",[req.user.id]))return res.status(409).json({error:'You are already in an open group order. Open your cart to continue it.'});
  let products;try{products=await validateGroupItems(storeId,req.body.items);}catch(e){return res.status(400).json({error:e.message});}
  const client=await pool.connect();const id=groupToken(),joinCode=crypto.randomBytes(3).toString('hex').toUpperCase(),now=nowIso();try{await client.query('BEGIN');await query("INSERT INTO group_orders(id,join_code,host_customer_id,store_id,delivery_address,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'OPEN',$6,$6)",[id,joinCode,req.user.id,storeId,address,now],client);await query('INSERT INTO group_order_members(group_order_id,customer_id,joined_at) VALUES($1,$2,$3)',[id,req.user.id,now],client);await insertGroupItems(id,req.user.id,products,client);await client.query('COMMIT');res.status(201).json({groupOrder:await loadGroupOrder(id)});}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}));
app.post('/api/group-orders/join',auth,role('customer'),run(async(req,res)=>{const code=typeof req.body.joinCode==='string'?req.body.joinCode.trim().toUpperCase():'';if(!/^[A-F0-9]{6}$/.test(code))return res.status(400).json({error:'Enter the 6-character group code.'});const g=await one("SELECT * FROM group_orders WHERE join_code=$1 AND status='OPEN'",[code]);if(!g)return res.status(404).json({error:'That group code was not found or the group is already closed.'});if(Number(g.host_customer_id)===Number(req.user.id))return res.status(400).json({error:'You created this group order already.'});if(await one("SELECT g.id FROM group_orders g JOIN group_order_members gm ON gm.group_order_id=g.id WHERE gm.customer_id=$1 AND g.status='OPEN' LIMIT 1",[req.user.id]))return res.status(409).json({error:'Leave your current group order before joining another.'});const count=Number((await one('SELECT COUNT(*)::int AS count FROM group_order_members WHERE group_order_id=$1',[g.id])).count);if(count>=20)return res.status(400).json({error:'This group order has reached the 20-student limit.'});await query('INSERT INTO group_order_members(group_order_id,customer_id,joined_at) VALUES($1,$2,$3)',[g.id,req.user.id,nowIso()]);await query('UPDATE group_orders SET updated_at=$1 WHERE id=$2',[nowIso(),g.id]);res.json({groupOrder:await loadGroupOrder(g.id)});}));
app.get('/api/group-orders/:id',auth,role('customer'),run(async(req,res)=>{const g=await one('SELECT * FROM group_orders WHERE id=$1',[req.params.id]);if(!g)return res.status(404).json({error:'Group order not found.'});if(!await assertGroupMember(g.id,req.user.id))return res.status(403).json({error:'You are not a member of this group order.'});res.json({groupOrder:await loadGroupOrder(g.id)});}));
app.post('/api/group-orders/:id/items',auth,role('customer'),run(async(req,res)=>{const g=await one("SELECT * FROM group_orders WHERE id=$1 AND status='OPEN'",[req.params.id]);if(!g)return res.status(404).json({error:'This group order is already closed.'});if(!await assertGroupMember(g.id,req.user.id))return res.status(403).json({error:'You are not a member of this group order.'});let products;try{products=await validateGroupItems(g.store_id,req.body.items);for(const {product,quantity} of products){const current=Number((await one('SELECT COALESCE(SUM(quantity),0)::int AS quantity FROM group_order_items WHERE group_order_id=$1 AND product_id=$2',[g.id,product.id])).quantity);if(Number(product.stock)<current+quantity)throw new Error(`${product.name} does not have enough stock for the group's combined quantity.`);}}catch(e){return res.status(400).json({error:e.message});}const client=await pool.connect();try{await client.query('BEGIN');await insertGroupItems(g.id,req.user.id,products,client);await query('UPDATE group_orders SET updated_at=$1 WHERE id=$2',[nowIso(),g.id],client);await client.query('COMMIT');res.json({groupOrder:await loadGroupOrder(g.id)});}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}));
app.post('/api/group-orders/:id/checkout',auth,role('customer'),run(async(req,res)=>{
  const client=await pool.connect();let orderId;try{await client.query('BEGIN');const g=await one("SELECT * FROM group_orders WHERE id=$1 AND status='OPEN' FOR UPDATE",[req.params.id],client);if(!g){await client.query('ROLLBACK');return res.status(404).json({error:'This group order is already closed.'});}if(Number(g.host_customer_id)!==Number(req.user.id)){await client.query('ROLLBACK');return res.status(403).json({error:'Only the group host can place the combined order.'});}if(!await assertGroupMember(g.id,req.user.id)) {await client.query('ROLLBACK');return res.status(403).json({error:'You are not a member of this group order.'});}
    const memberCount=Number((await one('SELECT COUNT(*)::int AS count FROM group_order_members WHERE group_order_id=$1',[g.id],client)).count);const items=await many('SELECT * FROM group_order_items WHERE group_order_id=$1 ORDER BY id',[g.id],client);if(!items.length)throw new Error('Add items before checking out the group order.');const quantities=new Map(),lines=[];
    for(const item of items){if(item.product_id==null)throw new Error(`${item.product_name} is no longer available. Remove it before checking out.`);const p=await getProduct(item.product_id,client);if(!p||Number(p.store_id)!==Number(g.store_id)||!p.store_active||!p.is_available)throw new Error(`${item.product_name} is no longer available. Ask the group to refresh its items.`);quantities.set(Number(p.id),(quantities.get(Number(p.id))||0)+Number(item.quantity));lines.push({item,product:p,quantity:Number(item.quantity)});}
    for(const [pid,qty] of quantities){const current=await one('SELECT stock FROM products WHERE id=$1 FOR UPDATE',[pid],client);if(!current||Number(current.stock)<qty)throw new Error('A product does not have enough stock for the combined group quantity.');}
    const pricing=await discounts(lines.map(l=>({product:l.product,quantity:l.quantity})),memberCount,client);const deliveryFee=pricing.policy.deliveryFee,total=Math.max(0,pricing.subtotal-pricing.discountTotal)+deliveryFee;const now=nowIso();orderId=idToken();
    const payment=typeof req.body.paymentMethod==='string'&&req.body.paymentMethod.trim()?req.body.paymentMethod.trim():'Cash on delivery';const note=typeof req.body.orderNotes==='string'&&req.body.orderNotes.trim()?req.body.orderNotes.trim().slice(0,500):`Group order with ${memberCount} students.`;
    // Group orders also remain unassigned until a rider accepts the offer or a manager assigns one.
    await query(`INSERT INTO orders(id,customer_id,store_id,rider_id,status,subtotal,delivery_fee,total,discount_total,student_discount,group_discount,group_order_id,payment_method,delivery_address,order_notes,created_at,updated_at) VALUES($1,$2,$3,NULL,'Pending',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,[orderId,g.host_customer_id,g.store_id,pricing.subtotal,deliveryFee,total,pricing.discountTotal,pricing.studentDiscount,pricing.groupDiscount,g.id,payment,g.delivery_address,note,now],client);
    for(const l of lines)await query('INSERT INTO order_items(order_id,product_id,product_name,unit_price,quantity,line_total,ordered_by_customer_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[orderId,l.product.id,l.item.product_name,l.product.price,l.quantity,l.product.price*l.quantity,l.item.customer_id],client);
    for(const [pid,qty] of quantities){const upd=await query('UPDATE products SET stock=stock-$1 WHERE id=$2 AND stock >= $1',[qty,pid],client);if(upd.rowCount!==1)throw new Error('Stock changed while the group order was being placed. Refresh and try again.');}
    await logTracking(orderId,req.user.id,'Pending',`Group order placed by ${req.user.name} for ${memberCount} students. Waiting for store confirmation.`,g.delivery_address,null,client);await query("UPDATE group_orders SET status='CLOSED',order_id=$1,updated_at=$2 WHERE id=$3",[orderId,now,g.id],client);await client.query('COMMIT');res.status(201).json({order:await getOrderDetails(orderId),groupOrder:await loadGroupOrder(g.id)});
  }catch(e){await client.query('ROLLBACK');res.status(400).json({error:e.message||'Could not place the group order.'});}finally{client.release();}
}));
app.post('/api/group-orders/:id/leave',auth,role('customer'),run(async(req,res)=>{const g=await one("SELECT * FROM group_orders WHERE id=$1 AND status='OPEN'",[req.params.id]);if(!g)return res.status(404).json({error:'This group order is closed.'});if(!await assertGroupMember(g.id,req.user.id))return res.status(403).json({error:'You are not a member of this group order.'});if(Number(g.host_customer_id)===Number(req.user.id))return res.status(400).json({error:'The host must cancel the group instead of leaving it.'});await query('DELETE FROM group_order_items WHERE group_order_id=$1 AND customer_id=$2',[g.id,req.user.id]);await query('DELETE FROM group_order_members WHERE group_order_id=$1 AND customer_id=$2',[g.id,req.user.id]);await query('UPDATE group_orders SET updated_at=$1 WHERE id=$2',[nowIso(),g.id]);res.json({success:true});}));
app.delete('/api/group-orders/:id',auth,role('customer'),run(async(req,res)=>{const g=await one("SELECT * FROM group_orders WHERE id=$1 AND status='OPEN'",[req.params.id]);if(!g)return res.status(404).json({error:'This group order is closed.'});if(Number(g.host_customer_id)!==Number(req.user.id))return res.status(403).json({error:'Only the group host can cancel this group order.'});await query("UPDATE group_orders SET status='CANCELLED',updated_at=$1 WHERE id=$2",[nowIso(),g.id]);res.json({success:true});}));

app.use((err,_req,res,_next)=>{if(res.headersSent)return;console.error(err);if(err.code==='23505')return res.status(409).json({error:'That record already exists.'});res.status(500).json({error:'Unexpected server error. Check the Render logs for details.'});});

try {
  await initializeSchema();
  app.listen(port,'0.0.0.0',()=>console.log(`DormDish API using Neon PostgreSQL on port ${port}`));
} catch(error) {
  console.error('Could not initialize DormDish PostgreSQL database:',error);
  process.exit(1);
}
