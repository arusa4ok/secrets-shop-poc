# AWIN ↔ Medusa Sync Workflow

## Overview

Automated synchronization between AWIN CSV feed and Medusa backend:
- Detect missing SKUs in Medusa and batch import them
- Hide/archive Medusa-only products
- Reconcile stock discrepancies
- Daily cron with Slack notifications

## Scripts

### 1. Sync detection (`awin-medusa-sync.mjs`)
Downloads AWIN CSV, fetches Medusa products, normalizes slugs, and outputs discrepancy reports.

```bash
MEDUSA_BACKEND_URL=http://localhost:9000 NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY=pk_... node scripts/awin-medusa-sync.mjs --out tmp
```

Outputs:
- `missing-awin-products.csv` – products in AWIN but not in Medusa
- `medusa-only-products.csv` – products in Medusa but not in AWIN
- `stock-mismatches.csv` – stock differences
- `loose-matches.csv` – potential duplicates
- `sync-summary.json` – totals

### 2. Import missing AWIN products (`import-missing-awin.mjs`)
Batch creates products from `missing-awin-products.csv` via Admin API.

```bash
MEDUSA_ADMIN_API_KEY=... node scripts/import-missing-awin.mjs --csv tmp/missing-awin-products.csv --out tmp
```

Features:
- Idempotent: checks handle existence before create
- Adds required fields: sales_channels, status, single variant with price/inventory
- Rate limiting with exponential backoff on 429
- Logs successes/failures to NDJSON files
- Summary JSON with counts

### 3. Cleanup Medusa-only products (`cleanup-medusa-only.mjs`)
Sets Medusa-only products to `status: "draft"` (preserves order history).

```bash
MEDUSA_ADMIN_API_KEY=... node scripts/cleanup-medusa-only.mjs --csv tmp/medusa-only-products.csv --out tmp
```

### 4. Reconcile stock (`reconcile-stock.mjs`)
Updates inventory for stock mismatches using Inventory API.

```bash
MEDUSA_ADMIN_API_KEY=... node scripts/reconcile-stock.mjs --csv tmp/stock-mismatches.csv --out tmp
```

Logic:
- If AWIN `in_stock` = 1 → set stock to 10
- Otherwise set stock to 0
- Uses absolute `stocked_quantity` (idempotent)

### 5. Pilot import helper (`pilot-import.mjs`)
Creates a small CSV subset for testing before full import.

```bash
node scripts/pilot-import.mjs --csv tmp/missing-awin-products.csv --size 10 --out tmp
# Then import the pilot file
MEDUSA_ADMIN_API_KEY=... node scripts/import-missing-awin.mjs --csv tmp/pilot-missing-awin-10.csv --out tmp
```

## Automation (GitHub Actions)

### Required secrets
- `MEDUSA_BACKEND_URL` – e.g., `http://localhost:9000`
- `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` – store API key (read-only)
- `MEDUSA_ADMIN_API_KEY` – admin API key with write permissions
- `SLACK_WEBHOOK_URL` – optional, for notifications

### Workflow schedule
- Daily at 02:00 UTC (`0 2 * * *`)
- Manual trigger supported (`workflow_dispatch`)

### Artifacts
- `sync-reports` – CSV/JSON discrepancy reports (30-day retention)
- `operation-logs` – NDJSON logs and summaries (30-day retention)

### Notifications
Slack message includes:
- Missing in Medusa count
- Medusa-only products count
- Stock mismatches count
- Link to workflow run

## Important Notes

### Admin API key
- Generate in Medusa Admin → Settings → API Keys
- Required for write operations (import, cleanup, stock)
- Store as GitHub secret

### Sales channels & stock locations
- Scripts auto-resolve first sales channel and stock location
- Ensure you have at least one of each in Medusa

### Variant handling
- Current scripts treat each CSV row as a single-variant product
- If AWIN contains color/size variants, adjust import script to group by base product

### Duplicate handles
- Medusa rejects duplicate handles
- If multiple AWIN products normalize to same slug, consider suffix strategy or SKU-based handles

### External images
- Medusa may not auto-download external AWIN image URLs
- If images don't appear, upload to CDN or use Medusa file upload API

### Rate limits
- Scripts include 100-200ms delays between requests
- Exponential backoff on 429 responses
- Monitor runtime; 2k products + 2.4k inventory updates ≈ 15-20 minutes

### Idempotency
- Import checks handle existence before create
- Stock updates use absolute quantities
- Logs allow resuming from failures

## Testing

1. Run pilot import (10 products) and verify in Medusa Admin
2. Check inventory updates are reflected
3. Review logs for any failures
4. Manually trigger GitHub Actions workflow to test end-to-end

## Troubleshooting

- **429 errors**: Increase `DELAY_MS` or add more retries
- **Missing sales channel**: Verify Medusa has at least one sales channel
- **Image URLs not loading**: Upload images to CDN first
- **Duplicate handles**: Adjust slugification or add suffixes
- **Inventory not updating**: Ensure stock location exists and inventory items are linked
