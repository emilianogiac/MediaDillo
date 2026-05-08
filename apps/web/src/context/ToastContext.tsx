import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'
import { fetchJobStatus } from '../api/library-health.js'
import type { JobStatus } from '../api/library-health.js'

export interface SimpleToast {
  id: number
  type: 'success' | 'error'
  message: string
}

export interface JobToast {
  id: number
  type: 'job'
  label: string
  jobId: string
  job: JobStatus | null
}

export type Toast = SimpleToast | JobToast

interface ToastContextValue {
  toast: (opts: Omit<SimpleToast, 'id'>) => void
  trackJob: (opts: { label: string; jobId: string }) => void
  toasts: Toast[]
  dismiss: (id: number) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((opts: Omit<SimpleToast, 'id'>) => {
    const id = ++counter.current
    setToasts((prev) => [...prev, { ...opts, id }])
    setTimeout(() => dismiss(id), 4000)
  }, [dismiss])

  const trackJob = useCallback((opts: { label: string; jobId: string }) => {
    const id = ++counter.current
    setToasts((prev) => [...prev, { type: 'job', id, label: opts.label, jobId: opts.jobId, job: null }])
  }, [])

  // Poll all running job toasts
  useEffect(() => {
    const running = toasts.filter((t): t is JobToast => t.type === 'job' && (t.job === null || t.job.running))
    if (running.length === 0) return

    const timer = setInterval(async () => {
      for (const jt of running) {
        try {
          const status = await fetchJobStatus(jt.jobId)
          setToasts((prev) => prev.map((t) => t.id === jt.id ? { ...t, job: status } as JobToast : t))
          if (!status.running) {
            // Auto-dismiss 5s after completion
            setTimeout(() => dismiss(jt.id), 5000)
          }
        } catch {
          // ignore poll errors
        }
      }
    }, 2000)

    return () => clearInterval(timer)
  }, [toasts, dismiss])

  return (
    <ToastContext.Provider value={{ toast, trackJob, toasts, dismiss }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
