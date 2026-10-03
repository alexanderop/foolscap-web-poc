import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { createCompanion } from '../companion/server'
import { createCodexRewrite } from '../companion/codex'
import { z } from 'zod'

const ORIGIN = 'https://foolscap-web-poc.vercel.app'
const Preferences = z.object({
  folder: z.string().optional(),
  approvals: z.array(z.string()).default([]),
})
let prefs: z.infer<typeof Preferences> = { approvals: [] }
let window: BrowserWindow
let companion: Awaited<ReturnType<typeof createCompanion>> | undefined
let login: ChildProcess | undefined
let signedIn = false
let message = 'Choose the folder you want to use in the writing room.'
let quitting = false
const binary = () =>
  app.isPackaged
    ? join(process.resourcesPath, 'codex', 'bin', 'codex')
    : join(app.getAppPath(), 'codex', 'bin', 'codex')
const configPath = () => join(app.getPath('userData'), 'connection.json')
async function persist() {
  await mkdir(dirname(configPath()), { recursive: true })
  await writeFile(configPath(), JSON.stringify(prefs), { mode: 0o600 })
}
function state() {
  return {
    folder: prefs.folder ?? '',
    running: !!companion,
    signedIn,
    signingIn: !!login,
    message,
    autoStart: app.getLoginItemSettings().openAtLogin,
    pairedBrowsers: prefs.approvals.length,
  }
}
function emit() {
  if (window && !window.isDestroyed()) window.webContents.send('state', state())
}
async function checkLogin() {
  signedIn = await new Promise<boolean>((resolve) =>
    execFile(binary(), ['login', 'status'], { timeout: 10_000 }, (error) => resolve(!error)),
  )
  emit()
}
async function start() {
  if (!prefs.folder) return
  await companion?.close()
  companion = undefined
  const next = await createCompanion({
    folder: prefs.folder,
    origins: [ORIGIN],
    rewrite: createCodexRewrite(binary()),
    approvePairing: async (identity, origin, interactive) => {
      const key = `${origin}|${identity}`
      if (prefs.approvals.includes(key)) return true
      if (!interactive) return false
      if (!process.env.FOOLSCAP_CONNECT_TEST_PROFILE) window.show()
      const result = await dialog.showMessageBox(window, {
        type: 'question',
        title: 'Connect this browser?',
        message: `Allow ${new URL(origin).hostname} to connect?`,
        detail:
          'This browser will be able to open and save Markdown files in your chosen folder and request Codex rewrites. You can disconnect all browsers here at any time.',
        buttons: ['Allow connection', 'Not now'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      if (result.response !== 0) return false
      prefs.approvals.push(key)
      await persist()
      emit()
      return true
    },
  })
  try {
    await new Promise<void>((resolve, reject) => {
      next.server.once('error', reject)
      next.server.listen(43123, '127.0.0.1', resolve)
    })
    companion = next
    message = 'Ready. Open the writing room and choose Connect your computer.'
  } catch {
    message = 'Another companion may already be open. Close it, then choose your folder again.'
  }
  emit()
}
if (process.env.FOOLSCAP_CONNECT_TEST_PROFILE)
  app.setPath('userData', process.env.FOOLSCAP_CONNECT_TEST_PROFILE)
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    window?.show()
    window?.focus()
  })
  app.on('open-url', (event) => {
    event.preventDefault()
    window?.show()
    window?.focus()
  })
  app.on('before-quit', (event) => {
    if (quitting) return
    event.preventDefault()
    quitting = true
    login?.kill('SIGTERM')
    void companion?.close().finally(() => app.exit())
    if (!companion) app.exit()
  })
  void app.whenReady().then(async () => {
    try {
      prefs = Preferences.parse(JSON.parse(await readFile(configPath(), 'utf8')))
    } catch {
      /* first launch has no preferences */
    }
    window = new BrowserWindow({
      show: !process.env.FOOLSCAP_CONNECT_TEST_PROFILE,
      width: 560,
      height: 780,
      minWidth: 460,
      minHeight: 560,
      title: 'Foolscap Connect',
      backgroundColor: '#f6f5f1',
      webPreferences: {
        preload: join(app.getAppPath(), 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.on('close', (event) => {
      if (!quitting) {
        event.preventDefault()
        window.hide()
      }
    })
    app.on('activate', () => window.show())
    if (!process.env.FOOLSCAP_CONNECT_TEST_PROFILE)
      app.setAsDefaultProtocolClient('foolscap-connect')
    ipcMain.handle('action', async (event, input: unknown) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame)
        throw new Error('Invalid sender')
      const action = z
        .enum([
          'state',
          'choose-folder',
          'open-editor',
          'sign-in',
          'check-login',
          'forget',
          'toggle-login',
          'quit',
        ])
        .parse(input)
      if (action === 'choose-folder') {
        const result = await dialog.showOpenDialog(window, {
          title: 'Choose your writing folder',
          properties: ['openDirectory', 'createDirectory'],
        })
        if (!result.canceled && result.filePaths[0]) {
          prefs.folder = result.filePaths[0]
          await persist()
          await start()
        }
      } else if (action === 'open-editor') await shell.openExternal(ORIGIN)
      else if (action === 'sign-in' && !login) {
        login = spawn(binary(), ['login'], { stdio: ['ignore', 'pipe', 'pipe'] })
        message = 'Finish signing in in your browser. Your login stays on this computer.'
        emit()
        login.stdout?.resume()
        login.stderr?.resume()
        login.once('error', () => {
          message = 'Could not open sign-in. Please reopen Foolscap Connect.'
          login = undefined
          emit()
        })
        login.once('close', () => {
          login = undefined
          void checkLogin().then(() => {
            message = signedIn
              ? 'Signed in. Your writing agent is ready.'
              : 'Sign-in did not finish. Try Sign in again.'
            emit()
          })
        })
      } else if (action === 'check-login') await checkLogin()
      else if (action === 'forget') {
        prefs.approvals = []
        companion?.revoke()
        await persist()
        message = 'All browsers disconnected. A new approval is required to reconnect.'
      } else if (action === 'toggle-login')
        app.setLoginItemSettings({ openAtLogin: !app.getLoginItemSettings().openAtLogin })
      else if (action === 'quit') app.quit()
      emit()
      return state()
    })
    await window.loadFile(join(app.getAppPath(), 'index.html'))
    try {
      await start()
    } catch {
      message = 'Your writing folder is unavailable. Choose a folder to reconnect.'
      emit()
    }
    await checkLogin()
  })
}
