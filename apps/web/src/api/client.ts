export async function apiFetch<T>(path: string, init?: Parameters<typeof fetch>[1]): Promise<T> {
  const hasBody = init?.body != null
  const res = await fetch(`/api${path}`, {
    headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string; message?: string }
    throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`)
  }
  // Skip JSON parsing for empty responses (204 No Content or Content-Length: 0)
  if (res.status === 204 || res.headers.get('Content-Length') === '0') {
    return undefined as T
  }
  return res.json() as Promise<T>
}
