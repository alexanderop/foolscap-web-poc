import { build } from 'esbuild'
import { mkdir, copyFile, writeFile, access, cp } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const arch = process.env.CONNECT_ARCH ?? process.arch
if (!['arm64', 'x64'].includes(arch)) throw new Error('Mac arm64/x64 only')
const output = 'desktop-app'
await mkdir(output + '/codex', { recursive: true })
await build({
  entryPoints: ['desktop/main.ts'],
  outfile: output + '/main.mjs',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  external: ['electron'],
})
await build({
  entryPoints: ['desktop/preload.ts'],
  outfile: output + '/preload.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
})
for (const file of ['index.html', 'renderer.js'])
  await copyFile('desktop/' + file, output + '/' + file)
const staging = `artifacts/codex-${arch}`
await mkdir(staging, { recursive: true })
const target = `${staging}/package/vendor/${arch === 'arm64' ? 'aarch64' : 'x86_64'}-apple-darwin/bin/codex`
try {
  await access(target)
} catch {
  const result = JSON.parse(
    execFileSync(
      'npm',
      ['pack', `@openai/codex@0.160.0-darwin-${arch}`, '--pack-destination', staging, '--json'],
      { encoding: 'utf8' },
    ),
  )
  execFileSync('tar', ['-xzf', staging + '/' + result[0].filename, '-C', staging])
}
await cp(target.replace('/bin/codex', ''), output + '/codex', { recursive: true })
const license = await fetch('https://raw.githubusercontent.com/openai/codex/rust-v0.160.0/LICENSE')
if (!license.ok) throw new Error('Could not include Codex license')
await writeFile(output + '/codex/LICENSE', await license.text())
await writeFile(
  output + '/package.json',
  JSON.stringify(
    {
      name: 'foolscap-connect',
      version: '0.2.0',
      productName: 'Foolscap Connect',
      description: 'Connect your writing room to your computer',
      author: 'Alexander Opalic',
      main: 'main.mjs',
      type: 'module',
    },
    null,
    2,
  ),
)
