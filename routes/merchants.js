
const router = require('express').Router();
const db     = require('../config/db');
const qrcode = require('qrcode');
const crypto = require('crypto');
const { requireMerchant, requireSuperAdmin } = require('../middleware/auth');

// GET /api/merchants  (super admin)
router.get('/', requireSuperAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(\`
      SELECT m.*,
        COUNT(DISTINCT lb.user_id) AS total_members,
        COUNT(DISTINCT t.id)       AS total_txns
      FROM merchants m
      LEFT JOIN loyalty_balances lb ON lb.merchant_id = m.id
      LEFT JOIN transactions t      ON t.merchant_id = m.id
      GROUP BY m.id
      ORDER BY m.created_at DESC
    \`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/merchants/me  (merchant dashboard)
router.get('/me', requireMerchant, async (req, res) => {
  try {
    const id = req.admin.merchant_id;
    const { rows } = await db.query(\`
      SELECT m.*,
        COUNT(DISTINCT lb.user_id)  AS total_members,
        SUM(lb.stamps_current)      AS total_stamps,
        SUM(lb.points_balance)      AS total_points
      FROM merchants m
      LEFT JOIN loyalty_balances lb ON lb.merchant_id = m.id
      WHERE m.id = $1
      GROUP BY m.id
    \`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Merchant not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/merchants  (super admin creates merchant)
router.post('/', requireSuperAdmin, async (req, res) => {
  try {
    const {
      name, name_ar, brand_color = '#7C3AED',
      loyalty_mode = 'stamps',
      stamps_required = 10, stamp_reward,
      cashback_pct = 0, points_per_iqd = 0.01,
      pass_description, owner_phone, plan = 'trial'
    } = req.body;

    if (!name) return res.status(400).json({ error: 'name required' });

    const qr_secret = crypto.randomBytes(32).toString('hex');

    const { rows } = await db.query(\`
      INSERT INTO merchants
        (name,name_ar,brand_color,loyalty_mode,stamps_required,stamp_reward,
         cashback_pct,points_per_iqd,pass_description,qr_secret,owner_phone,plan)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *
    \`, [name,name_ar,brand_color,loyalty_mode,stamps_required,stamp_reward,
        cashback_pct,points_per_iqd,pass_description,qr_secret,owner_phone,plan]);

    const merchant = rows[0];

    // Generate QR code (encodes signed URL)
    const qrPayload = \`\${process.env.BASE_URL}/scan/\${merchant.id}?sig=\${qr_secret}\`;
    const qrDataUrl  = await qrcode.toDataURL(qrPayload, { width: 400 });

    res.status(201).json({ ...merchant, qr_data_url: qrDataUrl, qr_payload: qrPayload });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/merchants/me  (merchant updates own settings)
router.patch('/me', requireMerchant, async (req, res) => {
  try {
    const id = req.admin.merchant_id;
    const {
      loyalty_mode, stamps_required, stamp_reward,
      cashback_pct, points_per_iqd, pass_description,
      brand_color, logo_url, strip_image_url
    } = req.body;

    const { rows } = await db.query(\`
      UPDATE merchants SET
        loyalty_mode    = COALESCE($1, loyalty_mode),
        stamps_required = COALESCE($2, stamps_required),
        stamp_reward    = COALESCE($3, stamp_reward),
        cashback_pct    = COALESCE($4, cashback_pct),
        points_per_iqd  = COALESCE($5, points_per_iqd),
        pass_description= COALESCE($6, pass_description),
        brand_color     = COALESCE($7, brand_color),
        logo_url        = COALESCE($8, logo_url),
        strip_image_url = COALESCE($9, strip_image_url),
        updated_at      = NOW()
      WHERE id = $10 RETURNING *
    \`, [loyalty_mode,stamps_required,stamp_reward,cashback_pct,
        points_per_iqd,pass_description,brand_color,logo_url,strip_image_url,id]);

    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/merchants/me/qr  – regenerate QR PNG
router.get('/me/qr', requireMerchant, async (req, res) => {
  try {
    const { rows } = await db.query('SELECT qr_secret,id FROM merchants WHERE id=$1',[req.admin.merchant_id]);
    if (!rows.length) return res.status(404).json({ error: 'not found' });
    const m = rows[0];
    const payload = \`\${process.env.BASE_URL}/scan/\${m.id}?sig=\${m.qr_secret}\`;
    const png = await qrcode.toBuffer(payload, { width: 500, type: 'png' });
    res.set('Content-Type','image/png');
    res.send(png);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/merchants/me/members
router.get('/me/members', requireMerchant, async (req, res) => {
  try {
    const { rows } = await db.query(\`
      SELECT u.id, u.name, u.phone, u.created_at,
             lb.stamps_current, lb.stamps_total, lb.points_balance,
             lb.cashback_balance, lb.rewards_earned, lb.last_visit_at
      FROM loyalty_balances lb
      JOIN users u ON u.id = lb.user_id
      WHERE lb.merchant_id = $1
      ORDER BY lb.last_visit_at DESC
    \`, [req.admin.merchant_id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/merchants/me/broadcast-request
router.post('/me/broadcast-request', requireMerchant, async (req, res) => {
  try {
    const { message_ar, message_en } = req.body;
    if (!message_ar) return res.status(400).json({ error: 'message_ar required' });
    const { rows } = await db.query(\`
      INSERT INTO broadcast_requests(merchant_id,message_ar,message_en)
      VALUES($1,$2,$3) RETURNING *
    \`, [req.admin.merchant_id, message_ar, message_en]);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/merchants/me/locations
router.post('/me/locations', requireMerchant, async (req, res) => {
  try {
    const { name, latitude, longitude, radius_m = 100 } = req.body;
    if (!latitude || !longitude) return res.status(400).json({ error: 'lat/lng required' });
    const { rows } = await db.query(\`
      INSERT INTO merchant_locations(merchant_id,name,location,radius_m)
      VALUES($1,$2,ST_SetSRID(ST_MakePoint($4,$3),4326)::geography,$5)
      RETURNING id,name,radius_m,
        ST_Y(location::geometry) AS latitude,
        ST_X(location::geometry) AS longitude
    \`, [req.admin.merchant_id,name,latitude,longitude,radius_m]);
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
