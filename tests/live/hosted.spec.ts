import { expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const original = 'It is important to note that clearer writing uses simpler words.'
const file = resolve('artifacts/live-proof.md')
test('Vercel HTTPS page → local Codex → reviewed inline edit → exact local file', async ({
  page,
  context,
}) => {
  const token = process.env.POC_PAIR_TOKEN
  if (!token)
    throw new Error(
      'Start the real companion and set POC_PAIR_TOKEN. This test calls the real Codex CLI.',
    )
  await writeFile(
    file,
    `# A hosted page, a local file\n\n${original}\n\nThis paragraph must remain unchanged.\n`,
  )
  await context.grantPermissions(['local-network-access'], {
    origin: 'https://foolscap-web-poc.vercel.app',
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect local agent', exact: true }).click()
  await page.getByLabel('Pairing token').fill(token)
  await page.getByRole('button', { name: 'Connect companion', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Local agent connected' })).toBeVisible()
  await page.getByRole('button', { name: 'Open local file' }).click()
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
  await expect(page.getByRole('button', { name: 'Accept edit' })).toBeVisible({ timeout: 130_000 })
  const replacement = await page.locator('.review-text').innerText()
  expect(replacement).not.toBe(original)
  expect(replacement.trim().length).toBeGreaterThan(0)
  expect(await readFile(file, 'utf8')).toContain(original)
  await page.screenshot({ path: 'artifacts/browser/hosted-live-review.png', fullPage: true })
  await page.getByRole('button', { name: 'Accept edit' }).click()
  await expect(editor).toContainText(replacement)
  await page.getByRole('button', { name: 'Save file', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Saved to the file')
  const expected = `# A hosted page, a local file\n\n${replacement}\n\nThis paragraph must remain unchanged.\n`
  expect(await readFile(file, 'utf8')).toBe(expected)
  await page.getByRole('button', { name: 'Open local file' }).click()
  await expect(editor).toContainText(replacement)
  await expect(editor).not.toContainText(original)
  await page.screenshot({ path: 'artifacts/browser/hosted-live-saved.png', fullPage: true })
  await writeFile(
    'artifacts/browser/live-result.json',
    JSON.stringify(
      {
        ok: true,
        origin: 'https://foolscap-web-poc.vercel.app',
        browser: 'Chrome',
        permission: 'local-network-access granted through Playwright context',
        provider: 'real installed Codex CLI',
        original,
        replacement,
        diskMatchesExactly: true,
        reopened: true,
        unchangedSurroundingText: true,
      },
      null,
      2,
    ),
  )
  await page.getByRole('button', { name: 'Local agent connected' }).click()
})
