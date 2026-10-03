import { expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createWorkspace } from '../companion/workspace'
it('lists writing files only and refuses a file replaced by a symlink outside the folder', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'foolscap-folder-'))
  try {
    const folder = join(directory, 'writing')
    await mkdir(folder)
    await writeFile(join(folder, 'draft.md'), '# Draft')
    await writeFile(join(folder, 'credentials.json'), '{}')
    await writeFile(join(directory, 'outside.md'), 'Private')
    const workspace = await createWorkspace({ folder })
    const files = await workspace.list()
    expect(files.map((file) => file.name)).toEqual(['draft.md'])
    expect(await workspace.resolve(files[0]!.id)).toBe(await realpath(join(folder, 'draft.md')))
    await rm(join(folder, 'draft.md'))
    await symlink(join(directory, 'outside.md'), join(folder, 'draft.md'))
    await expect(workspace.resolve(files[0]!.id)).rejects.toThrow('outside')
    await expect(workspace.resolve('../outside.md')).rejects.toThrow('Choose')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
