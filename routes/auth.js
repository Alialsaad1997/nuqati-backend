
const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../config/db');

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const { rows } = await db.query(
      'SELECT * FROM admin_users WHERE email=$1', [email]
    );
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const ok   = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, role: user.role, merchant_id: user.merchant_id },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, role: user.role, merchant_id: user.merchant_id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/auth/register (super admin only - for seeding)
router.post('/register-merchant', async (req, res) => {
  try {
    const { email, password, merchant_id, role = 'merchant' } = req.body;
    const hash = await bcrypt.hash(password, 12);
    const { rows } = await db.query(
      \`INSERT INTO admin_users(email,password_hash,merchant_id,role)
       VALUES($1,$2,$3,$4) RETURNING id,email,role\`,
      [email, hash, merchant_id, role]
    );
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
