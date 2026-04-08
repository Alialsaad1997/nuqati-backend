
const router = require('express').Router();
const db     = require('../config/db');
const { requireSuperAdmin } = require('../middleware/auth');

// GET /api/admin/stats
router.get('/stats', requireSuperAdmin, async (req, res) => {
  try {
    const [merchants,users,txns,broadcasts] = await Promise.all([
      db.query('SELECT COUNT(*) FROM merchants WHERE is_active=TRUE'),
      db.query('SELECT COUNT(*) FROM users'),
      db.query('SELECT COUNT(*) FROM transactions WHERE created_at > NOW()-INTERVAL\'30 days\''),
      db.query("SELECT COUNT(*) FROM broadcast_requests WHERE status='pending'"),
    ]);
    res.json({
      active_merchants:  parseInt(merchants.rows[0].count),
      total_users:       parseInt(users.rows[0].count),
      txns_last_30d:     parseInt(txns.rows[0].count),
      pending_broadcasts:parseInt(broadcasts.rows[0].count),
    });
  } catch(e){ res.status(500).json({error:e.message}); }
});

// GET /api/admin/broadcasts
router.get('/broadcasts', requireSuperAdmin, async (req,res) => {
  try {
    const { rows } = await db.query(\`
      SELECT br.*, m.name AS merchant_name
      FROM broadcast_requests br
      JOIN merchants m ON m.id=br.merchant_id
      ORDER BY br.created_at DESC
    \`);
    res.json(rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// POST /api/admin/broadcasts/:id/approve
router.post('/broadcasts/:id/approve', requireSuperAdmin, async (req,res) => {
  try {
    const { rows } = await db.query(\`
      UPDATE broadcast_requests
      SET status='approved', approved_by=$2
      WHERE id=$1 RETURNING *
    \`,[req.params.id, req.admin.email]);
    // TODO: trigger actual push to all merchant users
    res.json(rows[0]);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// POST /api/admin/broadcasts/:id/reject
router.post('/broadcasts/:id/reject', requireSuperAdmin, async (req,res) => {
  try {
    const { rows } = await db.query(\`
      UPDATE broadcast_requests SET status='rejected' WHERE id=$1 RETURNING *
    \`,[req.params.id]);
    res.json(rows[0]);
  } catch(e){ res.status(500).json({error:e.message}); }
});

module.exports = router;
