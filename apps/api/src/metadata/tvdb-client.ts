const TVDB_BASE = 'https://api4.thetvdb.com/v4'
const TOKEN_TTL_MS = 29 * 24 * 60 * 60 * 1000 // 29 days (tokens valid 30)

// TVDB v4 uses ISO 639-2 3-letter codes; TMDB uses locale strings like "en-US"
const LANG_MAP: Record<string, string> = {
  en: 'eng', it: 'ita', fr: 'fra', de: 'deu', es: 'spa',
  pt: 'por', nl: 'nld', pl: 'pol', ru: 'rus', ja: 'jpn',
  zh: 'zho', ko: 'kor', sv: 'swe', da: 'dan', fi: 'fin',
  no: 'nor', cs: 'ces', tr: 'tur', hu: 'hun', ar: 'ara',
}

function toTvdbLang(tmdbLang: string): string {
  const code = (tmdbLang.split('-')[0] ?? tmdbLang).toLowerCase()
  return LANG_MAP[code] ?? code
}

export interface TvdbEpisode {
  id: number
  name: string | null    // episode title (null for unaired)
  aired: string | null   // "YYYY-MM-DD"
  number: number | null  // null for placeholder/unaired episodes TVDB hasn't assigned yet
  seasonNumber: number | null
}

export interface TvdbSeasonType {
  type: string   // 'official' | 'dvd' | 'absolute' | ...
  name: string   // 'Aired Order' | 'DVD Order' | 'Absolute Order' | ...
}

export interface TvdbSearchResult {
  tvdbId: number
  name: string
  overview: string | null
  firstAired: string | null
  imageUrl: string | null
  year: string | null
  network: string | null
}

export interface TvdbSeriesDetail {
  id: number
  name: string
  overview: string | null
  firstAired: string | null
  image: string | null
  status: string | null
}

export class TvdbClient {
  private tokenCache: { token: string; expiresAt: number } | null = null
  private readonly lang: string

  constructor(private readonly apiKey: string, language = 'en-US') {
    this.lang = toTvdbLang(language)
  }

  isConfigured(): boolean { return true }

  private async getToken(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
      return this.tokenCache.token
    }

    const res = await fetch(`${TVDB_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ apikey: this.apiKey }),
    })

    if (!res.ok) {
      throw new Error(`TVDB /login → HTTP ${res.status}`)
    }

    const data = (await res.json()) as { data: { token: string } }
    const token = data.data.token
    this.tokenCache = { token, expiresAt: Date.now() + TOKEN_TTL_MS }
    return token
  }

  private async get<T>(path: string): Promise<T> {
    const token = await this.getToken()
    const res = await fetch(`${TVDB_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    })

    if (!res.ok) {
      throw new Error(`TVDB ${path} → HTTP ${res.status}`)
    }

    return res.json() as Promise<T>
  }

  async searchSeries(query: string): Promise<TvdbSearchResult[]> {
    const data = await this.get<{
      data: Array<{
        tvdb_id: string
        name: string
        overview?: string
        first_air_time?: string
        image_url?: string
        year?: string
        primary_network?: { name: string }
      }>
    }>(`/search?query=${encodeURIComponent(query)}&type=series&language=${this.lang}`)

    return (data.data ?? []).map((r) => ({
      tvdbId: parseInt(r.tvdb_id, 10),
      name: r.name,
      overview: r.overview ?? null,
      firstAired: r.first_air_time ?? null,
      imageUrl: r.image_url ?? null,
      year: r.year ?? null,
      network: r.primary_network?.name ?? null,
    })).filter((r) => !isNaN(r.tvdbId))
  }

  async getSeries(tvdbId: number): Promise<TvdbSeriesDetail> {
    const [base, translation] = await Promise.all([
      this.get<{
        data: {
          id: number
          name: string
          overview?: string
          firstAired?: string
          image?: string
          status?: { name: string }
        }
      }>(`/series/${tvdbId}`),
      this.lang !== 'eng'
        ? this.get<{ data: { name?: string; overview?: string } | null }>(
            `/series/${tvdbId}/translations/${this.lang}`,
          ).catch(() => null)
        : Promise.resolve(null),
    ])

    return {
      id: base.data.id,
      name: translation?.data?.name ?? base.data.name,
      overview: translation?.data?.overview ?? base.data.overview ?? null,
      firstAired: base.data.firstAired ?? null,
      image: base.data.image ?? null,
      status: base.data.status?.name ?? null,
    }
  }

  async getSeriesTypes(tvdbId: number): Promise<TvdbSeasonType[]> {
    const data = await this.get<{ data: { seasonTypes: TvdbSeasonType[] } }>(
      `/series/${tvdbId}/extended`,
    )
    return data.data.seasonTypes ?? []
  }

  async getEpisodes(
    tvdbId: number,
    orderType: string,
    seasonNumber?: number,
  ): Promise<TvdbEpisode[]> {
    const fetchAll = async (langSuffix: string): Promise<TvdbEpisode[]> => {
      const episodes: TvdbEpisode[] = []
      let page = 0
      while (true) {
        const seasonParam = seasonNumber !== undefined ? `season=${seasonNumber}&` : ''
        const data = await this.get<{
          data: { episodes: TvdbEpisode[] } | null
          links: { next: string | null }
        }>(`/series/${tvdbId}/episodes/${orderType}${langSuffix}?${seasonParam}page=${page}`)
        episodes.push(...(data.data?.episodes ?? []))
        if (!data.links.next) break
        page++
      }
      return episodes
    }

    const primary = await fetchAll(`/${this.lang}`)

    // Only pay for fallback fetches when some episodes are missing titles
    const needsFallback = primary.some((e) => !e.name)
    if (!needsFallback) return primary

    // Fetch eng and TVDB default (original language) in parallel
    const [engEps, defaultEps] = await Promise.all([
      this.lang !== 'eng' ? fetchAll('/eng') : Promise.resolve([] as TvdbEpisode[]),
      fetchAll(''),
    ])

    const engById = new Map(engEps.map((e) => [e.id, e]))
    const defaultById = new Map(defaultEps.map((e) => [e.id, e]))

    return primary.map((ep) => ({
      ...ep,
      name: ep.name ?? engById.get(ep.id)?.name ?? defaultById.get(ep.id)?.name ?? null,
    }))
  }
}
