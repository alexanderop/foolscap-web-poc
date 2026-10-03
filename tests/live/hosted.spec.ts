import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
const original = 'It is important to note that clearer writing uses simpler words.'
test('hosted page pairs with packaged companion, uses bundled Codex, saves and reconnects', async ({
  page,
  context,
}) => {
  const temporary = await mkdtemp(join(tmpdir(), 'foolscap-packaged-live-'))
  const folder = join(temporary, 'Writing')
  await mkdir(folder)
  const file = join(folder, 'live-proof.md')
  await writeFile(
    file,
    `# A hosted page, a local file\n\n${original}\n\nThis paragraph must remain unchanged.\n`,
  )
  const app = await electron.launch({
    executablePath: resolve(
      'release/mac-arm64/Foolscap Connect.app/Contents/MacOS/Foolscap Connect',
    ),
    args: [],
    env: { ...process.env, FOOLSCAP_CONNECT_TEST_PROFILE: join(temporary, 'profile') },
  })
  try {
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] })
      dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
    }, folder)
    const companionWindow = await app.firstWindow()
    await companionWindow.getByRole('button', { name: 'Choose folder…' }).click()
    await expect(companionWindow.getByRole('status')).toContainText('Ready.')
    await context.grantPermissions(['local-network-access'], {
      origin: 'https://foolscap-web-poc.vercel.app',
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'Connect your computer', exact: true }).first().click()
    await expect(page.getByLabel('Pairing token')).toHaveCount(0)
    await page.getByRole('button', { name: 'Connect this browser', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Local agent connected' })).toBeVisible()
    await page.getByRole('button', { name: 'Open file', exact: true }).click()
    await page.getByRole('button', { name: 'live-proof.md', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Markdown editor' })
    await expect(editor).toContainText(original)
    await editor.click()
    await editor.press('ControlOrMeta+Home')
    await editor.press('ArrowDown')
    await editor.press('ArrowDown')
    await editor.press('Home')
    await editor.press('Shift+End')
    await expect(
      page.getByText(`${original.length} characters selected`, { exact: true }),
    ).toBeVisible()
    await page
      .getByLabel('What would you change?')
      .fill(
        'Remove the introductory filler. Keep the meaning. Return only the shorter sentence as replacement.',
      )
    await page.getByRole('button', { name: 'Suggest an edit', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Accept edit' })).toBeVisible({
      timeout: 130_000,
    })
    const replacement = await page.locator('.review-text').innerText()
    expect(replacement).not.toBe(original)
    expect(replacement.trim().length).toBeGreaterThan(0)
    expect(await readFile(file, 'utf8')).toContain(original)
    await mkdir('artifacts/browser', { recursive: true })
    await page.screenshot({ path: 'artifacts/browser/hosted-connect-review.png', fullPage: true })
    await page.getByRole('button', { name: 'Accept edit' }).click()
    await page.getByRole('button', { name: 'Save file', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Saved to the file')
    expect(await readFile(file, 'utf8')).toBe(
      `# A hosted page, a local file\n\n${replacement}\n\nThis paragraph must remain unchanged.\n`,
    )
    await page.reload()
    await expect(page.getByRole('button', { name: 'Local agent connected' })).toBeVisible()
    page.on('dialog', (dialog) => void dialog.accept())
    await page.getByRole('button', { name: 'Open file', exact: true }).click()
    await page.getByRole('button', { name: 'live-proof.md', exact: true }).click()
    await expect(editor).toContainText(replacement)
    await page.getByRole('button', { name: 'Local agent connected' }).click()
    await writeFile(
      'artifacts/browser/live-connect-result.json',
      JSON.stringify(
        {
          ok: true,
          origin: 'https://foolscap-web-poc.vercel.app',
          provider: 'bundled Codex 0.160.0',
          packagedCompanion: true,
          nativeDialogs: 'controlled approval and folder choice',
          localNetworkPermission: 'granted by Playwright',
          replacement,
          exactDiskBytes: true,
          reconnectAfterReload: true,
        },
        null,
        2,
      ),
    )
  } finally {
    await app.close()
    await rm(temporary, { recursive: true, force: true })
  }
})
