import { useToast } from '../context/ToastContext'
import type { JobToast, SimpleToast } from '../context/ToastContext'

function SimpleToastItem({ t, dismiss }: { t: SimpleToast; dismiss: (id: number) => void }) {
  return (
    <div className={[
      'flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg text-sm max-w-sm pointer-events-auto',
      t.type === 'success'
        ? 'bg-green-900/90 border-green-700/60 text-green-100'
        : 'bg-red-900/90 border-red-700/60 text-red-100',
    ].join(' ')}>
      <span className="shrink-0 mt-px">{t.type === 'success' ? '✓' : '✕'}</span>
      <span className="flex-1">{t.message}</span>
      <button onClick={() => dismiss(t.id)} className="shrink-0 opacity-60 hover:opacity-100 transition-opacity ml-1">×</button>
    </div>
  )
}

function JobToastItem({ t, dismiss }: { t: JobToast; dismiss: (id: number) => void }) {
  const job = t.job
  const pct = job && job.total > 0 ? Math.round((job.done / job.total) * 100) : 0
  const done = job && !job.running
  const label = done ? `${t.label} — done` : job ? `${t.label} — ${job.done}/${job.total}` : `${t.label} — starting…`

  return (
    <div className="bg-gray-900/95 border border-gray-700 rounded-lg shadow-lg text-sm w-72 pointer-events-auto">
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <span className={done ? 'text-green-400' : 'text-gray-200'}>{label}</span>
        {done && (
          <button onClick={() => dismiss(t.id)} className="text-gray-500 hover:text-gray-300 transition-opacity ml-2 text-xs">dismiss</button>
        )}
      </div>
      <div className="px-4 pb-3 space-y-1">
        <div className="h-1.5 rounded-full bg-gray-700 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${done ? 'bg-green-500' : 'bg-accent'}`}
            style={{ width: job ? `${pct}%` : '0%' }}
          />
        </div>
        {job && job.errors.length > 0 && (
          <ul className="text-xs text-yellow-400 space-y-0.5 max-h-16 overflow-y-auto">
            {job.errors.map((e, i) => <li key={i} className="truncate">• {e}</li>)}
          </ul>
        )}
      </div>
    </div>
  )
}

export function ToastStack() {
  const { toasts, dismiss } = useToast()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) =>
        t.type === 'job'
          ? <JobToastItem key={t.id} t={t} dismiss={dismiss} />
          : <SimpleToastItem key={t.id} t={t} dismiss={dismiss} />
      )}
    </div>
  )
}
