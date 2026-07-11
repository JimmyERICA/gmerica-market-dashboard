// The synthesis is pre-generated on a weekday-morning schedule
// (.github/workflows/daily-synthesis.yml) and served as a static file —
// no AI call happens when the page loads.
export async function fetchSynthesis() {
  const res = await fetch(`/synthesis.json?t=${Date.now()}`)
  if (!res.ok) throw new Error('no synthesis generated yet')
  return res.json() // { paragraph, compositeScore, model, generatedAt }
}
