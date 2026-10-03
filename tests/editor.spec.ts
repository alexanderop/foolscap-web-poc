import { expect, test } from '@playwright/test'
import { demoOriginal, demoReplacement } from '../src/sample'
test('inline review rejects, accepts, and undoes as one editor action', async ({ page }) => {
  await page.goto('/')
  const editor = page.getByRole('textbox', { name: 'Markdown editor' })
  await page.getByRole('button', { name: 'Preview an inline edit' }).click()
  await expect(page.getByRole('region', { name: 'Suggested edit' })).toContainText(demoReplacement)
  await page.getByRole('button', { name: 'Reject', exact: true }).click()
  await expect(editor).toContainText(demoOriginal)
  await page.getByRole('button', { name: 'Preview an inline edit' }).click()
  await page.getByRole('button', { name: 'Accept edit' }).click()
  await expect(editor).not.toContainText(demoOriginal)
  await expect(editor).toContainText(demoReplacement)
  await page.getByRole('button', { name: 'Undo edit' }).click()
  await expect(editor).toContainText(demoOriginal)
})
test('typing invalidates an outstanding proposal', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Preview an inline edit' }).click()
  await page.getByRole('textbox', { name: 'Markdown editor' }).press('ArrowRight')
  await page.keyboard.type('Changed ')
  await expect(page.getByRole('button', { name: 'Accept edit' })).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('draft changed')
})
test('paired browser opens a file, reviews a fixture rewrite, saves and reopens exact text', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect your computer', exact: true }).first().click()
  await expect(page.getByLabel('Pairing token')).toHaveCount(0)
  await page.getByRole('button', { name: 'Connect this browser', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Local agent connected' })).toBeVisible()
  await page.getByRole('button', { name: 'Open file', exact: true }).click()
  await page.getByRole('button', { name: 'browser-proof.md', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Markdown editor' })
  await expect(editor).toContainText('Browser proof')
  await editor.click()
  await editor.press('ControlOrMeta+End')
  await editor.press('ArrowLeft')
  await editor.press('Home')
  await editor.press('Shift+End')
  await page.getByRole('button', { name: 'Suggest an edit' }).click()
  await page.getByRole('button', { name: 'Accept edit' }).click()
  await page.getByRole('button', { name: 'Save file', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Saved to the file')
  await page.getByRole('button', { name: 'Open file', exact: true }).click()
  await page.getByRole('button', { name: 'browser-proof.md', exact: true }).click()
  await expect(editor).toContainText('This sentence is clearer.')
  await expect(editor).not.toContainText('could be more clear')
})
test('narrow layout keeps editor and controls inside viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('textbox', { name: 'Markdown editor' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  await page.getByRole('button', { name: 'Preview an inline edit' }).click()
  await expect(page.getByRole('button', { name: 'Accept edit' })).toBeVisible()
})

test('start writing needs no account and recovers the draft after reload', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Start writing', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Markdown editor' })
  await editor.press('ControlOrMeta+End')
  await editor.press('Enter')
  await page.keyboard.type('My recovered thought.')
  page.on('dialog', (dialog) => void dialog.accept())
  await page.reload()
  await expect(editor).toContainText('My recovered thought.')
  await expect(page.getByRole('region', { name: 'Get started' })).toHaveCount(0)
})
test('approved browser reconnects after reload without copying a token', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect your computer', exact: true }).first().click()
  await page.getByRole('button', { name: 'Connect this browser', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Local agent connected' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Local agent connected' })).toBeVisible()
})

test('opens a file without companion setup and downloads the edited copy', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined })
  })
  await page.goto('/')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Open file', exact: true }).click()
  await (
    await chooser
  ).setFiles({
    name: 'my-note.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# My own note\n\nA simple beginning.'),
  })
  const editor = page.getByRole('textbox', { name: 'Markdown editor' })
  await expect(editor).toContainText('A simple beginning.')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await editor.click()
  await editor.press('ControlOrMeta+End')
  await page.keyboard.type(' A better ending.')
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save file', exact: true }).click()
  const destination = testInfo.outputPath('edited.md')
  await (await downloaded).saveAs(destination)
  const { readFile } = await import('node:fs/promises')
  expect(await readFile(destination, 'utf8')).toBe(
    '# My own note\n\nA simple beginning. A better ending.',
  )
})
