import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { HealthSchema, MAX_TEXT, ProposalSchema, RewriteSchema, SaveSchema } from '../shared/protocol.ts'
import type { Rewrite } from './codex.ts'

class HttpError extends Error { constructor(readonly status: number, message: string) { super(message) } }
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk); size += buffer.length
    if (size > 500_000) throw new HttpError(413, 'Request too large.')
    chunks.push(buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new HttpError(400, 'Invalid JSON.') }
}
export async function createCompanion(options: { file: string; origins: readonly string[]; token?: string; rewrite: Rewrite; provider?: 'codex' | 'fixture' }) {
  const file = await realpath(options.file)
  const token = options.token ?? randomBytes(32).toString('base64url')
  const jobs = new Map<string, AbortController>()
  let saving = false
  const read = async () => {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > MAX_TEXT) throw new HttpError(413, 'Choose a Markdown file smaller than 100 KB.')
      const text = await handle.readFile('utf8')
      return { name: basename(file), text, revision: digest(text) }
    } finally { await handle.close() }
  }
  await read()
  const respond = (response: ServerResponse, status: number, value: unknown) => { response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); response.end(JSON.stringify(value)) }
  const server = createServer(async (request, response) => {
    try {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host ?? '')) throw new HttpError(403, 'Invalid host.')
      const origin = request.headers.origin
      if (!origin || !options.origins.includes(origin)) throw new HttpError(403, 'This website is not paired with the companion.')
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Vary', 'Origin')
      response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
      response.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS')
      response.setHeader('Access-Control-Allow-Private-Network', 'true')
      if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return }
      const supplied = Buffer.from(request.headers.authorization ?? '')
      const expected = Buffer.from(`Bearer ${token}`)
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new HttpError(401, 'Pairing token is missing or incorrect.')
      if (request.url === '/health' && request.method === 'GET') {
        respond(response, 200, HealthSchema.parse({ name: 'foolscap-companion', provider: options.provider ?? 'codex', file: basename(file) })); return
      }
      if (request.url === '/document' && request.method === 'GET') { respond(response, 200, await read()); return }
      if (request.url === '/document' && request.method === 'PUT') {
        const input = SaveSchema.parse(await readBody(request))
        if (saving) throw new HttpError(409, 'Another save is in progress. Try again.')
        saving = true
        const temporary = join(dirname(file), `.${basename(file)}.${randomBytes(8).toString('hex')}.tmp`)
        try {
          const before = await read()
          if (before.revision !== input.revision) throw new HttpError(409, 'The file changed on disk. Download your draft before reopening it.')
          if (Buffer.byteLength(input.text) > MAX_TEXT) throw new HttpError(413, 'Document exceeds 100 KB.')
          await writeFile(temporary, input.text, { flag: 'wx', mode: 0o600 })
          if ((await read()).revision !== input.revision) throw new HttpError(409, 'The file changed while saving. Your draft is still in the editor.')
          await rename(temporary, file)
          respond(response, 200, { name: basename(file), text: input.text, revision: digest(input.text) })
        } finally { saving = false; await rm(temporary, { force: true }) }
        return
      }
      if (request.url === '/rewrite' && request.method === 'POST') {
        const input = RewriteSchema.parse(await readBody(request))
        if (jobs.size) throw new HttpError(409, 'A rewrite is already running.')
        const controller = new AbortController(); jobs.set(input.id, controller)
        const disconnect = () => { if (!response.writableEnded) controller.abort() }
        response.on('close', disconnect)
        try { respond(response, 200, ProposalSchema.parse(await options.rewrite(input, controller.signal))) }
        finally { response.off('close', disconnect); jobs.delete(input.id) }
        return
      }
      if (request.url?.startsWith('/rewrite/') && request.method === 'DELETE') {
        jobs.get(request.url.slice('/rewrite/'.length))?.abort(); respond(response, 200, { ok: true }); return
      }
      throw new HttpError(404, 'Unknown operation.')
    } catch (error) {
      if (response.destroyed || response.writableEnded) return
      const status = error instanceof HttpError ? error.status : error instanceof Error && error.name === 'ZodError' ? 400 : 500
      respond(response, status, { error: status === 400 ? 'Invalid request.' : error instanceof Error ? error.message : 'Companion request failed.' })
    }
  })
  server.requestTimeout = 15_000
  return { server, token, file, async close() { for (const job of jobs.values()) job.abort(); server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())) } }
}
