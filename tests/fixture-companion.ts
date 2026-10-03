import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createCompanion } from '../companion/server'
const directory = await mkdtemp(join(tmpdir(), 'foolscap-browser-'))
const file = join(directory, 'browser-proof.md')
await writeFile(file, '# Browser proof\n\nThis sentence could be more clear.\n')
const companion = await createCompanion({ file, origins: [process.env.POC_TEST_ORIGIN ?? 'http://127.0.0.1:5197'], token: 'automated-test-token-not-a-real-secret', provider: 'fixture', rewrite: async () => ({ replacement: 'This sentence is clearer.', reason: 'Fixture response for the browser test.' }) })
companion.server.listen(43124, '127.0.0.1', () => console.log(`Test companion ready: ${file}`))
