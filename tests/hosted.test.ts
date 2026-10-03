import { afterEach, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from '../api/hosted'
import { randomUUID } from 'node:crypto'
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})
async function request(method: string, body?: unknown) {
  let status = 200
  let result: unknown
  const response = {
    setHeader() {},
    status(value: number) {
      status = value
      return this
    },
    json(value: unknown) {
      result = value
    },
  }
  await handler(
    {
      method,
      body,
      headers: { origin: 'https://foolscap-web-poc.vercel.app', 'x-forwarded-for': '192.0.2.1' },
    } as unknown as VercelRequest,
    response as unknown as VercelResponse,
  )
  return { status, result }
}
function configure() {
  for (const [key, value] of Object.entries({
    HOSTED_AI_ENABLED: 'true',
    OPENAI_API_KEY: 'test-key',
    OPENAI_MODEL: 'configured-model',
    UPSTASH_REDIS_REST_URL: 'https://quota.example',
    UPSTASH_REDIS_REST_TOKEN: 'quota-test',
  }))
    vi.stubEnv(key, value)
}
it('keeps hosted AI unavailable when credentials or quota storage are absent', async () => {
  vi.stubEnv('HOSTED_AI_ENABLED', 'false')
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  expect(await request('GET')).toEqual({ status: 200, result: { available: false } })
  expect((await request('POST', {})).status).toBe(503)
  expect(fetch).not.toHaveBeenCalled()
})
it('checks durable quota before returning the validated provider proposal', async () => {
  configure()
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ result: 1 }))
    .mockResolvedValueOnce(
      Response.json({
        output: [
          {
            content: [
              {
                type: 'output_text',
                text: JSON.stringify({ replacement: 'Clear prose.', reason: 'Less filler.' }),
              },
            ],
          },
        ],
      }),
    )
  vi.stubGlobal('fetch', fetch)
  expect(
    await request('POST', { id: randomUUID(), text: 'Some prose.', instruction: 'Shorten' }),
  ).toEqual({ status: 200, result: { replacement: 'Clear prose.', reason: 'Less filler.' } })
  const sent = JSON.parse(String(fetch.mock.calls[1]![1].body)) as {
    store: boolean
    model: string
    max_output_tokens: number
  }
  expect(sent).toMatchObject({ store: false, model: 'configured-model', max_output_tokens: 2048 })
})
it('does not call the AI provider when the daily quota is exhausted', async () => {
  configure()
  const fetch = vi.fn().mockResolvedValue(Response.json({ result: 0 }))
  vi.stubGlobal('fetch', fetch)
  expect(
    (await request('POST', { id: randomUUID(), text: 'Prose.', instruction: 'Shorten' })).status,
  ).toBe(429)
  expect(fetch).toHaveBeenCalledTimes(1)
})
