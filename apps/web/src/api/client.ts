export async function apiFetch<T>(path: string, init?: Parameters<typeof fetch>[1]): Promise<T> {
  const hasBody = init?.body != null
  const res = await fetch(`/api${path}`, {
    headers: { ...(hasBody ? { 'Content-Type': 'application/json' } : {}), ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}
