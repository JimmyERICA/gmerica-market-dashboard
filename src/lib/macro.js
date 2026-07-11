import { prefetchQuotes, getQuote } from './finnhub.js'
import { fetchVolComplex } from './vol.js'
import { fetchMacroSignals as fetchFredSignals } from './fred.js'

function vixLevelState(price) {
  if (price < 15) return 'Complacent'
  if (price < 20) return 'Calm'
  if (price < 28) return 'Elevated'
  return 'Fear'
}

const fmt = (v, d = 2) => v != null ? v.toFixed(d) : '—'
const sign = v => v >= 0 ? '+' : ''

export async function fetchAllMacroSignals() {
  const [, volData, fredResults] = await Promise.all([
    prefetchQuotes(['UUP', 'IWM', 'SPY']),
    fetchVolComplex().catch(() => null),
    fetchFredSignals(),
  ])

  const volAndRisk = []
  const vix = volData?.vix
  const vix1d = volData?.vix1d
  const vix9d = volData?.vix9d
  const vix3m = volData?.vix3m

  // VIX level — real CBOE index
  if (vix?.price != null) {
    const state = vixLevelState(vix.price)
    volAndRisk.push({
      id: 'vixLevel', label: 'VIX Level', ticker: 'VIX (CBOE)', value: vix.price,
      formatted: fmt(vix.price), pctChange: vix.pctChange, state,
      meaning: `VIX at ${fmt(vix.price)} (${sign(vix.pctChange)}${fmt(vix.pctChange)}% today). ${state === 'Fear' ? 'Fear regime — elevated hedging demand.' : state === 'Elevated' ? 'Vol elevated — market pricing near-term uncertainty.' : 'Vol contained — calm market backdrop.'}`,
      source: 'Tradier',
    })
  } else { volAndRisk.push({ id: 'vixLevel', label: 'VIX Level', ticker: 'VIX', error: 'unavailable', source: 'Tradier' }) }

  // Term structure: VIX1D → VIX9D → VIX → VIX3M
  if (vix?.price != null && vix3m?.price != null) {
    const ratio = vix.price / vix3m.price
    const state = ratio > 1.0 ? 'Backwardation' : ratio < 0.92 ? 'Steep Contango' : 'Contango'
    const curve = [vix1d?.price, vix9d?.price, vix.price, vix3m.price].map(v => fmt(v, 1)).join(' → ')
    volAndRisk.push({
      id: 'volTermStructure', label: 'Vol Term Structure', ticker: 'VIX1D→9D→VIX→3M', value: ratio,
      formatted: curve, pctChange: null, state,
      meaning: `VIX/VIX3M ratio ${ratio.toFixed(3)}. ${state === 'Backwardation' ? 'Near-term vol above 3-month — classic stress signal.' : state === 'Steep Contango' ? 'Steep contango — market very calm, vol sellers in control.' : 'Normal contango — orderly market.'}`,
      source: 'Tradier',
    })
  } else { volAndRisk.push({ id: 'volTermStructure', label: 'Vol Term Structure', ticker: 'VIX/VIX3M', error: 'unavailable', source: 'Tradier' }) }

  // Skew: front of curve (VIX1D vs VIX) — is immediate event risk priced?
  if (vix1d?.price != null && vix?.price != null) {
    const spread = vix1d.price - vix.price
    const state = spread > 0 ? 'Front-loaded Fear' : spread < -4 ? 'Back-loaded' : 'Balanced'
    volAndRisk.push({
      id: 'volSkew', label: 'Vol Skew (1D vs 30D)', ticker: 'VIX1D − VIX', value: spread,
      formatted: `${sign(spread)}${fmt(spread, 1)} pts`, pctChange: null, state,
      meaning: `VIX1D ${fmt(vix1d.price, 1)} vs VIX ${fmt(vix.price, 1)}. ${state === 'Front-loaded Fear' ? '1-day vol above 30-day — immediate event risk being priced (rare outside event eves).' : state === 'Back-loaded' ? '1-day vol deeply below 30-day — no event risk today, uncertainty further out.' : 'Front of curve in line with 30-day.'}`,
      source: 'Tradier',
    })
  } else { volAndRisk.push({ id: 'volSkew', label: 'Vol Skew (1D vs 30D)', ticker: 'VIX1D − VIX', error: 'unavailable', source: 'Tradier' }) }

  // Bond vol — TLT ATM IV (live MOVE-like proxy)
  const tlt = volData?.tltIV
  if (tlt?.iv != null) {
    const ivPct = tlt.iv * 100
    const state = ivPct >= 18 ? 'Elevated' : ivPct >= 13 ? 'Neutral' : 'Calm'
    volAndRisk.push({
      id: 'bondVol', label: 'Bond Vol (MOVE proxy)', ticker: 'TLT ~30d ATM IV', value: ivPct,
      formatted: `${fmt(ivPct, 1)}%`, pctChange: null, state,
      meaning: `TLT ${tlt.expiration} ATM implied vol at ${fmt(ivPct, 1)}%. ${state === 'Elevated' ? 'Elevated bond vol — rates market unsettled, typically risk-off for equities.' : state === 'Neutral' ? 'Bond vol mid-range.' : 'Bond vol subdued — rates market quiet.'}`,
      source: 'Tradier',
    })
  } else { volAndRisk.push({ id: 'bondVol', label: 'Bond Vol (MOVE proxy)', ticker: 'TLT ATM IV', error: 'unavailable', source: 'Tradier' }) }

  // Dollar strength — UUP (intraday, Finnhub)
  const uup = getQuote('UUP')
  if (uup && !uup.error) {
    const pct = uup.pctChange ?? 0
    const state = pct > 0.3 ? 'Strengthening' : pct < -0.3 ? 'Weakening' : 'Stable'
    volAndRisk.push({
      id: 'dollar', label: 'Dollar Strength', ticker: 'UUP (DXY proxy)', value: uup.price,
      formatted: `$${fmt(uup.price)}`, pctChange: pct, state,
      meaning: `UUP at $${fmt(uup.price)}, ${sign(pct)}${fmt(pct)}% today. ${state === 'Strengthening' ? 'Dollar strength headwind for risk assets.' : state === 'Weakening' ? 'Dollar weakness supportive for equities and commodities.' : 'Dollar stable — neutral macro backdrop.'}`,
      source: 'Finnhub',
    })
  } else { volAndRisk.push({ id: 'dollar', label: 'Dollar Strength', ticker: 'UUP', error: uup?.error ?? 'unavailable', source: 'Finnhub' }) }

  // USD/JPY — carry-trade barometer (ECB daily rate)
  const jpy = volData?.usdJpy
  if (jpy?.rate != null) {
    const pct = jpy.pctChange ?? 0
    const state = pct < -0.5 ? 'Yen Strengthening' : pct > 0.5 ? 'Yen Weakening' : 'Stable'
    volAndRisk.push({
      id: 'usdJpy', label: 'USD/JPY', ticker: `USD/JPY · ${jpy.date}`, value: jpy.rate,
      formatted: `¥${fmt(jpy.rate)}`, pctChange: pct, state,
      meaning: `USD/JPY at ${fmt(jpy.rate)} (${sign(pct)}${fmt(pct)}% vs prior day, ECB daily rate). ${state === 'Yen Strengthening' ? 'Yen bid — carry-trade unwind pressure, historically risk-off for equities.' : state === 'Yen Weakening' ? 'Yen offered — carry trades comfortable, supportive of risk.' : 'Carry backdrop stable.'}`,
      source: 'ECB/frankfurter',
    })
  } else { volAndRisk.push({ id: 'usdJpy', label: 'USD/JPY', ticker: 'USD/JPY', error: 'unavailable', source: 'ECB/frankfurter' }) }

  // Small vs large cap — IWM/SPY (Finnhub)
  const iwm = getQuote('IWM')
  const spy = getQuote('SPY')
  if (iwm && spy && !iwm.error && !spy.error) {
    const ratioNow = iwm.price / spy.price
    const ratioPrev = iwm.prevClose / spy.prevClose
    const pct = ratioPrev !== 0 ? ((ratioNow - ratioPrev) / ratioPrev) * 100 : 0
    const state = pct > 0.3 ? 'Outperforming' : pct < -0.3 ? 'Underperforming' : 'Inline'
    volAndRisk.push({
      id: 'smallLargeCap', label: 'Small vs Large Cap', ticker: 'IWM / SPY', value: ratioNow,
      formatted: ratioNow.toFixed(4), pctChange: pct, state,
      meaning: `IWM/SPY ratio ${sign(pct)}${fmt(pct)}% today. ${state === 'Outperforming' ? 'Small caps leading — broad risk-on breadth.' : state === 'Underperforming' ? 'Small caps lagging — large-cap concentration.' : 'Small and large cap moving in lockstep.'}`,
      source: 'Finnhub',
    })
  } else { volAndRisk.push({ id: 'smallLargeCap', label: 'Small vs Large Cap', ticker: 'IWM / SPY', error: 'unavailable', source: 'Finnhub' }) }

  return { volAndRisk, ratesAndCredit: Object.values(fredResults) }
}
