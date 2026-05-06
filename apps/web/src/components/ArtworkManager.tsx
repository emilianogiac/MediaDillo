import { useState } from 'react'
import type { ImageCandidate } from '../api/types.js'
import {
  triggerMovieDownload,
  fetchMovieImages,
  selectMovieImage,
} from '../api/movies.js'

interface Props {
  movieId: string
  posterDownloaded: boolean
  backdropDownloaded: boolean
  onUpdated: () => void
}

export function ArtworkManager({ movieId, posterDownloaded, backdropDownloaded, onUpdated }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<{ posters: ImageCandidate[]; backdrops: ImageCandidate[] } | null>(null)
  const [pickerType, setPickerType] = useState<'poster' | 'backdrop' | null>(null)

  async function download(type: 'poster' | 'backdrop' | 'all') {
    setBusy(true)
    setError(null)
    try {
      await triggerMovieDownload(movieId, type)
      onUpdated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setBusy(false)
    }
  }

  async function openPicker(type: 'poster' | 'backdrop') {
    setBusy(true)
    setError(null)
    try {
      const data = await fetchMovieImages(movieId)
      setCandidates(data)
      setPickerType(type)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load images')
    } finally {
      setBusy(false)
    }
  }

  async function selectImage(filePath: string) {
    if (!pickerType) return
    setBusy(true)
    setError(null)
    try {
      await selectMovieImage(movieId, filePath, pickerType)
      setCandidates(null)
      setPickerType(null)
      onUpdated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save image')
    } finally {
      setBusy(false)
    }
  }

  const pickerImages = pickerType === 'poster' ? candidates?.posters : candidates?.backdrops

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Artwork</h2>

      {error && (
        <p className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded px-3 py-2">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-4">
        {/* Poster */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Poster</span>
            {posterDownloaded ? (
              <span className="text-xs bg-green-800/60 text-green-300 px-1.5 py-0.5 rounded">
                Downloaded
              </span>
            ) : (
              <span className="text-xs bg-yellow-800/60 text-yellow-300 px-1.5 py-0.5 rounded">
                Missing
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => download('poster')}
              disabled={busy || posterDownloaded}
              className="text-xs px-2 py-1.5 rounded bg-surface-overlay hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              Download
            </button>
            <button
              onClick={() => openPicker('poster')}
              disabled={busy}
              className="text-xs px-2 py-1.5 rounded bg-surface-overlay hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              Search images…
            </button>
          </div>
        </div>

        {/* Backdrop */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">Backdrop</span>
            {backdropDownloaded ? (
              <span className="text-xs bg-green-800/60 text-green-300 px-1.5 py-0.5 rounded">
                Downloaded
              </span>
            ) : (
              <span className="text-xs bg-yellow-800/60 text-yellow-300 px-1.5 py-0.5 rounded">
                Missing
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => download('backdrop')}
              disabled={busy || backdropDownloaded}
              className="text-xs px-2 py-1.5 rounded bg-surface-overlay hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              Download
            </button>
            <button
              onClick={() => openPicker('backdrop')}
              disabled={busy}
              className="text-xs px-2 py-1.5 rounded bg-surface-overlay hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              Search images…
            </button>
          </div>
        </div>
      </div>

      {/* Download all button */}
      {(!posterDownloaded || !backdropDownloaded) && (
        <button
          onClick={() => download('all')}
          disabled={busy}
          className="text-sm px-3 py-1.5 rounded bg-accent hover:bg-accent-hover text-white disabled:opacity-40 transition-colors"
        >
          {busy ? 'Downloading…' : 'Download all missing'}
        </button>
      )}

      {/* Image picker modal */}
      {candidates && pickerType && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-surface-raised border border-gray-700 rounded-xl w-full max-w-3xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-gray-700">
              <h3 className="font-semibold capitalize">Pick {pickerType}</h3>
              <button
                onClick={() => { setCandidates(null); setPickerType(null) }}
                className="text-gray-400 hover:text-white transition-colors text-lg leading-none"
              >
                ✕
              </button>
            </div>
            <div className="overflow-y-auto p-4 grid grid-cols-4 gap-3">
              {(pickerImages ?? []).map((img) => (
                <button
                  key={img.filePath}
                  onClick={() => selectImage(img.filePath)}
                  disabled={busy}
                  className="relative group rounded overflow-hidden border-2 border-transparent hover:border-accent disabled:opacity-40 transition-colors"
                  title={`${img.width}×${img.height} · ${img.voteAverage.toFixed(1)}★`}
                >
                  <img src={img.url} alt="" className="w-full object-cover" />
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-xs text-gray-200 px-1 py-0.5 text-center opacity-0 group-hover:opacity-100 transition-opacity">
                    {img.voteAverage.toFixed(1)}★
                  </div>
                </button>
              ))}
              {(pickerImages ?? []).length === 0 && (
                <p className="col-span-4 text-gray-500 text-sm text-center py-8">
                  No images found
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
