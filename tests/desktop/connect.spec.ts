import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { webcrypto } from 'node:crypto'
import { DocumentSchema, FilesSchema } from '../../shared/protocol'
test('desktop folder picker, native approval, remembered browser, save and revoke', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'foolscap-connect-app-'))
  const folder = join(temporary, 'writing')
  await mkdir(folder)
  const file = join(folder, 'native-proof.md')
  await writeFile(file, '# Native proof\n')
  const app = await electron.launch({
    args: [resolve('desktop-app')],
    env: { ...process.env, FOOLSCAP_CONNECT_TEST_PROFILE: join(temporary, 'profile') },
  })
  try {
    const window = await app.firstWindow()
    await expect(
      window.getByRole('heading', { name: 'Foolscap Connect', exact: true }),
    ).toBeVisible()
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
      dialog.showMessageBox = async (...args: unknown[]) => {
        const options = args.at(-1)
        if (!(
          options &&
          typeof options === 'object' &&
          'message' in options &&
          typeof options.message === 'string' &&
          options.message.includes('foolscap-web-poc.vercel.app')
        ))
          throw new Error('Unexpected approval')
        return { response: 0, checkboxChecked: false }
      }
    }, folder)
    await window.getByRole('button', { name: 'Choose folder…' }).click()
    await expect(window.getByRole('status')).toContainText('Ready.')
    const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'sign',
      'verify',
    ])
    const origin = 'https://foolscap-web-poc.vercel.app'
    const post = async (path: string, body: unknown) =>
      fetch('http://127.0.0.1:43123' + path, {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    async function pair(interactive: boolean) {
      const challenge = (await (
        await post('/pair/challenge', await webcrypto.subtle.exportKey('jwk', keys.publicKey))
      ).json()) as { id: string; nonce: string }
      const signature = Buffer.from(
        await webcrypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          keys.privateKey,
          new TextEncoder().encode(challenge.nonce),
        ),
      ).toString('base64url')
      return post('/pair/complete', { id: challenge.id, signature, interactive })
    }
    const paired = await pair(true)
    expect(paired.status).toBe(200)
    const { token } = (await paired.json()) as { token: string }
    const headers = {
      Origin: origin,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
    const files = FilesSchema.parse(
      await (await fetch('http://127.0.0.1:43123/files', { headers })).json(),
    )
    expect(files.map((entry) => entry.name)).toEqual(['native-proof.md'])
    const doc = DocumentSchema.parse(
      await (await fetch('http://127.0.0.1:43123/document?id=' + files[0]!.id, { headers })).json(),
    )
    const saved = await fetch('http://127.0.0.1:43123/document', {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        id: doc.id,
        revision: doc.revision,
        text: '# Saved through the app\n',
      }),
    })
    expect(saved.status).toBe(200)
    expect(await readFile(file, 'utf8')).toBe('# Saved through the app\n')
    expect((await pair(false)).status).toBe(200)
    await mkdir('artifacts/browser', { recursive: true })
    await window.screenshot({ path: 'artifacts/browser/connect-app.png' })
    await window.getByRole('button', { name: 'Disconnect all browsers' }).click()
    expect((await fetch('http://127.0.0.1:43123/files', { headers })).status).toBe(401)
    expect((await pair(false)).status).not.toBe(200)
  } finally {
    await app.close()
    await rm(temporary, { recursive: true, force: true })
  }
})
