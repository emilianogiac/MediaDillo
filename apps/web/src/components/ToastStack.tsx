import { useToast } from '../context/ToastContext'

export function ToastStack() {
  const { toasts, dismiss } = useToast()

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={[
            'flex items-start gap-3 px-4 py-3 rounded-lg border shadow-lg text-sm max-w-sm pointer-events-auto',
            t.type === 'success'
              ? 'bg-green-900/90 border-green-700/60 text-green-100'
              : 'bg-red-900/90 border-red-700/60 text-red-100',
          ].join(' ')}
        >
          <span className="shrink-0 mt-px">{t.type === 'success' ? '✓' : '✕'}</span>
          <span className="flex-1">{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 opacity-60 hover:opacity-100 transition-opacity ml-1"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
