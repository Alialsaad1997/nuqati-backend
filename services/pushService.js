
/**
 * pushService.js
 * Sends push notifications to Apple and Google
 * when a pass needs to be updated.
 */
const https  = require('https');
const db     = require('../config/db');

// ── Apple Push Notification (APN) ─────────────────────────
async function pushApple(userId) {
  const { rows } = await db.query(\`
    SELECT wp.devices, wp.serial_number, wp.auth_token,
           u.apple_push_token
    FROM wallet_passes wp
    JOIN users u ON u.id = wp.user_id
    WHERE wp.user_id = $1
  \`, [userId]);

  if (!rows.length) return;
  const pass = rows[0];
  const devices = pass.devices || [];

  // Apple expects a push to each registered device
  for (const deviceToken of devices) {
    await sendApnPush(deviceToken);
  }
  // Also direct token if set
  if (pass.apple_push_token) {
    await sendApnPush(pass.apple_push_token);
  }
}

async function sendApnPush(deviceToken) {
  // Apple Wallet push is an EMPTY payload - Apple fetches updated pass
  return new Promise((resolve) => {
    const payload = JSON.stringify({});
    const options = {
      hostname: 'api.push.apple.com',
      port: 443,
      path: \`/3/device/\${deviceToken}\`,
      method: 'POST',
      headers: {
        'apns-topic': process.env.PASS_TYPE_ID || 'pass.com.nuqati.loyalty',
        'apns-push-type': 'background',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      console.log(\`Apple push status: \${res.statusCode} for \${deviceToken.slice(0,8)}...\`);
      resolve();
    });
    req.on('error', (e) => { console.warn('Apple push error:', e.message); resolve(); });
    req.write(payload);
    req.end();
  });
}

// ── Google Wallet Update ───────────────────────────────────
async function pushGoogle(userId) {
  const { rows } = await db.query(
    'SELECT google_object_id FROM users WHERE id=$1',[userId]
  );
  if (!rows.length || !rows[0].google_object_id) return;
  // Google Wallet doesn't need explicit push - pass updates
  // are fetched via the JWT update endpoint
  console.log(\`Google Wallet object \${rows[0].google_object_id} will be updated on next open\`);
}

// ── Main push (fires both) ─────────────────────────────────
async function pushUpdate(userId) {
  await Promise.allSettled([pushApple(userId), pushGoogle(userId)]);
}

module.exports = { pushUpdate, pushApple, pushGoogle };
