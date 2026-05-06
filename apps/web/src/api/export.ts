// Download helpers — open as browser downloads via anchor click
function download(url: string, filename: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
}

export function downloadJson() {
  download('/api/export/json', 'mediadillo-export.json')
}

export function downloadMoviesCsv() {
  download('/api/export/movies.csv', 'movies.csv')
}

export function downloadShowsCsv() {
  download('/api/export/shows.csv', 'shows.csv')
}

export async function writeBulkNfo(): Promise<{ movies: number; shows: number; errors: string[] }> {
  const res = await fetch('/api/nfo/bulk', { method: 'POST' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json() as Promise<{ movies: number; shows: number; errors: string[] }>
}
