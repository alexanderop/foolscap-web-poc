<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { EditorState, Transaction } from '@codemirror/state'
import { EditorView, keymap, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, undo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import {
  Feather,
  ArrowUp,
  Circle,
  FileText,
  Plug,
  Download,
  Undo2,
  X,
  Check,
  ArrowUpRight,
} from '@lucide/vue'
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from 'reka-ui'
import { createClient, type CompanionClient } from './client'
import { inlineReview, setProposal } from './inlineReview'
import { sample, demoOriginal, demoReplacement } from './sample'
import { pairComputer, companionAddress } from './pairing'
import { pickBrowserFile, saveBrowserFile, type LocalHandle } from './browserFiles'
import { ProposalSchema, type DocumentSnapshot, type Proposal } from '../shared/protocol'

const mount = ref<HTMLDivElement>()
const editor = shallowRef<EditorView>()
const content = ref(sample)
const selected = ref('')
const instruction = ref('Make this clearer and more concise.')
const mode = ref<'demo' | 'codex' | 'hosted'>('demo')
const dialog = ref(false)
const browserHandle = shallowRef<LocalHandle>()
const welcome = ref(true)
const cloudAvailable = ref(false)
const filesOpen = ref(false)
const availableFiles = ref<{ id: string; name: string }[]>([])
let pairController: AbortController | undefined
const client = shallowRef<CompanionClient>()
const file = ref<DocumentSnapshot>()
const busy = ref(false)
const saving = ref(false)
const pairing = ref(false)
const error = ref('')
const connectionError = ref('')
const status = ref('A quiet place for your next draft.')
const review = ref(false)
const words = computed(() => content.value.trim().split(/\s+/u).filter(Boolean).length)
const dirty = computed(() =>
  file.value ? content.value !== file.value.text : content.value !== sample,
)
let version = 0
let controller: AbortController | undefined
let activeId: string | undefined
let activeClient: CompanionClient | undefined

function cancel() {
  controller?.abort()
  controller = undefined
  if (activeId && activeClient) void activeClient.cancel(activeId).catch(() => {})
  activeId = undefined
  activeClient = undefined
  busy.value = false
}
function cancelRewrite() {
  cancel()
  status.value = 'Rewrite cancelled.'
}
function discardReview() {
  editor.value?.dispatch({ effects: setProposal.of(null) })
  review.value = false
}
function showProposal(
  proposal: Proposal,
  from: number,
  to: number,
  original: string,
  expectedVersion: number,
) {
  const view = editor.value
  if (!view || version !== expectedVersion || view.state.sliceDoc(from, to) !== original) {
    status.value = 'Your text changed. Select it again for a fresh suggestion.'
    return
  }
  review.value = true
  view.dispatch({
    effects: setProposal.of({
      from,
      to,
      ...proposal,
      accept: () => {
        if (version !== expectedVersion || view.state.sliceDoc(from, to) !== original) {
          discardReview()
          return
        }
        view.dispatch({
          changes: { from, to, insert: proposal.replacement },
          selection: { anchor: from, head: from + proposal.replacement.length },
          effects: setProposal.of(null),
          annotations: Transaction.userEvent.of('input.rewrite'),
          scrollIntoView: true,
        })
        review.value = false
        status.value = 'Edit accepted. Undo restores your original words.'
        view.focus()
      },
      reject: () => {
        discardReview()
        status.value = 'Suggestion dismissed. Your words are unchanged.'
        view.focus()
      },
    }),
    selection: { anchor: from },
    scrollIntoView: true,
  })
  status.value = 'Review the suggestion in your document.'
}
function previewDemo() {
  const view = editor.value
  if (!view) return
  const from = view.state.doc.toString().indexOf(demoOriginal)
  if (from < 0) {
    error.value =
      'The sample paragraph has changed. Undo your changes or reload to try the guided demo again.'
    return
  }
  error.value = ''
  mode.value = 'demo'
  showProposal(
    {
      replacement: demoReplacement,
      reason: 'A scripted example: removes filler and puts the action first. No agent was called.',
    },
    from,
    from + demoOriginal.length,
    demoOriginal,
    version,
  )
}
async function rewrite() {
  const view = editor.value
  if (!view || busy.value) return
  error.value = ''
  if (mode.value === 'demo') {
    previewDemo()
    return
  }
  if (mode.value === 'codex' && !client.value) {
    dialog.value = true
    return
  }
  const { from, to } = view.state.selection.main
  const text = view.state.sliceDoc(from, to)
  if (!text.trim()) {
    error.value = 'Select the words you want to rewrite first.'
    return
  }
  if (!instruction.value.trim()) {
    error.value = 'Tell the agent how to change the selection.'
    return
  }
  discardReview()
  const expectedVersion = version
  const ownController = new AbortController()
  controller = ownController
  const id = crypto.randomUUID()
  activeId = id
  activeClient = client.value
  busy.value = true
  status.value =
    mode.value === 'hosted'
      ? 'Your online writing partner is working…'
      : 'Your local Codex is working on the selection…'
  try {
    const input = { id, text, instruction: instruction.value }
    let proposal: Proposal
    if (mode.value === 'hosted') {
      const response = await fetch('/api/hosted', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: ownController.signal,
      })
      const value: unknown = await response.json()
      if (!response.ok)
        throw new Error(
          typeof value === 'object' && value && 'error' in value
            ? String(value.error)
            : 'Online AI is unavailable.',
        )
      proposal = ProposalSchema.parse(value)
    } else proposal = await client.value!.rewrite(input, ownController.signal)
    if (!ownController.signal.aborted) showProposal(proposal, from, to, text, expectedVersion)
  } catch (cause) {
    if (!ownController.signal.aborted)
      error.value = cause instanceof Error ? cause.message : 'Rewrite failed.'
  } finally {
    if (controller === ownController) {
      controller = undefined
      activeId = undefined
      activeClient = undefined
      busy.value = false
    }
  }
}
async function connect(interactive = true) {
  if (pairing.value) return
  pairing.value = true
  connectionError.value = ''
  const own = new AbortController()
  pairController = own
  const timeout = setTimeout(() => own.abort(), interactive ? 120_000 : 5000)
  try {
    const token = await pairComputer(interactive, own.signal)
    if (!token || own.signal.aborted) return
    const next = createClient(companionAddress, token)
    await next.health()
    if (own.signal.aborted) return
    client.value = next
    mode.value = 'codex'
    dialog.value = false
    status.value = 'Your computer is connected. Choose Open file to browse your writing folder.'
  } catch {
    if (interactive && !own.signal.aborted)
      connectionError.value =
        'Open Foolscap Connect, choose your folder, then try again. Allow local network access if your browser asks.'
    else if (interactive)
      connectionError.value = 'Connection timed out. Open Foolscap Connect and try again.'
  } finally {
    clearTimeout(timeout)
    if (pairController === own) {
      pairController = undefined
      pairing.value = false
    }
  }
}
function startWriting() {
  welcome.value = false
  editor.value?.focus()
  try {
    localStorage.setItem('foolscap-welcomed', 'yes')
  } catch {}
}
function mayReplace() {
  return (
    !dirty.value ||
    window.confirm('Replace this draft? Save or download it first if you want to keep it.')
  )
}
function loadDocument(snapshot: DocumentSnapshot, handle?: LocalHandle) {
  cancel()
  discardReview()
  file.value = snapshot
  browserHandle.value = handle
  editor.value?.setState(makeState(snapshot.text))
  content.value = snapshot.text
  selected.value = ''
  version++
  welcome.value = false
  filesOpen.value = false
  status.value = handle
    ? 'File opened. Save writes back to the file you chose.'
    : client.value
      ? 'Opened from your writing folder.'
      : 'File opened. Save downloads your edited copy.'
}
async function openFile() {
  if (!mayReplace()) return
  error.value = ''
  const startingVersion = version
  try {
    if (client.value) {
      availableFiles.value = await client.value.files()
      filesOpen.value = true
      return
    }
    const picked = await pickBrowserFile()
    if (!picked) return
    if (version !== startingVersion)
      throw new Error('Your draft changed while opening. Please try again.')
    loadDocument(
      { id: 'browser', name: picked.name, text: picked.text, revision: '' },
      picked.handle,
    )
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') return
    error.value = cause instanceof Error ? cause.message : 'Could not open file.'
  }
}
async function openConnectedFile(id: string) {
  const current = client.value
  const startingVersion = version
  if (!current) return
  try {
    const snapshot = await current.read(id)
    if (version !== startingVersion || current !== client.value)
      throw new Error('Your draft changed while opening. Please try again.')
    loadDocument(snapshot)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not open file.'
  }
}
async function saveFile() {
  if (saving.value) return
  if (
    !file.value ||
    (!browserHandle.value && file.value.id === 'browser') ||
    (!client.value && !browserHandle.value)
  ) {
    download()
    return
  }
  saving.value = true
  error.value = ''
  const text = content.value
  try {
    if (browserHandle.value) {
      await saveBrowserFile(browserHandle.value, file.value.text, text)
      file.value = { ...file.value, text }
    } else file.value = await client.value!.save(text, file.value.revision, file.value.id)
    status.value =
      content.value === text
        ? 'Saved to the file on your computer.'
        : 'Saved. Your newer edits are still unsaved.'
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not save.'
  } finally {
    saving.value = false
  }
}
function disconnect() {
  cancel()
  client.value = undefined
  if (file.value?.id !== 'browser') file.value = undefined
  mode.value = cloudAvailable.value ? 'hosted' : 'demo'
  discardReview()
  status.value = 'Disconnected. Your draft remains in the editor.'
}
function download() {
  const url = URL.createObjectURL(
    new Blob([content.value], { type: 'text/markdown;charset=utf-8' }),
  )
  const link = document.createElement('a')
  link.href = url
  link.download = file.value?.name ?? 'a-little-room-to-think.md'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  status.value = 'Draft downloaded as Markdown.'
}
function makeState(doc: string) {
  return EditorState.create({
    doc,
    extensions: [
      history(),
      drawSelection(),
      markdown(),
      syntaxHighlighting(
        HighlightStyle.define([
          { tag: tags.heading1, class: 'md-h1' },
          { tag: tags.heading2, class: 'md-h2' },
          { tag: tags.processingInstruction, color: '#9b9b90' },
          { tag: tags.strong, fontWeight: '600' },
          { tag: tags.emphasis, fontStyle: 'italic' },
        ]),
      ),
      EditorView.lineWrapping,
      inlineReview,
      keymap.of([
        {
          key: 'Mod-Enter',
          run: () => {
            void rewrite()
            return true
          },
        },
        {
          key: 'Mod-s',
          run: () => {
            void saveFile()
            return true
          },
        },
        ...defaultKeymap,
        ...historyKeymap,
      ]),
      EditorView.contentAttributes.of({ 'aria-label': 'Markdown editor', spellcheck: 'true' }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          version++
          content.value = update.state.doc.toString()
          try {
            localStorage.setItem('foolscap-draft', content.value)
          } catch {
            /* writing works without storage */
          }
          if (busy.value) {
            cancel()
            status.value = 'Rewrite cancelled because your draft changed.'
          }
          if (review.value) {
            review.value = false
            status.value = 'Suggestion cleared because your draft changed.'
          }
        }
        const range = update.state.selection.main
        selected.value = update.state.sliceDoc(range.from, range.to)
      }),
    ],
  })
}
const beforeUnload = (event: BeforeUnloadEvent) => {
  if (dirty.value) {
    event.preventDefault()
    event.returnValue = ''
  }
}
onMounted(() => {
  let draft = sample
  try {
    draft = localStorage.getItem('foolscap-draft') ?? sample
    welcome.value = localStorage.getItem('foolscap-welcomed') !== 'yes'
  } catch {}
  content.value = draft
  editor.value = new EditorView({ state: makeState(draft), parent: mount.value })
  void connect(false)
  void fetch('/api/hosted')
    .then((response) => response.json())
    .then((value: unknown) => {
      cloudAvailable.value =
        typeof value === 'object' &&
        value !== null &&
        'available' in value &&
        value.available === true
      if (cloudAvailable.value && !client.value) mode.value = 'hosted'
    })
    .catch(() => {})
  window.addEventListener('beforeunload', beforeUnload)
})
onBeforeUnmount(() => {
  cancel()
  pairController?.abort()
  editor.value?.destroy()
  window.removeEventListener('beforeunload', beforeUnload)
})
</script>

<template>
  <div class="writing-room">
    <header class="topbar">
      <a class="brand" href="/" aria-label="Foolscap home"
        ><Feather :size="21" :stroke-width="1.4" /><span
          >foolscap<span class="brand-dot">.</span></span
        ><span class="edition">web experiment</span></a
      >
      <div class="header-actions">
        <a
          class="source-link"
          href="https://github.com/alexanderop/foolscap-web-poc"
          target="_blank"
          rel="noreferrer"
          >Source <ArrowUpRight :size="13"
        /></a>
        <button v-if="client" class="connection connected" :disabled="saving" @click="disconnect">
          <span class="status-dot" /> Local agent connected <X :size="13" />
        </button>
        <button v-else class="connection" @click="dialog = true">
          <Plug :size="14" /> Connect your computer
        </button>
      </div>
    </header>
    <section v-if="welcome" class="welcome-strip" aria-label="Get started">
      <div>
        <h1>Your words. No setup.</h1>
        <p>
          Write, open a file, or try an inline edit. Connect your computer only when you want your
          local agent.
        </p>
      </div>
      <div class="welcome-actions">
        <button class="primary-button" @click="startWriting">
          Start writing <ArrowUpRight :size="16" /></button
        ><button class="connection" @click="dialog = true">Connect your computer</button>
      </div>
    </section>
    <main class="workspace">
      <section class="document-pane" aria-label="Writing workspace">
        <div class="document-bar">
          <span
            ><FileText :size="14" /> {{ file?.name ?? 'a-little-room-to-think.md' }}
            <span v-if="dirty" class="unsaved-dot" aria-label="Unsaved changes" /></span
          ><span class="document-kind">{{ file ? 'LOCAL FILE' : 'SCRATCH DRAFT' }}</span>
        </div>
        <div class="editor-actions">
          <button :disabled="saving || busy" @click="openFile">Open file</button
          ><button :disabled="saving" @click="saveFile">
            {{ saving ? 'Saving…' : 'Save file' }}</button
          ><span class="action-divider" /><button
            aria-label="Undo edit"
            title="Undo (⌘Z / Ctrl+Z)"
            @click="editor && undo(editor)"
          >
            <Undo2 :size="14" /></button
          ><button aria-label="Download Markdown" title="Download Markdown" @click="download">
            <Download :size="14" /></button
          ><span class="editor-mode">Markdown</span>
        </div>
        <div ref="mount" class="editor-mount" />
        <div class="document-end"><span /> END OF DRAFT <span /></div>
      </section>
      <aside class="assistant-pane" aria-label="Writing assistant">
        <div class="aside-heading">
          <span class="eyebrow">A SECOND PAIR OF EYES</span
          ><Feather :size="16" :stroke-width="1.3" />
        </div>
        <h1>A little help.<br />Still your voice.</h1>
        <p class="aside-intro">Select a passage. Ask for a change.<br />Decide what stays.</p>
        <div class="agent-choice">
          <label for="agent">Writing partner</label
          ><select id="agent" v-model="mode" :disabled="busy">
            <option value="demo">Guided demo · no AI</option>
            <option value="codex">My computer · Codex</option>
            <option v-if="cloudAvailable" value="hosted">Online writing partner</option></select
          ><span class="agent-note"
            ><span :class="['status-dot', { offline: !client || mode === 'demo' }]" />
            {{
              mode === 'hosted'
                ? 'Selected text is sent to our AI provider'
                : mode === 'demo'
                  ? 'Scripted example, runs in this page'
                  : client
                    ? 'Runs through your local companion'
                    : 'Connect your companion to begin'
            }}</span
          >
        </div>
        <div v-if="mode === 'demo'" class="demo-note">
          <span class="eyebrow">TRY THE INTERACTION</span>
          <p>
            See how an inline suggestion feels. We’ll use the sample paragraph under “Make something
            clearer”.
          </p>
          <button class="primary-button" @click="previewDemo">
            Preview an inline edit <ArrowUpRight :size="16" />
          </button>
        </div>
        <form v-else class="rewrite-form" @submit.prevent="rewrite">
          <label for="instruction">What would you change?</label
          ><textarea
            id="instruction"
            v-model="instruction"
            rows="4"
            placeholder="Make this clearer and more concise."
            :disabled="busy"
          />
          <div class="selection-count">
            {{
              selected.length
                ? `${selected.length} characters selected`
                : 'Select text in the editor first'
            }}
          </div>
          <button v-if="busy" type="button" class="primary-button" @click="cancelRewrite">
            Cancel rewrite <X :size="15" /></button
          ><button v-else type="submit" class="primary-button">
            {{ client || mode === 'hosted' ? 'Suggest an edit' : 'Connect your computer' }}
            <ArrowUp :size="16" />
          </button>
          <p class="shortcut-hint">⌘ / Ctrl + Enter to suggest</p>
        </form>
        <div v-if="error" class="error-message" role="alert">{{ error }}</div>
        <p v-if="!cloudAvailable" class="privacy-note">
          Online AI is coming soon. Writing, opening files, and the guided demo work now without an
          account.
        </p>
        <div class="how-it-works">
          <span class="eyebrow">THE IDEA IS SIMPLE</span>
          <div>
            <span class="step-number">01</span>
            <p>The page lives on the web.</p>
          </div>
          <div>
            <span class="step-number">02</span>
            <p>Your file lives on your computer.</p>
          </div>
          <div>
            <span class="step-number">03</span>
            <p>Your local agent suggests.<br />You make the final edit.</p>
          </div>
        </div>
        <p class="privacy-note">
          {{
            mode === 'hosted'
              ? 'Only the selected text and your instruction are sent to our hosted AI provider. The rest of your draft stays in your browser.'
              : 'Only selected text and your instruction go to Codex. Your local login stays on your computer. Codex sends that text to its model provider.'
          }}
        </p>
      </aside>
    </main>
    <footer class="statusbar">
      <span class="status-copy" role="status" aria-live="polite"
        ><Circle v-if="busy" class="working" :size="10" /><Check v-else :size="12" />
        {{ status }}</span
      ><span class="word-count"
        >{{ words }} words <span>·</span> {{ Math.max(1, Math.ceil(words / 200)) }} min read</span
      >
    </footer>
  </div>
  <DialogRoot v-model:open="dialog"
    ><DialogPortal
      ><DialogOverlay class="dialog-overlay" /><DialogContent class="dialog-content"
        ><DialogTitle class="dialog-title">Connect your computer.</DialogTitle
        ><DialogDescription class="dialog-description"
          >Set up once. After that, Foolscap remembers this browser. No commands or pairing
          codes.</DialogDescription
        ><DialogClose class="dialog-close" aria-label="Close connection dialog"
          ><X :size="18"
        /></DialogClose>
        <ol class="setup-steps">
          <li>
            <strong>Open Foolscap Connect.</strong>
            <p>The small companion keeps your files and agent on your computer.</p>
            <a class="primary-button" href="foolscap-connect://open"
              >Open Foolscap Connect <ArrowUpRight :size="16"
            /></a>
          </li>
          <li>
            <strong>Choose your writing folder.</strong>
            <p>Sign in to Codex in the companion if you haven’t already.</p>
          </li>
          <li>
            <strong>Approve this browser.</strong>
            <p>Click below, then choose Allow connection in the companion.</p>
          </li>
        </ol>
        <p v-if="connectionError" class="error-message" role="alert">{{ connectionError }}</p>
        <button class="primary-button" :disabled="pairing" @click="connect(true)">
          {{ pairing ? 'Waiting for your companion…' : 'Connect this browser' }} <Plug :size="16" />
        </button>
        <details class="download-details">
          <summary>Don’t have the companion yet?</summary>
          <p>
            An Apple Silicon Mac preview is available for testing. It is not yet Apple-signed or
            notarized, so it is not the finished one-click installer.
          </p>
          <a
            href="https://github.com/alexanderop/foolscap-web-poc/releases/tag/v0.2.0"
            target="_blank"
            rel="noreferrer"
            >View Mac preview downloads ↗</a
          >
          <p>You can keep writing and open files without installing anything.</p>
        </details>
      </DialogContent></DialogPortal
    ></DialogRoot
  >
  <DialogRoot v-model:open="filesOpen"
    ><DialogPortal
      ><DialogOverlay class="dialog-overlay" /><DialogContent class="dialog-content"
        ><DialogTitle class="dialog-title">Your writing folder</DialogTitle
        ><DialogDescription class="dialog-description"
          >Choose a document. Only files in the folder you approved are shown.</DialogDescription
        ><DialogClose class="dialog-close" aria-label="Close file picker"
          ><X :size="18"
        /></DialogClose>
        <div class="file-list">
          <button
            v-for="entry in availableFiles"
            :key="entry.id"
            @click="openConnectedFile(entry.id)"
          >
            <FileText :size="16" />{{ entry.name }}
          </button>
          <p v-if="!availableFiles.length">
            No Markdown or text files found. Choose a different folder in Foolscap Connect.
          </p>
        </div></DialogContent
      ></DialogPortal
    ></DialogRoot
  >
</template>
