
const router      = require('express').Router();
const db          = require('../config/db');
const passService = require('../services/passService');

// GET /api/passes/:phone  – generate fresh .pkpass for download
router.get('/:phone', async (req, res) => {
  try {
    const phone = req.params.phone.replace(/\D/g,'');
    const { rows } = await db.query('SELECT * FROM users WHERE phone=$1',[phone]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const user = rows[0];

    const activeMerchantId = user.active_merchant_id;

    // Build + sign .pkpass
    const pkpassBuffer = await passService.generatePkpass(user.id, activeMerchantId);

    res.set({
      'Content-Type':        'application/vnd.apple.pkpass',
      'Content-Disposition': \`attachment; filename="nuqati.pkpass"\`,
      'Content-Length':      pkpassBuffer.length,
    });
    res.send(pkpassBuffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/passes/pass-data/:phone  – JSON pass data (for Google Wallet)
router.get('/pass-data/:phone', async (req, res) => {
  try {
    const phone = req.params.phone.replace(/\D/g,'');
    const { rows } = await db.query('SELECT * FROM users WHERE phone=$1',[phone]);
    if (!rows.length) return res.status(404).json({ error: 'User not found' });
    const user = rows[0];

    const passData = await passService.buildPassData(user.id, user.active_merchant_id);
    res.json(passData);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
