// TVDB client — stub for future implementation.
// TVDB v4 requires a token refresh flow (POST /login → Bearer JWT).
// Currently not used; TMDB covers all primary use cases.
// TODO Epic 3+: implement if episode numbering discrepancies arise.

export class TvdbClient {
  constructor(_apiKey: string) {
    // no-op
  }

  isConfigured(): boolean {
    return false
  }
}
