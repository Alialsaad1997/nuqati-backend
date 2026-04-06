
/**
 * POST /api/scan
 * Called when user scans merchant QR code.
 * 1. Validates merchant QR signature
 * 2. Records transaction
 * 3. Updates loyalty balance
 * 4. Triggers Apple/Google push to update pass
 * 5. Returns updated pass data
 */
const router      = require('express').Router();
const db          = require('../config/db');
const passService = require('../services/passService');
const pushService = require('../services/pushService');

// POST /api/scan
router.post('/', async (req, res) => {
  try {
    const { merchant_id, sig, user_phone, amount_iqd = 0 } = req.body;

    // ── 1. Validate merchant QR signature ──────────────────
    const { rows: mRows } = await db.query(
      'SELECT * FROM merchants WHERE id=$1 AND is_active=TRUE', [merchant_id]
    );
    if (!mRows.length) return res.status(404).json({ error: 'Merchant not found' });
    const merchant = mRows[0];

    if (merchant.qr_secret !== sig)
      return res.status(403).json({ error: 'Invalid QR signature' });

    // ── 2. Resolve or create user ──────────────────────────
    const cleanPhone = user_phone.replace(/\D/g,'');
    const { rows: uRows } = await db.query(
      'SELECT * FROM users WHERE phone=$1', [cleanPhone]
    );
    if (!uRows.length)
      return res.status(404).json({ error: 'User not registered', code: 'USER_NOT_FOUND' });
    const user = uRows[0];

    // ── 3. Ensure loyalty balance row ──────────────────────
    await db.query(\`
      INSERT INTO loyalty_balances(user_id,merchant_id)
      VALUES($1,$2)
      ON CONFLICT(user_id,merchant_id) DO NOTHING
    \`, [user.id, merchant_id]);

    // ── 4. Apply loyalty logic based on merchant mode ──────
    let txnType, stampsDelta=0, pointsDelta=0, cashbackDelta=0;
    let message = '';

    if (merchant.loyalty_mode === 'stamps') {
      stampsDelta = 1;
      txnType     = 'stamp';

      const { rows: balRows } = await db.query(
        'SELECT stamps_current FROM loyalty_balances WHERE user_id=$1 AND merchant_id=$2',
        [user.id, merchant_id]
      );
      const newStamps = (balRows[0]?.stamps_current || 0) + 1;
      const completed = newStamps >= merchant.stamps_required;

      await db.query(\`
        UPDATE loyalty_balances SET
          stamps_current = CASE WHEN $3 THEN 0 ELSE stamps_current + 1 END,
          stamps_total   = stamps_total + 1,
          rewards_earned = rewards_earned + CASE WHEN $3 THEN 1 ELSE 0 END,
          last_visit_at  = NOW()
        WHERE user_id=$1 AND merchant_id=$2
      \`, [user.id, merchant_id, completed]);

      if (completed) {
        message = \`🎉 مبروك! أكملت \${merchant.stamps_required} طوابع. مكافأتك: \${merchant.stamp_reward}\`;
      } else {
        const left = merchant.stamps_required - newStamps;
        message = \`⭐ طابع جديد! متبقي \${left} طوابع للمكافأة.\`;
      }
    }

    else if (merchant.loyalty_mode === 'points') {
      pointsDelta = Math.floor(amount_iqd * merchant.points_per_iqd);
      txnType     = 'points_earn';
      await db.query(\`
        UPDATE loyalty_balances SET
          points_balance = points_balance + $3,
          points_total   = points_total + $3,
          last_visit_at  = NOW()
        WHERE user_id=$1 AND merchant_id=$2
      \`, [user.id, merchant_id, pointsDelta]);
      message = \`✨ تم إضافة \${pointsDelta} نقطة\`;
    }

    else if (merchant.loyalty_mode === 'cashback') {
      cashbackDelta = amount_iqd * (merchant.cashback_pct / 100);
      txnType       = 'cashback';
      await db.query(\`
        UPDATE loyalty_balances SET
          cashback_balance = cashback_balance + $3,
          cashback_total   = cashback_total + $3,
          last_visit_at    = NOW()
        WHERE user_id=$1 AND merchant_id=$2
      \`, [user.id, merchant_id, cashbackDelta]);
      message = \`💰 تم إضافة \${cashbackDelta.toFixed(0)} د.ع كاش باك\`;
    }

    // ── 5. Record transaction ──────────────────────────────
    await db.query(\`
      INSERT INTO transactions(user_id,merchant_id,type,amount,stamps_delta,points_delta,cashback_delta)
      VALUES($1,$2,$3,$4,$5,$6,$7)
    \`, [user.id,merchant_id,txnType,amount_iqd,stampsDelta,pointsDelta,cashbackDelta]);

    // ── 6. Update active merchant on user ─────────────────
    await db.query(
      'UPDATE users SET active_merchant_id=$1, last_seen_at=NOW() WHERE id=$2',
      [merchant_id, user.id]
    );

    // ── 7. Build fresh pass JSON ───────────────────────────
    const passData = await passService.buildPassData(user.id, merchant_id);

    // ── 8. Push update to Apple/Google wallets ─────────────
    // Non-blocking – fire and forget
    pushService.pushUpdate(user.id).catch(console.error);

    res.json({
      success: true,
      message,
      loyalty_mode: merchant.loyalty_mode,
      stamps_delta:   stampsDelta,
      points_delta:   pointsDelta,
      cashback_delta: cashbackDelta,
      pass: passData,
    });
  } catch (e) {
    console.error('Scan error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /scan/:merchant_id  – landing page redirect (from QR)
router.get('/:merchant_id', (req, res) => {
  const { merchant_id } = req.params;
  const sig = req.query.sig;
  // Redirect to the React landing page with params
  res.redirect(\`\${process.env.FRONTEND_URL || 'http://localhost:3000'}/join?m=\${merchant_id}&sig=\${sig}\`);
});

module.exports = router;
