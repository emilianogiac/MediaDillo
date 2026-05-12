const TVDB_BASE = 'https://api4.thetvdb.com/v4'
const TOKEN_TTL_MS = 29 * 24 * 60 * 60 * 1000 // 29 days (tokens valid 30)

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

  constructor(private readonly apiKey: string) {}

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
    }>(`/search?query=${encodeURIComponent(query)}&type=series`)

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
    const data = await this.get<{
      data: {
        id: number
        name: string
        overview?: string
        firstAired?: string
        image?: string
        status?: { name: string }
      }
    }>(`/series/${tvdbId}`)

    return {
      id: data.data.id,
      name: data.data.name,
      overview: data.data.overview ?? null,
      firstAired: data.data.firstAired ?? null,
      image: data.data.image ?? null,
      status: data.data.status?.name ?? null,
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
    const episodes: TvdbEpisode[] = []
    let page = 0

    while (true) {
      const seasonParam = seasonNumber !== undefined ? `season=${seasonNumber}&` : ''
      const data = await this.get<{
        data: { episodes: TvdbEpisode[] } | null
        links: { next: string | null }
      }>(`/series/${tvdbId}/episodes/${orderType}?${seasonParam}page=${page}`)

      const batch = data.data?.episodes ?? []
      episodes.push(...batch)

      if (!data.links.next) break
      page++
    }

    return episodes
  }
}
