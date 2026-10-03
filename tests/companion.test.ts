import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createCompanion } from '../companion/server'
import { DocumentSchema } from '../shared/protocol'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'foolscap-test-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const file = join(directory, 'draft.md')
  await writeFile(file, 'Original text.\n')
  let abortObserved = false
  const companion = await createCompanion({
    file,
    origins: ['https://writer.example'],
    rewrite: (input, signal) =>
      input.instruction === 'wait'
        ? new Promise((_, reject) =>
            signal.addEventListener(
              'abort',
              () => {
                abortObserved = true
                reject(new Error('Cancelled'))
              },
              { once: true },
            ),
          )
        : Promise.resolve({ replacement: 'Better text.', reason: 'Clearer.' }),
  })
  await new Promise<void>((resolve) => companion.server.listen(0, '127.0.0.1', resolve))
  cleanups.push(() => companion.close())
  const address = companion.server.address()
  if (!address || typeof address === 'string') throw new Error('No port')
  const base = `http://127.0.0.1:${address.port}`
  const headers = {
    Origin: 'https://writer.example',
    Authorization: `Bearer ${companion.token}`,
    'Content-Type': 'application/json',
  }
  return {
    file,
    base,
    headers,
    request: (path: string, method = 'GET', body?: unknown) =>
      fetch(base + path, {
        method,
        headers,
        ...(method !== 'GET' && body ? { body: JSON.stringify(body) } : {}),
      }),
    aborted: () => abortObserved,
  }
}
describe('real local companion boundary', () => {
  it('opens exact bytes, saves a revision, and refuses an external-edit overwrite', async () => {
    const app = await setup()
    const original = DocumentSchema.parse(await (await app.request('/document')).json())
    expect(original.text).toBe('Original text.\n')
    const saved = await app.request('/document', 'PUT', {
      text: 'Accepted rewrite.\n',
      revision: original.revision,
    })
    expect(saved.status).toBe(200)
    expect(await readFile(app.file, 'utf8')).toBe('Accepted rewrite.\n')
    await writeFile(app.file, 'External edit.\n')
    expect(
      (await app.request('/document', 'PUT', { text: 'Stale draft', revision: original.revision }))
        .status,
    ).toBe(409)
    expect(await readFile(app.file, 'utf8')).toBe('External edit.\n')
  })
  it('requires the token and exact origin, including preflight', async () => {
    const app = await setup()
    expect(
      (await fetch(app.base + '/document', { headers: { Origin: 'https://writer.example' } }))
        .status,
    ).toBe(401)
    expect(
      (
        await fetch(app.base + '/document', {
          headers: { ...app.headers, Origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403)
    const preflight = await fetch(app.base + '/rewrite', {
      method: 'OPTIONS',
      headers: { Origin: 'https://writer.example' },
    })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://writer.example')
    expect(
      (await app.request('/document', 'PUT', { text: 'x', revision: 'x', path: '/other/file' }))
        .status,
    ).toBe(400)
  })
  it('returns a proposal without modifying disk and acknowledges cancellation', async () => {
    const app = await setup()
    const proposal = await app.request('/rewrite', 'POST', {
      id: randomUUID(),
      text: 'Original',
      instruction: 'clearer',
    })
    expect(await proposal.json()).toEqual({ replacement: 'Better text.', reason: 'Clearer.' })
    expect(await readFile(app.file, 'utf8')).toBe('Original text.\n')
    const id = randomUUID()
    const pending = app.request('/rewrite', 'POST', { id, text: 'Original', instruction: 'wait' })
    await expect
      .poll(
        async () =>
          (
            await app.request('/rewrite', 'POST', {
              id: randomUUID(),
              text: 'x',
              instruction: 'clearer',
            })
          ).status,
      )
      .toBe(409)
    expect((await app.request(`/rewrite/${id}`, 'DELETE')).status).toBe(200)
    expect((await pending).status).toBe(500)
    expect(app.aborted()).toBe(true)
  })
})
