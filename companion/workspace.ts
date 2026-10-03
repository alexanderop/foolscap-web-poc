import { createHash } from 'node:crypto'
import { readdir, realpath } from 'node:fs/promises'
import { basename, join, relative, isAbsolute } from 'node:path'
export async function createWorkspace(options: { file?: string; folder?: string }) {
  const fixed = options.file ? await realpath(options.file) : undefined
  const root = options.folder ? await realpath(options.folder) : undefined
  if (!fixed && !root) throw new Error('Choose a file or folder first.')
  const paths = new Map<string, string>()
  async function list() {
    const entries: { id: string; name: string }[] = []
    if (fixed) {
      paths.set('document', fixed)
      return [{ id: 'document', name: basename(fixed) }]
    }
    let visited = 0
    async function walk(directory: string, depth: number) {
      if (depth > 5 || visited > 2000 || entries.length >= 200) return
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (++visited > 2000 || entries.length >= 200) break
        if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.isSymbolicLink())
          continue
        const path = join(directory, entry.name)
        if (entry.isDirectory()) await walk(path, depth + 1)
        else if (entry.isFile() && /\.(md|mdx|markdown|txt)$/i.test(entry.name)) {
          const id = createHash('sha256').update(relative(root!, path)).digest('hex')
          paths.set(id, path)
          entries.push({ id, name: relative(root!, path) })
        }
      }
    }
    paths.clear()
    await walk(root!, 0)
    return entries.sort((a, b) => a.name.localeCompare(b.name))
  }
  async function resolve(id: string) {
    if (!paths.size) await list()
    const path = paths.get(id)
    if (!path) throw new Error('Choose a document from your connected folder.')
    const resolved = await realpath(path)
    if (root) {
      const local = relative(root, resolved)
      if (local.startsWith('..') || isAbsolute(local))
        throw new Error('This file is outside your connected folder.')
    }
    if (resolved !== path) throw new Error('Links are not available through the companion.')
    return path
  }
  return { list, resolve, name: basename(root ?? fixed!), fixed }
}
