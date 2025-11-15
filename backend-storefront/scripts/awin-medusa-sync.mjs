#!/usr/bin/env node
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, "../tmp")

const ARG_PATTERN = /^--([^=]+)(?:=(.*))?$/

function parseArgs(argv) {
  const result = {}
  for (const arg of argv.slice(2)) {
    const match = ARG_PATTERN.exec(arg)
    if (!match) {
      continue
    }
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

const DESCRIPTOR_WORDS = new Set([
  "rechargeable",
  "dual",
  "powerful",
  "automatic",
  "classic",
  "premium",
  "petite",
  "mini",
  "massager",
  "masturbator",
  "stimulator",
  "vibrator",
  "intense",
  "edition",
  "bundle",
  "kit",
  "set",
  "app",
  "controlled",
  "remote",
  "wireless",
  "silicone",
  "waterproof",
  "usb",
  "charging",
  "magnetic",
  "suction",
  "tongue",
  "rabbit",
  "classic",
  "plus",
  "pro",
  "ultra",
  "advanced",
  "pleasure",
  "toy",
  "sex",
  "adult",
])

const COLOR_WORDS = new Set([
  "black",
  "pink",
  "purple",
  "violet",
  "blue",
  "navy",
  "red",
  "rose",
  "gold",
  "rose-gold",
  "silver",
  "platinum",
  "lilac",
  "white",
  "clear",
  "transparent",
  "nude",
  "tan",
  "aqua",
  "teal",
  "green",
  "yellow",
])

const LENGTH_PATTERN = /^(\d+)(cm|mm|in|inch)?$/

function descriptorKey(slug) {
  if (!slug) return ""
  const tokens = slug.split("-").filter(Boolean)
  const filtered = tokens.filter((token) => {
    if (token.length === 0) return false
    if (DESCRIPTOR_WORDS.has(token)) return false
    if (COLOR_WORDS.has(token)) return false
    if (COLOR_WORDS.has(token.replace(/-/g, ""))) return false
    if (LENGTH_PATTERN.test(token)) return false
    if (/^(xl|xs|sm|md|lg|xxl|xxxl)$/.test(token)) return false
    return true
  })
  return filtered.length ? filtered.join("-") : slug
}

function parseCsv(content) {
  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length === 0) {
    return { headers: [], rows: [] }
  }
  const headers = splitCsvLine(lines[0])
  const rows = lines.slice(1).map((line) => {
    const cells = splitCsvLine(line)
    const record = {}
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? ""
    })
    return record
  })
  return { headers, rows }
}

function splitCsvLine(line) {
  const cells = []
  let buffer = ""
  let inQuotes = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '\"') {
      if (line[i + 1] === '\"') {
        buffer += '\"'
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

function parsePrice(value) {
  if (!value) return null
  const numeric = parseFloat(value.replace(/[^0-9.,]/g, "").replace(",", "."))
  return Number.isFinite(numeric) ? numeric : null
}

async function fetchAllProducts(baseUrl, publishableKey) {
  const results = []
  const limit = 100
  let offset = 0
  while (true) {
    const url = new URL("/store/products", baseUrl)
    url.searchParams.set("limit", String(limit))
    url.searchParams.set("offset", String(offset))
    const response = await fetch(url, {
      headers: {
        "x-publishable-api-key": publishableKey,
      },
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Failed to fetch products: ${response.status} ${text}`)
    }
    const data = await response.json()
    const products = data.products ?? []
    results.push(...products)
    if (products.length < limit) {
      break
    }
    offset += limit
  }
  return results
}

function getMedusaPrice(product) {
  for (const variant of product.variants ?? []) {
    for (const price of variant.prices ?? []) {
      if (price.currency_code === "gbp" && typeof price.amount === "number") {
        return price.amount / 100
      }
    }
  }
  return null
}

function getMedusaInventory(product) {
  let total = 0
  for (const variant of product.variants ?? []) {
    if (typeof variant.inventory_quantity === "number") {
      total += variant.inventory_quantity
    }
  }
  return total
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

function toCsvRow(values) {
  return values
    .map((value) => {
      if (value === null || value === undefined) return ""
      const str = String(value)
      if (str.includes(";") || str.includes("\n") || str.includes('"')) {
        return `"${str.replace(/"/g, '""')}"`
      }
      return str
    })
    .join(";")
}

async function writeCsv(filePath, headers, rows) {
  const headerLine = headers.join(";")
  const body = rows.map((row) => toCsvRow(headers.map((header) => row[header]))).join("\n")
  const content = `${headerLine}\n${body}`
  await fs.writeFile(filePath, content, "utf8")
}

async function main() {
  const args = parseArgs(process.argv)
  const awinPath = path.resolve(args.awin ?? path.join(__dirname, "../tmp/awin.csv"))
  const outputDir = path.resolve(args.out ?? DEFAULT_OUTPUT_DIR)
  const backendUrl = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"
  const publishableKey = process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY

  if (!publishableKey) {
    throw new Error("NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY is required")
  }

  const awinContent = await fs.readFile(awinPath, "utf8")
  const { rows: awinRows } = parseCsv(awinContent)

  const medusaProducts = await fetchAllProducts(backendUrl, publishableKey)

  const medusaByHandle = new Map()
  const medusaByLooseKey = new Map()
  const matchedHandles = new Set()

  for (const product of medusaProducts) {
    const handle = slugify(product.handle ?? "")
    if (!handle) continue
    medusaByHandle.set(handle, product)
    const looseKey = descriptorKey(handle)
    if (!medusaByLooseKey.has(looseKey)) {
      medusaByLooseKey.set(looseKey, [])
    }
    medusaByLooseKey.get(looseKey).push(product)
  }

  const missingRecords = []
  const medusaOnlyHandles = new Set(medusaByHandle.keys())
  const looseMatches = []
  const stockIssues = []

  const awinIndex = new Map()

  for (const row of awinRows) {
    const deepLink = row.deep_link ?? ""
    let slugSegment = ""
    try {
      const url = new URL(deepLink)
      const segments = url.pathname.split("/").filter(Boolean)
      slugSegment = segments.pop() ?? ""
    } catch {
      slugSegment = deepLink.split("/").filter(Boolean).pop() ?? ""
    }
    const normalizedSlug = slugify(slugSegment)
    const looseKey = descriptorKey(normalizedSlug)
    awinIndex.set(normalizedSlug, row)

    let matchedProduct = medusaByHandle.get(normalizedSlug)
    let matchType = "exact"
    if (!matchedProduct) {
      const candidates = medusaByLooseKey.get(looseKey) ?? []
      if (candidates.length === 1) {
        matchedProduct = candidates[0]
        matchType = "loose"
      }
    }

    if (matchedProduct) {
      matchedHandles.add(matchedProduct.handle)
      medusaOnlyHandles.delete(slugify(matchedProduct.handle))
      if (matchType === "loose") {
        looseMatches.push({
          awin_slug: normalizedSlug,
          medusa_handle: matchedProduct.handle,
          comparison_key: looseKey,
        })
      }

      const awinInStock = parseBoolean(row.in_stock) || row.StockStatus === "100"
      const medusaStock = getMedusaInventory(matchedProduct)
      if (awinInStock && medusaStock <= 0) {
        stockIssues.push({
          handle: matchedProduct.handle,
          title: matchedProduct.title,
          awin_in_stock: true,
          medusa_stock: medusaStock,
        })
      }
      continue
    }

    const price = parsePrice(row.price)
    const record = {
      product_id: row.product_id ?? "",
      product_name: row.product_name ?? "",
      normalized_slug: normalizedSlug,
      comparison_key: looseKey,
      price: price ?? "",
      price_currency: "GBP",
      deep_link: row.deep_link ?? "",
      image_url: row.image_url ?? "",
      gtin: row.gtin ?? row.Ean ?? "",
      ean: row.Ean ?? row.gtin ?? "",
      description: row.description ?? "",
      brand: row.brand_name ?? "",
      in_stock: parseBoolean(row.in_stock) || row.StockStatus === "100",
      stock_status: row.StockStatus ?? "",
      merchant_category: row.merchant_category ?? "",
    }
    missingRecords.push(record)
  }

  const medusaOnly = Array.from(medusaOnlyHandles).map((handle) => {
    const product = medusaByHandle.get(handle)
    return {
      handle,
      comparison_key: descriptorKey(handle),
      title: product?.title ?? "",
      id: product?.id ?? "",
    }
  })

  await ensureDir(outputDir)

  const missingCsvPath = path.join(outputDir, "missing-awin-products.csv")
  const missingJsonPath = path.join(outputDir, "missing-awin-products.json")
  await writeCsv(
    missingCsvPath,
    [
      "product_id",
      "product_name",
      "normalized_slug",
      "comparison_key",
      "price",
      "price_currency",
      "deep_link",
      "image_url",
      "gtin",
      "ean",
      "description",
      "brand",
      "in_stock",
      "stock_status",
      "merchant_category",
    ],
    missingRecords,
  )
  await fs.writeFile(missingJsonPath, JSON.stringify(missingRecords, null, 2), "utf8")

  const medusaOnlyCsvPath = path.join(outputDir, "medusa-only-products.csv")
  await writeCsv(
    medusaOnlyCsvPath,
    ["id", "handle", "comparison_key", "title"],
    medusaOnly,
  )

  const stockIssuesCsvPath = path.join(outputDir, "stock-mismatches.csv")
  await writeCsv(
    stockIssuesCsvPath,
    ["handle", "title", "awin_in_stock", "medusa_stock"],
    stockIssues,
  )

  const looseMatchesPath = path.join(outputDir, "loose-handle-matches.json")
  await fs.writeFile(looseMatchesPath, JSON.stringify(looseMatches, null, 2), "utf8")

  const summaryPath = path.join(outputDir, "awin-medusa-summary.json")
  const summary = {
    totals: {
      awin_rows: awinRows.length,
      medusa_products: medusaProducts.length,
      missing_in_medusa: missingRecords.length,
      medusa_only: medusaOnly.length,
      stock_issues: stockIssues.length,
      loose_matches: looseMatches.length,
    },
    outputs: {
      missing_csv: missingCsvPath,
      missing_json: missingJsonPath,
      medusa_only_csv: medusaOnlyCsvPath,
      stock_mismatches_csv: stockIssuesCsvPath,
      loose_matches_json: looseMatchesPath,
    },
  }
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), "utf8")

  console.log("AWIN/Medusa sync report created:")
  console.log(JSON.stringify(summary, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
