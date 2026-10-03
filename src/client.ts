import {
  DocumentSchema,
  FilesSchema,
  HealthSchema,
  ProposalSchema,
  type RewriteRequest,
} from '../shared/protocol'
export function createClient(base: string, token: string) {
  const url = new URL(base)
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Use an HTTP localhost address, for example http://127.0.0.1:43123.')
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(`${url.origin}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(method !== 'GET' && body ? { body: JSON.stringify(body) } : {}),
        signal: signal ?? AbortSignal.timeout(10_000),
        credentials: 'omit',
        cache: 'no-store',
      })
    } catch (error) {
      if (signal?.aborted) throw error
      throw new Error(
        'Cannot reach the companion. Check that it is running, its allowed origin matches this website, and your browser allows local network access.',
      )
    }
    const value: unknown = await response.json()
    if (!response.ok)
      throw new Error(
        typeof value === 'object' && value && 'error' in value && typeof value.error === 'string'
          ? value.error
          : 'Companion request failed.',
      )
    return value
  }
  return {
    health: async () => HealthSchema.parse(await request('/health')),
    files: async () => FilesSchema.parse(await request('/files')),
    read: async (id = 'document') =>
      DocumentSchema.parse(await request('/document?id=' + encodeURIComponent(id))),
    save: async (text: string, revision: string, id = 'document') =>
      DocumentSchema.parse(await request('/document', 'PUT', { id, text, revision })),
    rewrite: async (input: RewriteRequest, signal: AbortSignal) =>
      ProposalSchema.parse(await request('/rewrite', 'POST', input, signal)),
    cancel: async (id: string) => {
      await request(`/rewrite/${id}`, 'DELETE')
    },
  }
}
export type CompanionClient = ReturnType<typeof createClient>
