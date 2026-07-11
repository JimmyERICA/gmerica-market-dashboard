import { prefetchQuotes, getQuote } from './finnhub.js'
import { fetchVolComplex } from './vol.js'

export const SIGNAL_DEFS = [
  { id: 'breadth', label: 'Breadth / Leadership', numerator: 'RSP', denominator: 'SPY', description: 'Equal-weight vs cap-weight S&P 500. Rising ratio means broad participation — bullish.', neutralBand: 0.005, doubleWeight: true },
  { id: 'defensive', label: 'Defensive Rotation', numerator: 'XLP', denominator: 'XLY', description: 'Staples vs discretionary. Falling ratio means investors prefer risk — bullish.', neutralBand: 0.005, inverted: true },
  { id: 'credit', label: 'Credit Confidence', numerator: 'HYG', denominator: 'LQD', description: 'High-yield vs investment-grade bonds. Rising ratio signals credit risk appetite — bullish.', neutralBand: 0.005 },
  { id: 'bellwether', label: 'Bellwether Semis', numerator: 'SOXX', denominator: 'SPY', description: 'Semiconductors vs broad market. Semis lead economic cycles — outperformance is bullish.', neutralBand: 0.005 },
  { id: 'volatility', label: 'Volatility', numerator: 'VIX', denominator: null, description: 'CBOE VIX index (real, via Tradier). Below 17 is calm/bullish. Above 25 signals fear — bearish.', isAbsolute: true, absoluteBull: 17, absoluteBear: 25, neutralBand: 0.005, inverted: true },
  { id: 'riskAppetite', label: 'Risk Appetite', numerator: 'SPHB', denominator: 'SPLV', description: 'High-beta vs low-volatility stocks. Rising ratio means investors are chasing risk — bullish.', neutralBand: 0.005 },
  { id: 'transport', label: 'Transport / Economy', numerator: 'IYT', denominator: 'SPY', description: 'Transports vs broad market. Dow Theory: transport outperformance confirms economic health.', neutralBand: 0.003 },
]

const MAX_RAW = 160

function scoreSignal(def, pctChange) {
  const effectivePct = def.inverted ? -pctChange : pctChange
  if (effectivePct > def.neutralBand) return def.doubleWeight ? 40 : 20
  if (effectivePct < -def.neutralBand) return 0
  return def.doubleWeight ? 20 : 10
}

function scoreLabel(score, doubleWeight) {
  if (doubleWeight) return score === 40 ? 'Bullish' : score === 0 ? 'Bearish' : 'Neutral'
  return score === 20 ? 'Bullish' : score === 0 ? 'Bearish' : 'Neutral'
}

export async function fetchAllSignals() {
  const symbolsNeeded = new Set(['SPY'])
  SIGNAL_DEFS.forEach(d => { if (!d.isAbsolute) { symbolsNeeded.add(d.numerator); if (d.denominator) symbolsNeeded.add(d.denominator) } })
  const [, volData] = await Promise.all([
    prefetchQuotes([...symbolsNeeded]),
    fetchVolComplex().catch(() => null),
  ])
  const results = SIGNAL_DEFS.map((def) => {
    try {
      if (def.isAbsolute) {
        const q = volData?.vix ?? { error: 'VIX unavailable from /api/vol' }
        if (q.error) throw new Error(q.error)
        const ratioNow = q.price
        const ratioPrev = q.prevClose
        const pctChange = ratioPrev !== 0 ? (ratioNow - ratioPrev) / ratioPrev : 0
        const score = ratioNow <= def.absoluteBull ? 20 : ratioNow >= def.absoluteBear ? 0 : 10
        return { ...def, ratioNow, ratioPrev, pctChange: pctChange * 100, score, displayScore: score, reading: scoreLabel(score, false), numPrice: q.price, denPrice: null, error: null }
      }
      const num = getQuote(def.numerator)
      const den = getQuote(def.denominator)
      if (num.error) throw new Error(num.error)
      if (den.error) throw new Error(den.error)
      const ratioNow = num.price / den.price
      const ratioPrev = num.prevClose / den.prevClose
      const pctChange = ratioPrev !== 0 ? (ratioNow - ratioPrev) / ratioPrev : 0
      const score = scoreSignal(def, pctChange)
      return { ...def, ratioNow, ratioPrev, pctChange: pctChange * 100, score, displayScore: def.doubleWeight ? score / 2 : score, reading: scoreLabel(score, def.doubleWeight), numPrice: num.price, denPrice: den.price, error: null }
    } catch (err) {
      return { ...def, ratioNow: null, ratioPrev: null, pctChange: null, score: def.doubleWeight ? 20 : 10, displayScore: 10, reading: 'Neutral', error: err.message }
    }
  })
  const spyData = getQuote('SPY')
  const breadthSignal = results.find(s => s.id === 'breadth')
  const spyRising = spyData && !spyData.error ? spyData.price > spyData.prevClose : false
  const breadthFalling = breadthSignal?.pctChange != null && breadthSignal.pctChange < 0
  const divergenceWarning = spyRising && breadthFalling
  const rawTotal = results.reduce((sum, s) => sum + s.score, 0)
  let compositeScore = Math.round((rawTotal / MAX_RAW) * 100)
  if (divergenceWarning && compositeScore > 60) compositeScore = 60
  return { signals: results, compositeScore, divergenceWarning }
}

export function getMarketPhase(score, prevScore) {
  const delta = score - (prevScore ?? score)
  if (score >= 67) return delta > 5 ? 'Bull Phase 1' : delta >= 0 ? 'Bull Phase 2' : 'Bull Phase 3'
  if (score <= 33) return delta < -5 ? 'Bear Phase 1' : delta <= 0 ? 'Bear Phase 2' : 'Bear Phase 3'
  return 'Transitional'
}
