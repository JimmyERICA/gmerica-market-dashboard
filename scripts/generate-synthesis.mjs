// Generates public/synthesis.json — the daily AI market synthesis.
// Run by .github/workflows/daily-synthesis.yml on weekday mornings,
// or locally: npm run generate:synthesis
//
// Reuses the app's own signal/macro logic (src/lib) by routing their
// relative /api/* fetches to the serverless handlers in-process, so the
// prompt is built from exactly the data the dashboard would show.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dir = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dir, '..')

// Load .env when present (local runs); CI passes env vars directly
try {
  const env = readFileSync(path.join(root, '.env'), 'utf8')
  for (const line of env.split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim()
  }
} catch { /* no .env in CI */ }
if (!process.env.FINNHUB_KEY) process.env.FINNHUB_KEY = process.env.VITE_FINNHUB_KEY
if (!process.env.FRED_KEY) process.env.FRED_KEY = process.env.VITE_FRED_KEY

// Tried in order; the lite model is the fallback when the main one is overloaded
const GEMINI_MODELS = ['gemini-flash-latest', 'gemini-flash-lite-latest']
const RETRY_DELAYS_MS = [5_000, 15_000, 30_000]
const REQUEST_TIMEOUT_MS = 45_000
const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Route the client libs' relative /api/* fetches to the handlers in-process
const apiHandlers = {
  '/api/finnhub': () => import('../api/finnhub.js'),
  '/api/fred': () => import('../api/fred.js'),
  '/api/vol': () => import('../api/vol.js'),
}
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const urlStr = typeof input === 'string' ? input : input.url
  if (!urlStr.startsWith('/api/')) return realFetch(input, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), ...init })
  const url = new URL(urlStr, 'http://local')
  const load = apiHandlers[url.pathname]
  if (!load) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
  const { default: handler } = await load()
  return new Promise((resolve) => {
    const req = { method: 'GET', query: Object.fromEntries(url.searchParams), headers: {} }
    const res = {
      statusCode: 200,
      setHeader() {},
      status(code) { this.statusCode = code; return this },
      json(data) { resolve(new Response(JSON.stringify(data), { status: this.statusCode, headers: { 'Content-Type': 'application/json' } })) },
      end(data) { resolve(new Response(data ?? '', { status: this.statusCode })) },
    }
    Promise.resolve(handler(req, res)).catch(err =>
      resolve(new Response(JSON.stringify({ error: err.message }), { status: 500 })))
  })
}

const { fetchAllSignals } = await import('../src/lib/signals.js')
const { fetchAllMacroSignals } = await import('../src/lib/macro.js')

function buildPrompt(granvilleData, macroData) {
  const { signals, compositeScore, divergenceWarning } = granvilleData
  const { volAndRisk, ratesAndCredit } = macroData
  const signalLines = (signals ?? []).map(s => `  - ${s.label} (${s.numerator}${s.denominator ? '/' + s.denominator : ''}): ${s.reading}, ${s.pctChange != null ? (s.pctChange >= 0 ? '+' : '') + s.pctChange.toFixed(2) + '%' : 'unavailable'}`).join('\n')
  const volLines = (volAndRisk ?? []).filter(s => !s.error).map(s => `  - ${s.label}: ${s.state} (${s.formatted})`).join('\n')
  const ratesLines = (ratesAndCredit ?? []).filter(s => !s.error).map(s => `  - ${s.label}: ${s.state} at ${s.formatted}`).join('\n')
  const divergenceNote = divergenceWarning ? 'ACTIVE DIVERGENCE WARNING: SPY is rising but RSP/SPY breadth ratio is falling — composite capped at 60.' : 'No breadth divergence warning active.'
  return `You are a pre-market market intelligence assistant for a sophisticated trader using Granville's 1960 timing system. Write ONE paragraph (4-6 sentences) synthesizing these signals into a plain-English morning read. Be specific about numbers. Do not use bullet points. Lead with the Granville composite reading and treat it as the primary verdict. Then contextualize with macro. End with a one-sentence directional lean for the session.\n\nGRANVILLE COMPOSITE: ${compositeScore}/100\n${divergenceNote}\n\nGRANVILLE SIGNALS:\n${signalLines}\n\nMACRO CONDITIONS:\nVol & Risk:\n${volLines || '  (unavailable)'}\n\nRates & Credit:\n${ratesLines || '  (unavailable)'}\n\nWrite the synthesis paragraph now:`
}

async function callGemini(prompt) {
  const key = process.env.GEMINI_KEY
  if (!key) throw new Error('GEMINI_KEY not configured')
  let lastError
  for (const model of GEMINI_MODELS) {
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        const r = await realFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
        if (!r.ok) {
          const err = new Error(`Gemini ${model} ${r.status}: ${(await r.text()).slice(0, 300)}`)
          // Overload (429/5xx) is worth retrying; anything else (bad key, bad request) is not
          if (r.status !== 429 && r.status < 500) { err.permanent = true }
          throw err
        }
        const data = await r.json()
        const paragraph = (data?.candidates?.[0]?.content?.parts ?? [])
          .map(p => p.text ?? '').join('').trim()
        if (!paragraph) throw new Error(`Unexpected Gemini response from ${model}: ${JSON.stringify(data).slice(0, 300)}`)
        return { paragraph, model }
      } catch (err) {
        if (err.permanent) throw err
        lastError = err
        console.warn(`Gemini attempt failed (${model}, try ${attempt + 1}): ${err.message}`)
        if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt])
      }
    }
  }
  throw lastError
}

const [granvilleData, macroData] = await Promise.all([fetchAllSignals(), fetchAllMacroSignals()])

// A summary built from broken inputs reads as a confident "everything is neutral".
// Better to fail the run and keep the previous good summary on the site.
const failedSignals = granvilleData.signals.filter(s => s.error)
if (failedSignals.length >= 3) {
  throw new Error(`${failedSignals.length} of ${granvilleData.signals.length} Granville signals failed to load (${failedSignals.map(s => s.id).join(', ')}) — not publishing a summary`)
}

const { paragraph, model } = await callGemini(buildPrompt(granvilleData, macroData))

const out = {
  paragraph,
  compositeScore: granvilleData.compositeScore,
  model,
  generatedAt: new Date().toISOString(),
}
writeFileSync(path.join(root, 'public', 'synthesis.json'), JSON.stringify(out, null, 2) + '\n')
console.log(`Synthesis written (composite ${out.compositeScore}/100, ${paragraph.length} chars)`)
