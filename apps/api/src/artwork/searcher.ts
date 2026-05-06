export interface ImageCandidate {
  filePath: string
  url: string
  width: number
  height: number
  language: string | null
  voteAverage: number
}

interface TmdbImage {
  file_path: string
  width: number
  height: number
  vote_average: number
  iso_639_1: string | null
}

interface TmdbImagesResponse {
  posters?: TmdbImage[]
  backdrops?: TmdbImage[]
  logos?: TmdbImage[]
}

// We add the /images endpoint to TmdbClient by extending fetch call directly
// rather than modifying the shared client — keeps the client minimal.

export async function searchMovieImages(
  tmdbApiKey: string,
  tmdbId: number,
): Promise<{ posters: ImageCandidate[]; backdrops: ImageCandidate[] }> {
  const data = await fetchImages(`/movie/${tmdbId}/images`, tmdbApiKey)
  return { posters: toImageCandidates(data.posters), backdrops: toImageCandidates(data.backdrops) }
}

export async function searchTvImages(
  tmdbApiKey: string,
  tmdbId: number,
): Promise<{ posters: ImageCandidate[]; backdrops: ImageCandidate[] }> {
  const data = await fetchImages(`/tv/${tmdbId}/images`, tmdbApiKey)
  return { posters: toImageCandidates(data.posters), backdrops: toImageCandidates(data.backdrops) }
}

async function fetchImages(endpoint: string, apiKey: string): Promise<TmdbImagesResponse> {
  // include_image_language: fetch English + language-neutral images
  const url = `https://api.themoviedb.org/3${endpoint}?api_key=${apiKey}&include_image_language=en,null`
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`TMDB images ${endpoint} → HTTP ${res.status}`)
  return res.json() as Promise<TmdbImagesResponse>
}

function toImageCandidates(images: TmdbImage[] = []): ImageCandidate[] {
  return images
    .map((img) => ({
      filePath: img.file_path,
      url: `https://image.tmdb.org/t/p/original${img.file_path}`,
      width: img.width,
      height: img.height,
      language: img.iso_639_1,
      voteAverage: img.vote_average,
    }))
    .sort((a, b) => b.voteAverage - a.voteAverage)
    .slice(0, 20)
}

// Allow downloading a specific image by its TMDB file_path (user-selected)
export function tmdbImageUrl(filePath: string, size: 'w500' | 'w1280' | 'original' = 'original'): string {
  return `https://image.tmdb.org/t/p/${size}${filePath}`
}
