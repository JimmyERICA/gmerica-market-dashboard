import { RefreshCw } from 'lucide-react'

export default function Header({ lastUpdated, onRefresh, loading }) {
  const formatted = lastUpdated
    ? lastUpdated.toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
      })
    : '—'

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-white">
          GMERICA Market Dashboard
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">
          Powered by Granville's 1960 timing system · ETF ratio signals
        </p>
      </div>

      <div className="flex items-center gap-4">
        <span className="text-xs text-slate-400 hidden sm:block">
          Updated: {formatted}
        </span>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm transition-colors disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>
    </header>
  )
}
