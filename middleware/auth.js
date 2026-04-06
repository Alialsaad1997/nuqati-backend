
const jwt = require('jsonwebtoken');
const db  = require('../config/db');

exports.requireMerchant = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const { rows } = await db.query('SELECT * FROM admin_users WHERE id=$1', [payload.id]);
    if (!rows.length) return res.status(401).json({ error: 'Unauthorized' });
    req.admin = rows[0];
    next();
  } catch (e) { res.status(401).json({ error: 'Invalid token' }); }
};

exports.requireSuperAdmin = async (req, res, next) => {
  await exports.requireMerchant(req, res, () => {
    if (req.admin.role !== 'super_admin')
      return res.status(403).json({ error: 'Super admin only' });
    next();
  });
};
