import { parseArgs } from 'node:util'
import { createCompanion } from './server.ts'
import { rewriteWithCodex } from './codex.ts'
const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    origin: { type: 'string', multiple: true },
    port: { type: 'string', default: '43123' },
    help: { type: 'boolean' },
  },
})
if (values.help || !values.file || !values.origin?.length) {
  console.log(
    'Usage: pnpm companion --file /path/to/draft.md --origin https://your-app.vercel.app\nAdd --origin http://127.0.0.1:5197 for development. Only the chosen file is exposed.',
  )
  process.exit(values.help ? 0 : 1)
}
const port = Number(values.port)
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid port.')
for (const origin of values.origin) {
  const url = new URL(origin)
  if (
    url.origin !== origin ||
    !(
      url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
    )
  )
    throw new Error('Origins must be exact HTTPS origins, or HTTP localhost origins.')
}
const companion = await createCompanion({
  file: values.file,
  origins: values.origin,
  rewrite: rewriteWithCodex,
})
companion.server.listen(port, '127.0.0.1', () => {
  console.log(
    `\nFoolscap companion · http://127.0.0.1:${port}\nFile: ${companion.file}\nAllowed websites: ${values.origin!.join(', ')}\n\nPairing token (paste into Connect local agent):\n${companion.token}\n\nCodex uses your existing local login. Selected text is sent to its model provider.\nKeep this terminal running. Ctrl+C disconnects the companion.\n`,
  )
})
let closing = false
for (const event of ['SIGINT', 'SIGTERM'] as const)
  process.on(event, () => {
    if (closing) return
    closing = true
    void companion.close().finally(() => process.exit())
  })
