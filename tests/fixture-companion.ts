import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createCompanion } from '../companion/server'
const directory = await mkdtemp(join(tmpdir(), 'foolscap-browser-'))
const file = join(directory, 'browser-proof.md')
await writeFile(file, '# Browser proof\n\nThis sentence could be more clear.\n')
const approvals = new Set<string>()
const companion = await createCompanion({
  file,
  approvePairing: async (identity, _origin, interactive) => {
    if (approvals.has(identity)) return true
    if (!interactive) return false
    approvals.add(identity)
    return true
  },
  origins: [process.env.POC_TEST_ORIGIN ?? 'http://127.0.0.1:5197'],
  token: 'automated-test-token-not-a-real-secret',
  provider: 'fixture',
  rewrite: async () => ({
    replacement: 'This sentence is clearer.',
    reason: 'Fixture response for the browser test.',
  }),
})
companion.server.listen(43123, '127.0.0.1', () => console.log(`Test companion ready: ${file}`))

let closing = false
for (const event of ['SIGINT', 'SIGTERM'] as const)
  process.on(event, () => {
    if (closing) return
    closing = true
    void companion.close().finally(async () => {
      await rm(directory, { recursive: true, force: true })
      process.exit()
    })
  })
