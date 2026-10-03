import { MAX_TEXT } from '../shared/protocol'
export type LocalHandle = {
  getFile(): Promise<File>
  createWritable(): Promise<{
    write(text: string): Promise<void>
    close(): Promise<void>
    abort(): Promise<void>
  }>
}
type FilePickerWindow = Window & {
  showOpenFilePicker?: (options: unknown) => Promise<LocalHandle[]>
}
export async function pickBrowserFile(): Promise<
  { name: string; text: string; handle?: LocalHandle } | undefined
> {
  const picker = (window as FilePickerWindow).showOpenFilePicker
  if (picker) {
    const handles = await picker.call(window, {
      multiple: false,
      types: [
        {
          description: 'Writing files',
          accept: { 'text/plain': ['.md', '.mdx', '.txt', '.markdown'] },
        },
      ],
    })
    const handle = handles[0]
    if (!handle) return
    const file = await handle.getFile()
    if (file.size > MAX_TEXT) throw new Error('Choose a file smaller than 100 KB.')
    return { name: file.name, text: await file.text(), handle }
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.md,.mdx,.markdown,.txt'
    input.hidden = true
    document.body.append(input)
    input.oncancel = () => {
      input.remove()
      resolve(undefined)
    }
    input.onchange = () => {
      const file = input.files?.[0]
      input.remove()
      if (!file) {
        resolve(undefined)
        return
      }
      if (file.size > MAX_TEXT) {
        reject(new Error('Choose a file smaller than 100 KB.'))
        return
      }
      void file.text().then((text) => resolve({ name: file.name, text }), reject)
    }
    input.click()
  })
}
export async function saveBrowserFile(handle: LocalHandle, before: string, text: string) {
  if (new TextEncoder().encode(text).length > MAX_TEXT) throw new Error('Document exceeds 100 KB.')
  if ((await (await handle.getFile()).text()) !== before)
    throw new Error('This file changed outside Foolscap. Download your draft before reopening it.')
  const writer = await handle.createWritable()
  try {
    await writer.write(text)
    await writer.close()
  } catch (error) {
    await writer.abort().catch(() => {})
    throw error
  }
}
