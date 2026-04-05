
/**
 * passService.js
 * Builds the Apple Wallet .pkpass JSON dynamically
 * and handles Google Wallet object updates.
 *
 * THE MORPHING PASS:
 *   - One pass per user
 *   - logo, strip image, color morph to active merchant
 *   - back fields list ALL merchant balances
 */

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const forge  = require('node-forge');
const archiver = require('archiver');
const db     = require('../config/db');

const PASS_TYPE_ID = process.env.PASS_TYPE_ID || 'pass.com.nuqati.loyalty';
const TEAM_ID      = process.env.TEAM_ID      || 'XXXXXXXXXX';
const BASE_URL     = process.env.BASE_URL      || 'https://api.nuqati.app';

// ── Build pass.json payload ────────────────────────────────
async function buildPassData(userId, activeMerchantId) {
  // Get user
  const { rows: uRows } = await db.query('SELECT * FROM users WHERE id=$1',[userId]);
  if (!uRows.length) throw new Error('User not found');
  const user = uRows[0];

  // Get active merchant
  const { rows: mRows } = await db.query(
    'SELECT * FROM merchants WHERE id=$1',[activeMerchantId]
  );
  const merchant = mRows[0];

  // Get ALL merchant balances for back fields
  const { rows: allBalances } = await db.query(\`
    SELECT m.name, m.name_ar, m.loyalty_mode, m.stamp_reward,
           m.stamps_required, m.brand_color,
           lb.stamps_current, lb.points_balance, lb.cashback_balance,
           lb.rewards_earned, lb.last_visit_at
    FROM loyalty_balances lb
    JOIN merchants m ON m.id = lb.merchant_id
    WHERE lb.user_id = $1
    ORDER BY lb.last_visit_at DESC
  \`, [userId]);

  // Get merchant locations for geofencing (up to 10)
  const { rows: locs } = await db.query(\`
    SELECT
      ST_Y(location::geometry) AS latitude,
      ST_X(location::geometry) AS longitude,
      name, radius_m
    FROM merchant_locations
    WHERE merchant_id = $1
    LIMIT 10
  \`, [activeMerchantId]);

  // ── Build primary field based on loyalty mode ──────────
  let primaryFields = [], secondaryFields = [], auxiliaryFields = [];

  if (merchant?.loyalty_mode === 'stamps') {
    const bal = allBalances.find(b => b.name === merchant.name) || {};
    const stamps  = bal.stamps_current || 0;
    const target  = merchant.stamps_required || 10;
    const stampBar = '■'.repeat(stamps) + '□'.repeat(Math.max(target - stamps, 0));
    primaryFields = [{ key:'stamps', label:'طوابعك', value: \`\${stamps} / \${target}\` }];
    secondaryFields = [
      { key:'progress', label:'التقدم', value: stampBar },
      { key:'reward',   label:'المكافأة', value: merchant.stamp_reward || 'مكافأة' }
    ];
  } else if (merchant?.loyalty_mode === 'points') {
    const bal = allBalances.find(b => b.name === merchant.name) || {};
    primaryFields = [{ key:'points', label:'نقاطك', value: (bal.points_balance||0).toLocaleString('ar-IQ') }];
    secondaryFields = [{ key:'pts_label', label:'', value: 'نقطة' }];
  } else if (merchant?.loyalty_mode === 'cashback') {
    const bal = allBalances.find(b => b.name === merchant.name) || {};
    primaryFields = [{ key:'cashback', label:'رصيد الكاش باك', value: \`\${Math.floor(bal.cashback_balance||0).toLocaleString()} د.ع\` }];
  } else {
    // Default / no active merchant
    primaryFields = [{ key:'welcome', label:'NuqaTi', value: 'مرحباً بك' }];
  }

  // ── Build BACK FIELDS (all merchants summary) ──────────
  const backFields = allBalances.map((b, i) => {
    let val = '';
    if (b.loyalty_mode === 'stamps')  val = \`\${b.stamps_current}/\${b.stamps_required} طوابع\`;
    if (b.loyalty_mode === 'points')  val = \`\${Math.floor(b.points_balance).toLocaleString()} نقطة\`;
    if (b.loyalty_mode === 'cashback')val = \`\${Math.floor(b.cashback_balance).toLocaleString()} د.ع\`;
    return {
      key:           \`merchant_\${i}\`,
      label:         b.name_ar || b.name,
      value:         val,
      textAlignment: 'PKTextAlignmentRight',
    };
  });

  // Header fields
  const headerFields = [{ key:'merchant_name', label:'', value: merchant?.name || 'NuqaTi' }];

  // ── Assemble pass.json ─────────────────────────────────
  const passJson = {
    formatVersion:       1,
    passTypeIdentifier:  PASS_TYPE_ID,
    serialNumber:        user.apple_pass_serial || \`nq-\${userId.slice(0,8)}\`,
    teamIdentifier:      TEAM_ID,
    webServiceURL:       \`\${BASE_URL}/v1/\`,
    authenticationToken: await getAuthToken(userId),

    organizationName:    'NuqaTi',
    description:        \`بطاقة ولاء \${merchant?.name || 'NuqaTi'}\`,
    logoText:            merchant?.name || 'NuqaTi',

    // ── MORPHING COLORS ──────────────────────────────────
    backgroundColor:     merchant?.brand_color ? hexToRgb(merchant.brand_color) : 'rgb(124,58,237)',
    foregroundColor:     'rgb(255,255,255)',
    labelColor:          'rgb(255,230,200)',

    // ── BARCODES (shows user phone as QR) ───────────────
    barcodes: [{
      message:         user.phone,
      format:          'PKBarcodeFormatQR',
      messageEncoding: 'iso-8859-1',
      altText:         user.name || user.phone,
    }],

    // ── GEOFENCING (up to 10 locations) ─────────────────
    locations: locs.map(l => ({
      longitude:          l.longitude,
      latitude:           l.latitude,
      relevantText:       \`أنت قريب من \${merchant?.name || 'المحل'}! 🎁\`,
      maxDistance:        l.radius_m || 100,
    })),

    // ── PASS CONTENT ─────────────────────────────────────
    storeCard: {
      headerFields,
      primaryFields,
      secondaryFields,
      auxiliaryFields,
      backFields: [
        { key:'member_id', label:'رقم العضوية', value: user.phone },
        { key:'member_name', label:'الاسم', value: user.name || '' },
        ...backFields,
        { key:'nuqati_footer', label:'', value: 'NuqaTi – نقاطي | nuqati.app' },
      ],
    },

    // ── IMAGES (morphs per merchant) ─────────────────────
    // Actual images bundled separately in .pkpass zip
    // These URLs used for Google Wallet (doesn't use zip)
    _imageUrls: {
      logo:  merchant?.logo_url  || \`\${BASE_URL}/static/default-logo.png\`,
      strip: merchant?.strip_image_url || \`\${BASE_URL}/static/default-strip.png\`,
      icon:  \`\${BASE_URL}/static/icon.png\`,
    },
  };

  return passJson;
}

// ── Generate .pkpass (zip) for Apple ───────────────────────
async function generatePkpass(userId, activeMerchantId) {
  const passJson = await buildPassData(userId, activeMerchantId);

  // Remove internal helper key
  const { _imageUrls, ...cleanPass } = passJson;

  const passJsonStr = JSON.stringify(cleanPass, null, 2);

  // Compute manifest (SHA1 of each file)
  const manifest = {
    'pass.json': sha1(passJsonStr),
  };

  // Load static assets
  const assetsDir = path.join(__dirname, '../../passes/assets');
  const assetFiles = ['icon.png', 'icon@2x.png', 'logo.png', 'logo@2x.png',
                      'strip.png', 'strip@2x.png', 'background.png'];

  const includedAssets = {};
  for (const f of assetFiles) {
    const fp = path.join(assetsDir, f);
    if (fs.existsSync(fp)) {
      const buf = fs.readFileSync(fp);
      manifest[f] = sha1(buf.toString('binary'));
      includedAssets[f] = buf;
    }
  }

  const manifestStr = JSON.stringify(manifest);

  // Sign manifest with PassKit cert
  const signature = signManifest(manifestStr);

  // Create .pkpass zip
  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('data', d => chunks.push(d));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);

    archive.append(passJsonStr, { name: 'pass.json' });
    archive.append(manifestStr, { name: 'manifest.json' });
    archive.append(signature,   { name: 'signature' });

    for (const [name, buf] of Object.entries(includedAssets)) {
      archive.append(buf, { name });
    }
    archive.finalize();
  });
}

// ── Sign manifest with PassKit cert ──────────────────────
function signManifest(manifest) {
  try {
    const certPem  = fs.readFileSync(process.env.PASS_CERT_PATH || './passes/certs/passcert.pem','utf8');
    const keyPem   = fs.readFileSync(process.env.PASS_KEY_PATH  || './passes/certs/passkey.pem','utf8');
    const wwdrPem  = fs.readFileSync(process.env.WWDR_CERT_PATH || './passes/certs/wwdr.pem','utf8');

    const cert  = forge.pki.certificateFromPem(certPem);
    const key   = forge.pki.privateKeyFromPem(keyPem);
    const wwdr  = forge.pki.certificateFromPem(wwdrPem);

    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(manifest, 'utf8');
    p7.addCertificate(cert);
    p7.addCertificate(wwdr);
    p7.addSigner({
      key, certificate: cert,
      digestAlgorithm: forge.pki.oids.sha256,
      authenticatedAttributes: [{
        type: forge.pki.oids.contentType,
        value: forge.pki.oids.data,
      },{
        type: forge.pki.oids.messageDigest,
      },{
        type: forge.pki.oids.signingTime,
        value: new Date(),
      }],
    });
    p7.sign({ detached: true });
    const der = forge.asn1.toDer(p7.toAsn1()).getBytes();
    return Buffer.from(der, 'binary');
  } catch (e) {
    console.warn('Pass signing failed (certs not configured):', e.message);
    return Buffer.from('PLACEHOLDER_SIGNATURE');
  }
}

// ── Helpers ───────────────────────────────────────────────
function sha1(data) {
  return crypto.createHash('sha1').update(data).digest('hex');
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return \`rgb(\${r},\${g},\${b})\`;
}

async function getAuthToken(userId) {
  const { rows } = await db.query(
    'SELECT auth_token FROM wallet_passes WHERE user_id=$1',[userId]
  );
  return rows[0]?.auth_token || crypto.randomBytes(32).toString('hex');
}

module.exports = { buildPassData, generatePkpass };
