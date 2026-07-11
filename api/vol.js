// Vol complex: real CBOE indices (VIX1D/VIX9D/VIX/VIX3M) via Tradier when
// TRADIER_KEY is set, otherwise Yahoo Finance's public chart endpoint (no key,
// delayed). TLT ATM implied vol (~30d, MOVE-like bond-vol proxy) is
// Tradier-only. USD/JPY daily rate from frankfurter.app (ECB reference).

const BASE = 'https://api.tradier.com/v1'

async function tradier(path, key) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`Tradier ${r.status}: ${(await r.text()).slice(0, 150)}`)
  return r.json()
}

function normQuotes(data) {
  let q = data?.quotes?.quote ?? []
  if (!Array.isArray(q)) q = [q]
  const out = {}
  for (const item of q) {
    out[item.symbol] = {
      symbol: item.symbol,
      price: item.last,
      prevClose: item.prevclose,
      pctChange: item.prevclose ? ((item.last - item.prevclose) / item.prevclose) * 100 : null,
    }
  }
  return out
}

async function tltAtmIV(key) {
  // ATM IV at the expiration closest to 30 days out
  const [quoteData, expData] = await Promise.all([
    tradier('/markets/quotes?symbols=TLT', key),
    tradier('/markets/options/expirations?symbol=TLT', key),
  ])
  const spot = quoteData?.quotes?.quote?.last
  if (!spot) return null
  let exps = expData?.expirations?.date ?? []
  if (!Array.isArray(exps)) exps = [exps]
  if (!exps.length) return null
  const target = Date.now() + 30 * 24 * 3600 * 1000
  const exp = exps.reduce((best, d) =>
    Math.abs(new Date(d).getTime() - target) < Math.abs(new Date(best).getTime() - target) ? d : best)
  const chain = await tradier(`/markets/options/chains?symbol=TLT&expiration=${exp}&greeks=true`, key)
  const options = chain?.options?.option
  if (!options?.length) return null
  let bestStrike = null, bestDist = Infinity
  for (const o of options) {
    const dist = Math.abs(o.strike - spot)
    if (dist < bestDist) { bestDist = dist; bestStrike = o.strike }
  }
  const atm = options.filter(o => o.strike === bestStrike && o.greeks?.mid_iv > 0)
  if (!atm.length) return null
  const iv = atm.reduce((s, o) => s + o.greeks.mid_iv, 0) / atm.length
  return { iv, expiration: exp, spot }
}

// Yahoo's chart endpoint is public (no key needed) but requires a browser-like
// User-Agent. Some CBOE indices return only the current session on short
// ranges, so ask for 1mo of daily closes and take the prior one from there.
async function yahooQuote(symbol) {
  const r = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1mo`,
    { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } },
  )
  if (!r.ok) throw new Error(`Yahoo ${r.status} for ${symbol}`)
  const data = await r.json()
  const result = data?.chart?.result?.[0]
  const price = result?.meta?.regularMarketPrice
  const closes = (result?.indicators?.quote?.[0]?.close ?? []).filter(c => c != null)
  if (price == null || closes.length < 2) return null
  // The final close is the current session; if it matches the live price the
  // prior close is one back, otherwise the final close IS the prior session.
  const last = closes[closes.length - 1]
  const prevClose = Math.abs(last - price) < price * 0.001
    ? closes[closes.length - 2]
    : last
  return {
    symbol,
    price,
    prevClose,
    pctChange: ((price - prevClose) / prevClose) * 100,
  }
}

async function yahooVixComplex() {
  const [vix1d, vix9d, vix, vix3m] = await Promise.all([
    yahooQuote('^VIX1D').catch(() => null),
    yahooQuote('^VIX9D').catch(() => null),
    yahooQuote('^VIX').catch(() => null),
    yahooQuote('^VIX3M').catch(() => null),
  ])
  return { vix1d, vix9d, vix, vix3m }
}

async function usdJpy() {
  // frankfurter.app: latest + a lookback window to get the prior business day
  const start = new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString().slice(0, 10)
  const r = await fetch(`https://api.frankfurter.app/${start}..?from=USD&to=JPY`)
  if (!r.ok) throw new Error(`frankfurter ${r.status}`)
  const data = await r.json()
  const dates = Object.keys(data.rates).sort()
  if (dates.length < 2) return null
  const last = data.rates[dates[dates.length - 1]].JPY
  const prev = data.rates[dates[dates.length - 2]].JPY
  return {
    rate: last,
    prevRate: prev,
    pctChange: ((last - prev) / prev) * 100,
    date: dates[dates.length - 1],
  }
}

export default async function handler(req, res) {
  const key = process.env.TRADIER_KEY

  try {
    if (key) {
      const [quotesData, tltIV, jpy] = await Promise.all([
        tradier('/markets/quotes?symbols=VIX1D,VIX9D,VIX,VIX3M', key),
        tltAtmIV(key).catch(() => null),
        usdJpy().catch(() => null),
      ])
      const quotes = normQuotes(quotesData)

      res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')
      return res.status(200).json({
        vix1d: quotes.VIX1D ?? null,
        vix9d: quotes.VIX9D ?? null,
        vix: quotes.VIX ?? null,
        vix3m: quotes.VIX3M ?? null,
        tltIV,
        usdJpy: jpy,
      })
    }

    // No Tradier key — Yahoo fallback (delayed; no TLT ATM IV available)
    const [quotes, jpy] = await Promise.all([
      yahooVixComplex(),
      usdJpy().catch(() => null),
    ])

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=60')
    return res.status(200).json({ ...quotes, tltIV: null, usdJpy: jpy })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
