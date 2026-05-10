const TVDB_BASE = 'https://api4.thetvdb.com/v4'
const TOKEN_TTL_MS = 29 * 24 * 60 * 60 * 1000 // 29 days (tokens valid 30)

export interface TvdbEpisode {
  id: number
  name: string | null    // episode title (null for unaired)
  aired: string | null   // "YYYY-MM-DD"
  number: number         // episode number within season
  seasonNumber: number
}

export interface TvdbSeasonType {
  type: string   // 'official' | 'dvd' | 'absolute' | ...
  name: string   // 'Aired Order' | 'DVD Order' | 'Absolute Order' | ...
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
