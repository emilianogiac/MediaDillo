import { useEffect } from 'react'

const VERSION = '0.1.0'

interface Props {
  onClose: () => void
}

export function AboutModal({ onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 bg-black/75 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Hero */}
        <div className="flex flex-col items-center gap-4 pt-10 pb-6 px-8 bg-gradient-to-b from-gray-900 to-surface">
          <img src="/favicon.png" alt="MediaDillo" className="w-20 h-20 drop-shadow-lg" />
          <div className="text-center">
            <h1 className="text-3xl font-bold text-accent tracking-tight">MediaDillo</h1>
            <span className="mt-1 inline-block text-xs font-mono bg-accent/10 border border-accent/30 text-accent px-2 py-0.5 rounded-full">
              v{VERSION}
            </span>
          </div>
        </div>

        {/* Body */}
        <div className="px-8 pb-8 space-y-4">
          <p className="text-sm text-gray-300 leading-relaxed text-center">
            MediaDillo is a self-hosted media library manager — it scans your files, matches them
            against metadata providers, renames and organises them, and keeps your Jellyfin
            library in sync.
          </p>

          <div className="border-t border-gray-800 pt-4 space-y-1.5 text-xs text-gray-500">
            <p className="font-semibold text-gray-400 uppercase tracking-widest text-[10px] mb-2">
              Powered by
            </p>
            {[
              { label: 'TMDB', href: 'https://www.themoviedb.org', note: 'movie & TV metadata' },
              { label: 'TVDB', href: 'https://www.thetvdb.com', note: 'TV series metadata' },
              { label: 'Jellyfin', href: 'https://jellyfin.org', note: 'media server integration' },
            ].map(({ label, href, note }) => (
              <div key={label} className="flex items-center justify-between gap-2">
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline font-medium"
                >
                  {label}
                </a>
                <span className="text-gray-600">{note}</span>
              </div>
            ))}
          </div>

          <div className="pt-2 flex justify-center">
            <button
              onClick={onClose}
              className="text-sm px-6 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:text-gray-100 hover:border-gray-500 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
