#!/usr/bin/env node
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

console.log(`
=== AWIN ↔ Medusa Sync API Key Setup ===

The sync scripts require an admin API key with write permissions.
Here's how to create one:

1. Open Admin Dashboard: http://localhost:9000/app/
2. Login with: rusa4ok@gmail.com / admin123
3. Click Settings (gear icon) in sidebar
4. Go to "API Keys" section
5. Click "Add API Key" or "Create API Key"
6. Configure:
   - Name: AWIN Sync Script
   - Type: Secret Key (for write operations)
   - Permissions:
     * Products: read/write
     * Inventory: read/write
     * Sales Channels: read
     * Stock Locations: read
7. Copy the generated key (should start with apk_)

Then set it as an environment variable:

export MEDUSA_ADMIN_API_KEY="apk_your_key_here"

Or add it to GitHub secrets:
gh secret set MEDUSA_ADMIN_API_KEY --body "apk_your_key_here"

After setting the key, test with:
node scripts/test-auth.mjs

Then run the pilot import:
MEDUSA_ADMIN_API_KEY="apk_your_key_here" node scripts/import-missing-awin.mjs --csv tmp/pilot-missing-awin-10.csv --out tmp

=== Current Status ===
- Publishable key (read-only): pk_7c4f9e1d989d9594f3a63f5256e895452a5622d49b083e8cff3d5cbd4dd793ea
- Admin API key: NEEDS TO BE CREATED
- Backend URL: http://localhost:9000
- Admin Dashboard: http://localhost:9000/app/

=== Next Steps ===
1. Create the admin API key using the steps above
2. Test authentication with the new key
3. Run pilot import with 10 products
4. If successful, proceed with full import
`)
