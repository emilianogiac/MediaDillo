export interface JellyfinStatus {
  configured: boolean
  connected: boolean
  serverName?: string
  version?: string
  error?: string
}

export interface JellyfinUser {
  Id: string
  Name: string
}

export class JellyfinClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private headers() {
    return {
      'X-Emby-Token': this.apiKey,
      'Content-Type': 'application/json',
    }
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() })
    if (!res.ok) throw new Error(`Jellyfin ${path} → HTTP ${res.status}`)
    return res.json() as Promise<T>
  }

  private async post(path: string): Promise<void> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
    })
    if (!res.ok) throw new Error(`Jellyfin ${path} → HTTP ${res.status}`)
  }

  async ping(): Promise<{ ServerName: string; Version: string }> {
    return this.get('/System/Info/Public')
  }

  async triggerLibraryRefresh(): Promise<void> {
    await this.post('/Library/Refresh')
  }

  async getUsers(): Promise<JellyfinUser[]> {
    return this.get<JellyfinUser[]>('/Users')
  }

  async getWatchedMovieTmdbIds(userId: string): Promise<number[]> {
    const data = await this.get<{
      Items: { ProviderIds?: { Tmdb?: string } }[]
    }>(
      `/Users/${userId}/Items?Filters=IsPlayed&Recursive=true&IncludeItemTypes=Movie&Fields=ProviderIds`,
    )
    return data.Items.flatMap((item) => {
      const id = item.ProviderIds?.Tmdb
      return id ? [parseInt(id, 10)] : []
    })
  }

  async getWatchedEpisodePaths(userId: string): Promise<string[]> {
    const data = await this.get<{
      Items: { Path?: string }[]
    }>(
      `/Users/${userId}/Items?Filters=IsPlayed&Recursive=true&IncludeItemTypes=Episode&Fields=Path`,
    )
    return data.Items.flatMap((item) => (item.Path ? [item.Path] : []))
  }
}

export async function testJellyfinConnection(
  baseUrl: string,
  apiKey: string,
): Promise<JellyfinStatus> {
  try {
    const client = new JellyfinClient(baseUrl, apiKey)
    const info = await client.ping()
    return {
      configured: true,
      connected: true,
      serverName: info.ServerName,
      version: info.Version,
    }
  } catch (err) {
    return {
      configured: true,
      connected: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
