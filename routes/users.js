
const router = require('express').Router();
const db     = require('../config/db');
const { v4: uuidv4 } = require('uuid');

// POST /api/users/register
// Called from the landing page after user scans QR
router.post('/register', async (req, res) => {
  try {
    const { name, phone, merchant_id } = req.body;
    if (!phone || !merchant_id) return res.status(400).json({ error: 'phone and merchant_id required' });

    const cleanPhone = phone.replace(/\D/g,'');

    // Upsert user
    let { rows } = await db.query(\`
      INSERT INTO users(name, phone)
      VALUES($1, $2)
      ON CONFLICT(phone) DO UPDATE SET name = COALESCE(EXCLUDED.name, users.name)
      RETURNING *
    \`, [name, cleanPhone]);
    const user = rows[0];

    // Ensure wallet pass exists
    const pass = await ensurePass(user.id);

    // Ensure loyalty balance row
    await db.query(\`
      INSERT INTO loyalty_balances(user_id, merchant_id)
      VALUES($1,$2)
      ON CONFLICT(user_id,merchant_id) DO NOTHING
    \`, [user.id, merchant_id]);

    res.status(201).json({ user, pass_serial: pass.serial_number });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/users/:phone/summary  – full loyalty summary for pass back
router.get('/:phone/summary', async (req, res) => {
  try {
    const cleanPhone = req.params.phone.replace(/\D/g,'');
    const { rows } = await db.query(\`
      SELECT * FROM user_pass_summary
      WHERE phone = $1
      ORDER BY last_visit_at DESC
    \`, [cleanPhone]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

async function ensurePass(userId) {
  const { rows } = await db.query('SELECT * FROM wallet_passes WHERE user_id=$1',[userId]);
  if (rows.length) return rows[0];
  const serial     = uuidv4();
  const auth_token = uuidv4().replace(/-/g,'');
  const { rows: ins } = await db.query(\`
    INSERT INTO wallet_passes(user_id,serial_number,auth_token,pass_type_id)
    VALUES($1,$2,$3,$4) RETURNING *
  \`, [userId, serial, auth_token, process.env.PASS_TYPE_ID || 'pass.com.nuqati.loyalty']);
  return ins[0];
}

module.exports = router;
