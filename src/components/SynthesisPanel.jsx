export default function SynthesisPanel({ text, generatedAt, loading, error }) {
  const when = generatedAt
    ? new Date(generatedAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : null

  return (
    <section className="rounded-xl border border-indigo-900/50 bg-indigo-950/20 p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-semibold text-indigo-400 uppercase tracking-widest">AI Synthesis</span>
        <span className="text-[10px] text-slate-600">
          · Gemini · generated weekday pre-market{when ? ` · ${when}` : ''}
        </span>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-slate-500 animate-pulse">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-indigo-500 animate-ping" />
          Loading synthesis…
        </div>
      )}

      {!loading && error && (
        <p className="text-sm text-slate-500 italic">Synthesis unavailable — {error}</p>
      )}

      {!loading && !error && text && (
        <p className="text-sm text-slate-200 leading-relaxed">{text}</p>
      )}

      {!loading && !error && !text && (
        <p className="text-sm text-slate-600 italic">No synthesis yet — it generates automatically on weekday mornings.</p>
      )}
    </section>
  )
}
