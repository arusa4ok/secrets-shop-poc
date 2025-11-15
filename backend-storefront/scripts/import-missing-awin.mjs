#!/usr/bin/env node
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, "../tmp")
const BATCH_SIZE = 50
const DELAY_MS = 150

function parseArgs(argv) {
  const result = {}
  for (const arg of argv.slice(2)) {
    const match = /^--([^=]+)(?:=(.*))?$/.exec(arg)
    if (!match) continue
    const [, key, value] = match
    result[key] = value ?? true
  }
  return result
}

function slugify(value) {
  if (!value) return ""
  return value
    .toString()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }
  const headers = splitCsvLine(lines[0])
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line)
    const record = {}
    headers.forEach((header, idx) => {
      record[header] = cells[idx] ?? ""
    })
    return record
  })
  return { headers, rows }
}

function splitCsvLine(line) {
  const cells = []
  let buffer = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '"') {
      if (line[i + 1] === '"') {
        buffer += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === ";" && !inQuotes) {
      cells.push(buffer)
      buffer = ""
    } else {
      buffer += char
    }
  }
  cells.push(buffer)
  return cells.map((cell) => cell.trim())
}

function parsePrice(value) {
  if (!value) return null
  const numeric = parseFloat(value.replace(/[^0-9.,]/g, "").replace(",", "."))
  return Number.isFinite(numeric) ? numeric : null
}

function parseBoolean(value) {
  return ["1", "true", "yes", "y"].includes(value?.toLowerCase?.() ?? "")
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJson(url, options = {}) {
  const resp = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`HTTP ${resp.status}: ${text}`)
  }
  return resp.json()
}

async function fetchWithRetry(url, options = {}, retries = 5, initialDelay = 150) {
  let delay = initialDelay
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetchJson(url, options)
    } catch (err) {
      if (i === retries || !err.message.includes("429")) throw err
      console.warn(`Rate limited, retrying in ${delay}ms (attempt ${i + 1}/${retries + 1})`)
      await sleep(delay)
      delay *= 2
    }
  }
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function appendLog(filePath, entry) {
  await fs.appendFile(filePath, JSON.stringify(entry) + "\n", "utf8")
}

async function main() {
  const args = parseArgs(process.argv)
  const csvPath = path.resolve(args.csv === true ? path.join(__dirname, "../tmp/missing-awin-products.csv") : args.csv ?? path.join(__dirname, "../tmp/missing-awin-products.csv"))
  const outputDir = path.resolve(args.out === true ? DEFAULT_OUTPUT_DIR : args.out ?? DEFAULT_OUTPUT_DIR)
  const backendUrl = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
  const adminApiKey = process.env.MEDUSA_ADMIN_API_KEY

  if (!adminApiKey) {
    throw new Error("MEDUSA_ADMIN_API_KEY is required for writes")
  }

  const csvContent = await fs.readFile(csvPath, "utf8")
  const { rows } = parseCsv(csvContent)

  // Get JWT token first
  const authResponse = await fetchJson(`${backendUrl}/auth/user/emailpass`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "rusa4ok@gmail.com",
      password: "admin123"
    })
  })
  const jwtToken = authResponse.token
  const authHeaders = { Authorization: `Bearer ${jwtToken}` }

  // Resolve required IDs once
  const salesChannels = await fetchWithRetry(`${backendUrl}/admin/sales-channels`, { headers: authHeaders })
  const stockLocations = await fetchWithRetry(`${backendUrl}/admin/stock-locations`, { headers: authHeaders })
  const shippingProfiles = await fetchWithRetry(`${backendUrl}/admin/shipping-profiles?limit=1`, { headers: authHeaders })
  
  const defaultSalesChannel = salesChannels.sales_channels?.[0]?.id
  const defaultLocation = stockLocations.stock_locations?.[0]?.id
  const defaultShippingProfile = shippingProfiles.shipping_profiles?.[0]?.id
  
  if (!defaultSalesChannel) throw new Error("No sales channels found")
  if (!defaultLocation) throw new Error("No stock locations found")
  if (!defaultShippingProfile) throw new Error("No shipping profiles found")

  const logPath = path.join(outputDir, "import-missing-awin-log.ndjson")
  const failuresPath = path.join(outputDir, "import-missing-awin-failures.ndjson")
  await ensureDir(outputDir)

  // Clear previous logs
  await (async () => {
    try { await fs.unlink(logPath) } catch {}
    try { await fs.unlink(failuresPath) } catch {}
  })()

  const created = []
  const skipped = []
  const failed = []

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(rows.length / BATCH_SIZE)} (${batch.length} items)`)
    for (const row of batch) {
      const handle = slugify(row.normalized_slug ?? "")
      if (!handle) {
        const entry = { type: "invalid", row, reason: "empty handle" }
        failed.push(entry)
        await appendLog(failuresPath, entry)
        continue
      }

      // Idempotency check
      try {
        const existing = await fetchWithRetry(`${backendUrl}/admin/products?handle=${encodeURIComponent(handle)}&limit=1`, { headers: authHeaders })
        if (existing.products?.length) {
          const entry = { type: "skip", handle, reason: "already exists", id: existing.products[0].id }
          skipped.push(entry)
          await appendLog(logPath, entry)
          continue
        }
      } catch (err) {
        const entry = { type: "lookup_error", handle, reason: err.message }
        failed.push(entry)
        await appendLog(failuresPath, entry)
        continue
      }

      const price = parsePrice(row.price)
      if (price === null) {
        const entry = { type: "invalid", row, reason: "invalid price" }
        failed.push(entry)
        await appendLog(failuresPath, entry)
        continue
      }

      const payload = {
        handle,
        title: row.product_name || handle,
        description: row.description || "",
        status: "published",
        shipping_profile_id: defaultShippingProfile,
        sales_channels: [{ id: defaultSalesChannel }],
        options: [
          {
            title: "Default",
            values: ["Default"]
          }
        ],
        variants: [
          {
            title: row.product_name || handle,
            sku: row.product_id || handle,
            ean: row.ean || row.gtin || undefined,
            prices: [{ amount: Math.round(price * 100), currency_code: "gbp" }],
            manage_inventory: true,
            options: {
              "Default": "Default"
            }
          },
        ],
        images: row.image_url ? [{ url: row.image_url }] : [],
      }

      const bodyStr = JSON.stringify(payload)
      console.log(`Creating product with handle: ${handle}`)
      console.log(`Body length: ${bodyStr.length}`)
      console.log(`Body:`, bodyStr.substring(0, 500) + "...")
      
      try {
        const response = await fetch(`${backendUrl}/admin/products`, {
          method: "POST",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json"
          },
          body: bodyStr,
        })
        
        if (!response.ok) {
          const errorText = await response.text()
          throw new Error(`HTTP ${response.status}: ${errorText}`)
        }
        
        const createdProduct = await response.json()

        // Create inventory item for the variant
        const variant = createdProduct.product.variants[0]
        if (variant && parseBoolean(row.in_stock)) {
          try {
            await fetchWithRetry(`${backendUrl}/admin/inventory-items`, {
              method: "POST",
              headers: authHeaders,
              body: JSON.stringify({
                sku: variant.sku,
                title: variant.title,
                requires_shipping: true
              })
            })
          } catch (invErr) {
            console.warn(`Failed to create inventory for ${handle}:`, invErr.message)
          }
        }

        const entry = { type: "created", handle, id: createdProduct.product.id, title: createdProduct.product.title }
        created.push(entry)
        await appendLog(logPath, entry)
        console.log(`Created product ${handle} (${createdProduct.product.id})`)
      } catch (err) {
        const entry = { type: "create_error", handle, reason: err.message, payload }
        failed.push(entry)
        await appendLog(failuresPath, entry)
        console.error(`Failed to create ${handle}: ${err.message}`)
      }

      await sleep(DELAY_MS)
    }
  }

  const summary = {
    timestamp: new Date().toISOString(),
    totals: {
      rows: rows.length,
      created: created.length,
      skipped: skipped.length,
      failed: failed.length,
    },
    outputs: {
      log: logPath,
      failures: failuresPath,
    },
  }
  const summaryPath = path.join(outputDir, "import-missing-awin-summary.json")
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8")
  console.log("Import summary:", summary)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
