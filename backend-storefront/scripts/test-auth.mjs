#!/usr/bin/env node

const backendUrl = process.env.MEDUSA_BACKEND_URL ?? "http://localhost:9000"

async function testAuth() {
  // Try JWT token approach
  console.log("Testing JWT authentication...")
  try {
    const loginResp = await fetch(`${backendUrl}/admin/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "rusa4ok@gmail.com",
        password: "admin123"
      })
    })
    const loginText = await loginResp.text()
    console.log("Login response:", loginText)
  } catch (err) {
    console.error("Login failed:", err.message)
  }

  // Try API key with different header formats
  const apiKey = "sk_16aa2959fc856903743a4987cca07b12ebb1f94acd60c771cbc6f071ff095653"
  
  const headerFormats = [
    { "Authorization": `Bearer ${apiKey}` },
    { "x-medusa-access-token": apiKey },
    { "Medusa-Access-Token": apiKey },
    { "api-key": apiKey }
  ]

  for (const headers of headerFormats) {
    console.log(`Testing with headers:`, Object.keys(headers))
    try {
      const resp = await fetch(`${backendUrl}/admin/products?limit=1`, { headers })
      const text = await resp.text()
      console.log(`Response:`, text)
      if (resp.ok) {
        console.log("SUCCESS! This header format works.")
        break
      }
    } catch (err) {
      console.error(`Failed:`, err.message)
    }
  }
}

testAuth()
