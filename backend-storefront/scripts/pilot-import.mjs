#!/usr/bin/env node
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const DEFAULT_OUTPUT_DIR = path.resolve(__dirname, "../tmp")
const PILOT_SIZE = 10

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

function formatCsvRow(headers, row) {
  return headers
    .map((h) => {
      const val = row[h] ?? ""
      if (val.includes(";") || val.includes("\n") || val.includes('"')) {
        return `"${val.replace(/"/g, '""')}"`
      }
      return val
    })
    .join(";")
}

function formatCsv(headers, rows) {
  return [headers.join(";"), ...rows.map((r) => formatCsvRow(headers, r))].join("\n")
}

async function main() {
  const args = parseArgs(process.argv)
  const csvPath = path.resolve(args.csv === true ? path.join(__dirname, "../tmp/missing-awin-products.csv") : args.csv ?? path.join(__dirname, "../tmp/missing-awin-products.csv"))
  const outputDir = path.resolve(args.out === true ? DEFAULT_OUTPUT_DIR : args.out ?? DEFAULT_OUTPUT_DIR)
  const pilotSize = parseInt(args.size, 10) || PILOT_SIZE

  const csvContent = await fs.readFile(csvPath, "utf8")
  const { headers, rows } = parseCsv(csvContent)

  const pilotRows = rows.slice(0, pilotSize)
  const pilotCsv = formatCsv(headers, pilotRows)
  const pilotPath = path.join(outputDir, `pilot-missing-awin-${pilotSize}.csv`)
  await fs.writeFile(pilotPath, pilotCsv, "utf8")

  console.log(`Created pilot CSV with ${pilotRows.length} rows at ${pilotPath}`)
  console.log("Run import with:")
  console.log(`MEDUSA_ADMIN_API_KEY=... node scripts/import-missing-awin.mjs --csv ${pilotPath} --out ${outputDir}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
