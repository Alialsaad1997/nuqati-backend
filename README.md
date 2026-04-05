# NuqaTi – نقاطي
### Digital Loyalty SaaS for Basra, Iraq

---

## Architecture

```
nuqati/
├── src/
│   ├── index.js              ← Express app entry
│   ├── config/db.js          ← PostgreSQL pool
│   ├── middleware/auth.js    ← JWT auth
│   ├── routes/
│   │   ├── auth.js           ← Login / register
│   │   ├── merchants.js      ← Merchant CRUD + QR + locations
│   │   ├── users.js          ← User register + summary
│   │   ├── scan.js           ← QR scan → stamps/points/cashback
│   │   ├── passes.js         ← .pkpass download + JSON
│   │   ├── appleWallet.js    ← Apple PassKit Web Service
│   │   └── admin.js          ← Super admin panel
│   └── services/
│       ├── passService.js    ← MORPHING PASS builder
│       └── pushService.js    ← APN + Google push
├── database_schema.sql       ← Full PostgreSQL schema
├── PASS_SAMPLES.json         ← Apple + Google pass JSON samples
└── .env.example

```

## Key Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/auth/login` | Merchant/admin login |
| GET  | `/api/merchants/me` | Dashboard stats |
| POST | `/api/merchants` | Create merchant (admin) |
| PATCH| `/api/merchants/me` | Update loyalty mode |
| GET  | `/api/merchants/me/qr` | Download QR PNG |
| POST | `/api/merchants/me/locations` | Add geofence point |
| POST | `/api/users/register` | Register user → get pass |
| POST | `/api/scan` | **CORE: Scan QR → update pass** |
| GET  | `/api/passes/:phone` | Download .pkpass |
| POST | `/api/admin/broadcasts/:id/approve` | Approve broadcast |

## Setup Steps

### 1. PostgreSQL
```bash
createdb nuqati
psql nuqati < database_schema.sql
```

### 2. Apple Developer Setup
1. Create **Pass Type ID**: `pass.com.nuqati.loyalty`
2. Download **Pass Type Certificate** from Apple Developer portal
3. Export as `.p12` → convert to PEM:
   ```bash
   openssl pkcs12 -in cert.p12 -clcerts -nokeys -out passes/certs/passcert.pem
   openssl pkcs12 -in cert.p12 -nocerts -nodes  -out passes/certs/passkey.pem
   curl https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer \
     -o passes/certs/wwdr.pem
   ```

### 3. Google Wallet Setup
1. Create Google Wallet API project
2. Create **Loyalty Class** with issuer ID
3. Download service account JSON → set env vars

### 4. Environment
```bash
cp .env.example .env
# Fill in DB credentials, Apple certs paths, Google credentials
```

### 5. Run
```bash
npm install
npm start
```

## The Morphing Pass – How It Works

1. **User scans Merchant A QR** → `POST /api/scan`
2. Server updates `users.active_merchant_id = merchant_A`
3. Server calls `passService.buildPassData(userId, merchantA.id)`
4. Pass JSON assembles with:
   - `backgroundColor` = Merchant A's brand color
   - `primaryFields` = Merchant A's stamps/points
   - `backFields` = ALL merchants summary index
   - `locations` = Merchant A's GPS coordinates (geofence)
5. Server calls `pushService.pushUpdate(userId)` → empty APN push
6. Apple server calls `GET /v1/passes/:passTypeId/:serial`
7. Server returns fresh `.pkpass` with new colors/content
8. **Pass morphs on user's phone in real-time** ✓

## Loyalty Modes (3-Click Dashboard Toggle)

| Mode | Config | Per-scan action |
|------|--------|-----------------|
| `stamps` | `stamps_required`, `stamp_reward` | +1 stamp, reward when complete |
| `points` | `points_per_iqd` | `amount_iqd × rate` added |
| `cashback` | `cashback_pct` | `amount_iqd × pct%` added |

