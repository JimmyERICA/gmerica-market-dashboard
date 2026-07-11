// Local dev API server — runs api/* functions without vercel dev
// Usage: node local-api-server.mjs
import http from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

// Load .env manually
const __dir = path.dirname(fileURLToPath(import.meta.url))
try {
  const env = readFileSync(path.join(__dir, '.env'), 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim()
  }
  // Map VITE_* keys to plain keys for server-side use
  if (!process.env.FINNHUB_KEY) process.env.FINNHUB_KEY = process.env.VITE_FINNHUB_KEY
  if (!process.env.FRED_KEY)    process.env.FRED_KEY    = process.env.VITE_FRED_KEY
  if (!process.env.ONEMIN_KEY)  process.env.ONEMIN_KEY  = process.env.VITE_1MIN_KEY
} catch {}

const PORT = 3001

function makeReqRes(nodeReq, nodeRes) {
  const url = new URL(nodeReq.url, `http://localhost:${PORT}`)
  const req = {
    method: nodeReq.method,
    query: Object.fromEntries(url.searchParams),
    body: null,
    headers: nodeReq.headers,
  }
  let sent = false
  const res = {
    statusCode: 200,
    setHeader: () => {},
    status(code) { this.statusCode = code; return this },
    json(data) {
      if (sent) return; sent = true
      nodeRes.writeHead(this.statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      nodeRes.end(JSON.stringify(data))
    },
    end(data) {
      if (sent) return; sent = true
      nodeRes.writeHead(this.statusCode, { 'Access-Control-Allow-Origin': '*' })
      nodeRes.end(data)
    },
  }
  return { req, res }
}

async function readBody(nodeReq) {
  return new Promise(resolve => {
    const chunks = []
    nodeReq.on('data', c => chunks.push(c))
    nodeReq.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')))
  })
}

const server = http.createServer(async (nodeReq, nodeRes) => {
  if (nodeReq.method === 'OPTIONS') {
    nodeRes.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type' })
    nodeRes.end(); return
  }
  const url = new URL(nodeReq.url, `http://localhost:${PORT}`)
  const { req, res } = makeReqRes(nodeReq, nodeRes)
  if (nodeReq.method === 'POST') req.body = await readBody(nodeReq)

  try {
    if (url.pathname === '/api/finnhub') {
      const { default: handler } = await import(`./api/finnhub.js?t=${Date.now()}`)
      await handler(req, res)
    } else if (url.pathname === '/api/fred') {
      const { default: handler } = await import(`./api/fred.js?t=${Date.now()}`)
      await handler(req, res)
    } else if (url.pathname === '/api/vol') {
      const { default: handler } = await import(`./api/vol.js?t=${Date.now()}`)
      await handler(req, res)
    } else if (url.pathname === '/api/tradier') {
      const { default: handler } = await import(`./api/tradier.js?t=${Date.now()}`)
      await handler(req, res)
    } else {
      res.status(404).json({ error: 'not found' })
    }
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: err.message })
  }
})

server.listen(PORT, () => console.log(`Local API server running on http://localhost:${PORT}`))
