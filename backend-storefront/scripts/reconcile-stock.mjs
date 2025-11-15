#!/usr/bin/env node
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, "../tmp")
const BATCH_SIZE = 50
const DELAY_MS = 120

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
  const csvPath = path.resolve(args.csv ?? path.join(__dirname, "../tmp/stock-mismatches.csv"))
  const outputDir = path.resolve(args.out ?? DEFAULT_OUTPUT_DIR)
  const backendUrl = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
  const adminApiKey = process.env.MEDUSA_ADMIN_API_KEY

  if (!adminApiKey) {
    throw new Error("MEDUSA_ADMIN_API_KEY is required")
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

  // Resolve default stock location
  const stockLocations = await fetchWithRetry(`${backendUrl}/admin/stock-locations`, { headers: authHeaders })
  const defaultLocation = stockLocations.stock_locations?.[0]?.id
  if (!defaultLocation) throw new Error("No stock locations found")

  const logPath = path.join(outputDir, "reconcile-stock-log.ndjson")
  const failuresPath = path.join(outputDir, "reconcile-stock-failures.ndjson")
  await ensureDir(outputDir)

  // Clear previous logs
  await (async () => {
    try { await fs.unlink(logPath) } catch {}
    try { await fs.unlink(failuresPath) } catch {}
  })()

  const updated = []
  const failed = []

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)
    console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(rows.length / BATCH_SIZE)} (${batch.length} items)`)
    for (const row of batch) {
      const productId = row.id
      const handle = row.handle
      const awinStock = row.awin_stock
      const medusaStock = row.medusa_stock
      if (!productId) {
        const entry = { type: "invalid", row, reason: "missing product id" }
        failed.push(entry)
        await appendLog(failuresPath, entry)
        continue
      }

      // Determine target stock: if AWIN says in_stock, set to 10; otherwise 0
      const targetStock = parseBoolean(awinStock) ? 10 : 0

      // Fetch product with variants to get inventory_item_id
      let product
      try {
        product = await fetchWithRetry(`${backendUrl}/admin/products/${productId}`, { headers: authHeaders })
      } catch (err) {
        const entry = { type: "fetch_error", productId, handle, reason: err.message }
        failed.push(entry)
        await appendLog(failuresPath, entry)
        console.error(`Failed to fetch product ${handle}: ${err.message}`)
        continue
      }

      const variants = product.product.variants ?? []
      if (variants.length === 0) {
        const entry = { type: "no_variants", productId, handle, reason: "no variants" }
        failed.push(entry)
        await appendLog(failuresPath, entry)
        continue
      }

      // Update inventory for each variant (single-variant products typical)
      for (const variant of variants) {
        const inventoryItemId = variant.inventory_items?.[0]?.id
        if (!inventoryItemId) {
          const entry = { type: "no_inventory_item", productId, handle, variantId: variant.id, reason: "no inventory_item_id" }
          failed.push(entry)
          await appendLog(failuresPath, entry)
          continue
        }

        try {
          await fetchWithRetry(`${backendUrl}/admin/inventory-items/${inventoryItemId}/location-levels/${defaultLocation}`, {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ stocked_quantity: targetStock }),
          })
          const entry = { type: "updated", productId, handle, variantId: variant.id, inventoryItemId, targetStock, previousStock: medusaStock }
          updated.push(entry)
          await appendLog(logPath, entry)
          console.log(`Updated stock for ${handle} variant ${variant.sku}: ${targetStock}`)
        } catch (err) {
          const entry = { type: "update_error", productId, handle, variantId: variant.id, inventoryItemId, reason: err.message }
          failed.push(entry)
          await appendLog(failuresPath, entry)
          console.error(`Failed to update stock for ${handle}: ${err.message}`)
        }

        await sleep(DELAY_MS)
      }
    }
  }

  const summary = {
    timestamp: new Date().toISOString(),
    defaultLocation,
    totals: {
      rows: rows.length,
      updated: updated.length,
      failed: failed.length,
    },
    outputs: {
      log: logPath,
      failures: failuresPath,
    },
  }
  const summaryPath = path.join(outputDir, "reconcile-stock-summary.json")
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8")
  console.log("Stock reconciliation summary:", summary)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
