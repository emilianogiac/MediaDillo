import { useState } from 'react'
import type { EpisodeDetail } from '../api/types.js'
import { mergeParts, renumberEpisodes, rescanSeason } from '../api/shows.js'

interface Props {
  showId: string
  seasonNumber: number
  episodes: EpisodeDetail[]
  onDone: () => void
}

export function MergePartsPanel({ showId, seasonNumber, episodes, onDone }: Props) {
  const [open, setOpen] = useState(false)
  const [primaryEp, setPrimaryEp] = useState<number | ''>('')
  const [secondaryEp, setSecondaryEp] = useState<number | ''>('')
  const [doRenumber, setDoRenumber] = useState(true)
  const [applying, setApplying] = useState(false)
  const [result, setResult] = useState<{ renamed: number; errors: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const ownedEpisodes = episodes.filter((e) => e.status === 'owned')

  async function apply() {
    if (primaryEp === '' || secondaryEp === '') return
    if (primaryEp === secondaryEp) {
      setError('Primary and secondary must be different episodes')
      return
    }
    setApplying(true)
    setError(null)
    setResult(null)
    try {
      const mergeRes = await mergeParts(showId, seasonNumber, primaryEp, secondaryEp)
      let totalRenamed = mergeRes.renamed
      const allErrors = [...mergeRes.errors]

      if (doRenumber) {
        const fromEpisode = Math.max(primaryEp, secondaryEp) + 1
        const renumRes = await renumberEpisodes(showId, seasonNumber, fromEpisode, -1)
        totalRenamed += renumRes.renamed
        allErrors.push(...renumRes.errors)
      }

      // Rescan to reconcile DB with renamed files
      await rescanSeason(showId, seasonNumber).catch(() => {})

      setResult({ renamed: totalRenamed, errors: allErrors })
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Operation failed')
    } finally {
      setApplying(false)
    }
  }

  const canApply = primaryEp !== '' && secondaryEp !== '' && primaryEp !== secondaryEp && !applying

  const primaryLabel = primaryEp !== ''
    ? episodes.find((e) => e.episodeNumber === primaryEp)
    : null
  const secondaryLabel = secondaryEp !== ''
    ? episodes.find((e) => e.episodeNumber === secondaryEp)
    : null

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-surface-raised hover:bg-gray-700/40 transition-colors text-left"
      >
        <span className="text-sm font-medium text-gray-200">Merge Multi-Part Episodes</span>
        <span className="text-gray-500 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="p-4 space-y-4 bg-surface border-t border-gray-700">
          <p className="text-xs text-gray-500">
            Use when two episodes in your library are actually one episode broadcast in two parts.
            Renames both files as Part 1 / Part 2 of the primary episode number, then optionally
            shifts all following episode numbers down by one.
          </p>

          {error && <p className="text-sm text-red-400">{error}</p>}

          {result && (
            <div className="text-sm space-y-1">
              <p className="text-green-400">✓ {result.renamed} file{result.renamed !== 1 ? 's' : ''} renamed</p>
              {result.errors.map((e, i) => <p key={i} className="text-red-400">✗ {e}</p>)}
            </div>
          )}

          {!result && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-gray-400">Primary episode (Part 1)</label>
                  <select
                    value={primaryEp}
                    onChange={(e) => setPrimaryEp(e.target.value ? Number(e.target.value) : '')}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent"
                  >
                    <option value="">— select —</option>
                    {ownedEpisodes.map((ep) => (
                      <option key={ep.id} value={ep.episodeNumber}>
                        E{String(ep.episodeNumber).padStart(2, '0')}{ep.title ? ` – ${ep.title}` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-gray-400">Secondary episode (Part 2)</label>
                  <select
                    value={secondaryEp}
                    onChange={(e) => setSecondaryEp(e.target.value ? Number(e.target.value) : '')}
                    className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-sm text-gray-200 focus:outline-none focus:border-accent"
                  >
                    <option value="">— select —</option>
                    {ownedEpisodes.map((ep) => (
                      <option key={ep.id} value={ep.episodeNumber}>
                        E{String(ep.episodeNumber).padStart(2, '0')}{ep.title ? ` – ${ep.title}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Preview */}
              {primaryEp !== '' && secondaryEp !== '' && primaryEp !== secondaryEp && (
                <div className="bg-gray-800/50 rounded p-3 space-y-1.5 text-xs text-gray-400">
                  <p className="text-gray-300 font-medium">Preview</p>
                  <p>
                    <span className="text-gray-500">E{String(primaryEp).padStart(2, '0')} </span>
                    {primaryLabel?.title ?? ''} → <span className="text-gray-200">…part1.mkv</span>
                  </p>
                  <p>
                    <span className="text-gray-500">E{String(secondaryEp).padStart(2, '0')} </span>
                    {secondaryLabel?.title ?? ''} → <span className="text-gray-200">…part2.mkv</span>
                    <span className="text-gray-600 ml-1">(merged into E{String(primaryEp).padStart(2, '0')})</span>
                  </p>
                  {doRenumber && (
                    <p className="text-gray-500 mt-1">
                      Episodes E{String(Math.max(Number(primaryEp), Number(secondaryEp)) + 1).padStart(2, '0')}+ will be renumbered down by 1
                    </p>
                  )}
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-300">
                <input
                  type="checkbox"
                  checked={doRenumber}
                  onChange={(e) => setDoRenumber(e.target.checked)}
                  className="accent-accent"
                />
                Renumber following episodes down by 1
              </label>

              <button
                onClick={apply}
                disabled={!canApply}
                className="text-sm px-4 py-1.5 rounded bg-accent text-black font-medium hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {applying ? 'Applying…' : 'Apply'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
