
/**
 * Apple PassKit Web Service Protocol
 * https://developer.apple.com/documentation/walletpasses/building_a_pass
 *
 * Apple calls these endpoints automatically:
 *   - Register device
 *   - Unregister device
 *   - Get list of updated passes
 *   - Get updated pass
 */
const router      = require('express').Router();
const db          = require('../config/db');
const passService = require('../services/passService');

// ── Auth middleware for Apple ──────────────────────────────
function appleAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('ApplePass ')) {
    return res.status(401).end();
  }
  req.authToken = authHeader.replace('ApplePass ','').trim();
  next();
}

// POST /v1/devices/:deviceId/registrations/:passTypeId/:serial
router.post('/devices/:deviceId/registrations/:passTypeId/:serial',
  appleAuth, async (req, res) => {
    try {
      const { deviceId, serial } = req.params;
      const { pushToken } = req.body;

      // Verify auth token
      const { rows } = await db.query(
        'SELECT * FROM wallet_passes WHERE serial_number=$1 AND auth_token=$2',
        [serial, req.authToken]
      );
      if (!rows.length) return res.status(401).end();

      // Upsert device registration
      await db.query(\`
        INSERT INTO apple_registrations(device_library_id,push_token,serial_number,pass_type_id)
        VALUES($1,$2,$3,$4)
        ON CONFLICT(device_library_id,serial_number) DO UPDATE SET push_token=$2
      \`, [deviceId, pushToken, serial, req.params.passTypeId]);

      // Add device to pass devices array
      await db.query(\`
        UPDATE wallet_passes
        SET devices = array_append(
          CASE WHEN $2 = ANY(devices) THEN devices ELSE devices END, $2)
        WHERE serial_number=$1
      \`, [serial, pushToken]);

      res.status(201).end();
    } catch (e) { res.status(500).end(); }
  }
);

// DELETE /v1/devices/:deviceId/registrations/:passTypeId/:serial
router.delete('/devices/:deviceId/registrations/:passTypeId/:serial',
  appleAuth, async (req, res) => {
    try {
      const { deviceId, serial } = req.params;
      await db.query(
        'DELETE FROM apple_registrations WHERE device_library_id=$1 AND serial_number=$2',
        [deviceId, serial]
      );
      res.status(200).end();
    } catch (e) { res.status(500).end(); }
  }
);

// GET /v1/devices/:deviceId/registrations/:passTypeId
// Returns passes updated since passesUpdatedSince
router.get('/devices/:deviceId/registrations/:passTypeId',
  async (req, res) => {
    try {
      const { deviceId } = req.params;
      const since = req.query.passesUpdatedSince
        ? new Date(parseInt(req.query.passesUpdatedSince) * 1000)
        : new Date(0);

      const { rows } = await db.query(\`
        SELECT wp.serial_number
        FROM apple_registrations ar
        JOIN wallet_passes wp ON wp.serial_number = ar.serial_number
        WHERE ar.device_library_id=$1
          AND wp.last_updated_at > $2
      \`, [deviceId, since]);

      if (!rows.length) return res.status(204).end();

      res.json({
        serialNumbers: rows.map(r => r.serial_number),
        lastUpdated:   Math.floor(Date.now()/1000).toString(),
      });
    } catch (e) { res.status(500).end(); }
  }
);

// GET /v1/passes/:passTypeId/:serial  – Apple fetches updated pass
router.get('/passes/:passTypeId/:serial', appleAuth, async (req, res) => {
  try {
    const { serial } = req.params;
    const { rows } = await db.query(\`
      SELECT wp.*, u.id AS user_id, u.active_merchant_id
      FROM wallet_passes wp
      JOIN users u ON u.id = wp.user_id
      WHERE wp.serial_number=$1 AND wp.auth_token=$2
    \`, [serial, req.authToken]);

    if (!rows.length) return res.status(401).end();
    const pass = rows[0];

    const pkpassBuffer = await passService.generatePkpass(
      pass.user_id, pass.active_merchant_id
    );

    // Update last_updated_at
    await db.query(
      'UPDATE wallet_passes SET last_updated_at=NOW() WHERE serial_number=$1',[serial]
    );

    res.set({
      'Content-Type': 'application/vnd.apple.pkpass',
      'Last-Modified': new Date().toUTCString(),
    });
    res.send(pkpassBuffer);
  } catch (e) { res.status(500).end(); }
});

module.exports = router;
