<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { EditorState, Transaction } from '@codemirror/state'
import { EditorView, keymap, drawSelection } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, undo } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { syntaxHighlighting, HighlightStyle } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { Feather, ArrowUp, Circle, FileText, Plug, Download, Undo2, X, Check, ArrowUpRight } from '@lucide/vue'
import { DialogRoot, DialogPortal, DialogOverlay, DialogContent, DialogTitle, DialogDescription, DialogClose } from 'reka-ui'
import { createClient, type CompanionClient } from './client'
import { inlineReview, setProposal } from './inlineReview'
import { sample, demoOriginal, demoReplacement } from './sample'
import type { DocumentSnapshot, Proposal } from '../shared/protocol'

const mount = ref<HTMLDivElement>()
const editor = shallowRef<EditorView>()
const content = ref(sample)
const selected = ref('')
const instruction = ref('Make this clearer and more concise.')
const mode = ref<'demo' | 'codex'>('demo')
const dialog = ref(false)
const token = ref('')
const endpoint = ref('http://127.0.0.1:43123')
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
const dirty = computed(() => file.value ? content.value !== file.value.text : content.value !== sample)
const localCommand = computed(() => `pnpm companion --file /absolute/path/to/draft.md --origin ${window.location.origin}`)
let version = 0
let controller: AbortController | undefined
let activeId: string | undefined
let activeClient: CompanionClient | undefined

function cancel() {
  controller?.abort(); controller = undefined
  if (activeId && activeClient) void activeClient.cancel(activeId).catch(() => {})
  activeId = undefined; activeClient = undefined; busy.value = false
}
function discardReview() { editor.value?.dispatch({ effects: setProposal.of(null) }); review.value = false }
function showProposal(proposal: Proposal, from: number, to: number, original: string, expectedVersion: number) {
  const view = editor.value
  if (!view || version !== expectedVersion || view.state.sliceDoc(from, to) !== original) { status.value = 'Your text changed. Select it again for a fresh suggestion.'; return }
  review.value = true
  view.dispatch({ effects: setProposal.of({ from, to, ...proposal,
    accept: () => {
      if (version !== expectedVersion || view.state.sliceDoc(from, to) !== original) { discardReview(); return }
      view.dispatch({ changes: { from, to, insert: proposal.replacement }, selection: { anchor: from, head: from + proposal.replacement.length }, effects: setProposal.of(null), annotations: Transaction.userEvent.of('input.rewrite'), scrollIntoView: true })
      review.value = false; status.value = 'Edit accepted. Undo restores your original words.'; view.focus()
    },
    reject: () => { discardReview(); status.value = 'Suggestion dismissed. Your words are unchanged.'; view.focus() },
  }), selection: { anchor: from }, scrollIntoView: true })
  status.value = 'Review the suggestion in your document.'
}
function previewDemo() {
  const view = editor.value; if (!view) return
  const from = view.state.doc.toString().indexOf(demoOriginal)
  if (from < 0) { error.value = 'The sample paragraph has changed. Undo your changes or reload to try the guided demo again.'; return }
  error.value = ''; mode.value = 'demo'
  showProposal({ replacement: demoReplacement, reason: 'A scripted example: removes filler and puts the action first. No agent was called.' }, from, from + demoOriginal.length, demoOriginal, version)
}
async function rewrite() {
  const view = editor.value; if (!view || busy.value) return
  error.value = ''
  if (mode.value === 'demo') { previewDemo(); return }
  if (!client.value) { dialog.value = true; return }
  const { from, to } = view.state.selection.main
  const text = view.state.sliceDoc(from, to)
  if (!text.trim()) { error.value = 'Select the words you want to rewrite first.'; return }
  if (!instruction.value.trim()) { error.value = 'Tell the agent how to change the selection.'; return }
  discardReview(); const expectedVersion = version
  const ownController = new AbortController(); controller = ownController
  const id = crypto.randomUUID(); activeId = id; activeClient = client.value
  busy.value = true; status.value = 'Your local Codex is working on the selection…'
  try {
    const proposal = await client.value.rewrite({ id, text, instruction: instruction.value }, ownController.signal)
    if (!ownController.signal.aborted) showProposal(proposal, from, to, text, expectedVersion)
  } catch (cause) {
    if (!ownController.signal.aborted) error.value = cause instanceof Error ? cause.message : 'Rewrite failed.'
  } finally {
    if (controller === ownController) { controller = undefined; activeId = undefined; activeClient = undefined; busy.value = false }
  }
}
async function connect() {
  pairing.value = true; connectionError.value = ''
  try {
    const next = createClient(endpoint.value, token.value.trim())
    await next.health(); client.value = next; mode.value = 'codex'; token.value = ''; dialog.value = false
    status.value = 'Companion connected. Open its local file when you are ready.'
  } catch (cause) { connectionError.value = cause instanceof Error ? cause.message : 'Could not connect.' }
  finally { pairing.value = false }
}
async function openFile() {
  if (!client.value) { dialog.value = true; return }
  if (dirty.value && !window.confirm('Replace the current draft with the local file? Download your draft first if you want to keep it.')) return
  const view = editor.value; if (!view) return
  error.value = ''
  const startingVersion = version; const currentClient = client.value
  try {
    const snapshot = await currentClient.read()
    if (version !== startingVersion || client.value !== currentClient) throw new Error('Your draft changed while opening. Try again when ready.')
    cancel(); discardReview(); file.value = snapshot
    view.setState(makeState(snapshot.text)); content.value = snapshot.text; selected.value = ''; version++
    status.value = 'Opened from your computer. Changes save only when you choose Save file.'
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not open file.' }
}
async function saveFile() {
  if (!client.value || !file.value || saving.value) return
  saving.value = true; error.value = ''
  const text = content.value
  try { file.value = await client.value.save(text, file.value.revision); status.value = content.value === text ? 'Saved to the file on your computer.' : 'Saved. Your newer edits are still unsaved.' }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not save.' }
  finally { saving.value = false }
}
function disconnect() { cancel(); client.value = undefined; file.value = undefined; mode.value = 'demo'; discardReview(); status.value = 'Disconnected. Your draft remains in the editor.' }
function download() {
  const url = URL.createObjectURL(new Blob([content.value], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = file.value?.name ?? 'a-little-room-to-think.md'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
  status.value = 'Draft downloaded as Markdown.'
}
function makeState(doc: string) {
  return EditorState.create({ doc, extensions: [history(), drawSelection(), markdown(), syntaxHighlighting(HighlightStyle.define([
    { tag: tags.heading1, class: 'md-h1' }, { tag: tags.heading2, class: 'md-h2' }, { tag: tags.processingInstruction, color: '#9b9b90' }, { tag: tags.strong, fontWeight: '600' }, { tag: tags.emphasis, fontStyle: 'italic' },
  ])), EditorView.lineWrapping, inlineReview, keymap.of([
    { key: 'Mod-Enter', run: () => { void rewrite(); return true } },
    { key: 'Mod-s', run: () => { void saveFile(); return true } },
    ...defaultKeymap, ...historyKeymap,
  ]), EditorView.contentAttributes.of({ 'aria-label': 'Markdown editor', spellcheck: 'true' }), EditorView.updateListener.of(update => {
    if (update.docChanged) {
      version++; content.value = update.state.doc.toString()
      if (busy.value) { cancel(); status.value = 'Rewrite cancelled because your draft changed.' }
      if (review.value) { review.value = false; status.value = 'Suggestion cleared because your draft changed.' }
    }
    const range = update.state.selection.main; selected.value = update.state.sliceDoc(range.from, range.to)
  })] })
}
const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.value) { event.preventDefault(); event.returnValue = '' } }
onMounted(() => { editor.value = new EditorView({ state: makeState(sample), parent: mount.value }); window.addEventListener('beforeunload', beforeUnload) })
onBeforeUnmount(() => { cancel(); editor.value?.destroy(); window.removeEventListener('beforeunload', beforeUnload) })
</script>

<template>
  <div class="writing-room">
    <header class="topbar">
      <a class="brand" href="/" aria-label="Foolscap home"><Feather :size="21" :stroke-width="1.4" /><span>foolscap<span class="brand-dot">.</span></span><span class="edition">web experiment</span></a>
      <div class="header-actions">
        <a class="source-link" href="https://github.com/alexanderop/foolscap-web-poc" target="_blank" rel="noreferrer">Source <ArrowUpRight :size="13" /></a>
        <button v-if="client" class="connection connected" :disabled="saving" @click="disconnect"><span class="status-dot" /> Local agent connected <X :size="13" /></button>
        <button v-else class="connection" @click="dialog = true"><Plug :size="14" /> Connect local agent</button>
      </div>
    </header>
    <main class="workspace">
      <section class="document-pane" aria-label="Writing workspace">
        <div class="document-bar"><span><FileText :size="14" /> {{ file?.name ?? 'a-little-room-to-think.md' }} <span v-if="dirty" class="unsaved-dot" aria-label="Unsaved changes" /></span><span class="document-kind">{{ file ? 'LOCAL FILE' : 'SCRATCH DRAFT' }}</span></div>
        <div class="editor-actions"><button :disabled="saving || busy" @click="openFile">Open local file</button><button :disabled="!file || saving" @click="saveFile">{{ saving ? 'Saving…' : 'Save file' }}</button><span class="action-divider" /><button aria-label="Undo edit" title="Undo (⌘Z / Ctrl+Z)" @click="editor && undo(editor)"><Undo2 :size="14" /></button><button aria-label="Download Markdown" title="Download Markdown" @click="download"><Download :size="14" /></button><span class="editor-mode">Markdown</span></div>
        <div ref="mount" class="editor-mount" />
        <div class="document-end"><span /> END OF DRAFT <span /></div>
      </section>
      <aside class="assistant-pane" aria-label="Writing assistant">
        <div class="aside-heading"><span class="eyebrow">A SECOND PAIR OF EYES</span><Feather :size="16" :stroke-width="1.3" /></div>
        <h1>A little help.<br />Still your voice.</h1>
        <p class="aside-intro">Select a passage. Ask for a change.<br />Decide what stays.</p>
        <div class="agent-choice"><label for="agent">Writing partner</label><select id="agent" v-model="mode" :disabled="busy"><option value="demo">Guided demo · no AI</option><option value="codex">Local Codex</option></select><span class="agent-note"><span :class="['status-dot', { offline: !client || mode === 'demo' }]" /> {{ mode === 'demo' ? 'Scripted example, runs in this page' : client ? 'Runs through your local companion' : 'Connect your companion to begin' }}</span></div>
        <div v-if="mode === 'demo'" class="demo-note"><span class="eyebrow">TRY THE INTERACTION</span><p>See how an inline suggestion feels. We’ll use the sample paragraph under “Make something clearer”.</p><button class="primary-button" @click="previewDemo">Preview an inline edit <ArrowUpRight :size="16" /></button></div>
        <form v-else class="rewrite-form" @submit.prevent="rewrite"><label for="instruction">What would you change?</label><textarea id="instruction" v-model="instruction" rows="4" placeholder="Make this clearer and more concise." :disabled="busy" /><div class="selection-count">{{ selected.length ? `${selected.length} characters selected` : 'Select text in the editor first' }}</div><button v-if="busy" type="button" class="primary-button" @click="cancel(); status = 'Rewrite cancelled.'">Cancel rewrite <X :size="15" /></button><button v-else type="submit" class="primary-button">{{ client ? 'Suggest an edit' : 'Connect local agent' }} <ArrowUp :size="16" /></button><p class="shortcut-hint">⌘ / Ctrl + Enter to suggest</p></form>
        <div v-if="error" class="error-message" role="alert">{{ error }}</div>
        <div class="how-it-works"><span class="eyebrow">THE IDEA IS SIMPLE</span><div><span class="step-number">01</span><p>The page lives on the web.</p></div><div><span class="step-number">02</span><p>Your file lives on your computer.</p></div><div><span class="step-number">03</span><p>Your local agent suggests.<br />You make the final edit.</p></div></div>
        <p class="privacy-note">Only selected text and your instruction go to Codex. Your local login stays on your computer. Codex sends that text to its model provider.</p>
      </aside>
    </main>
    <footer class="statusbar"><span class="status-copy" role="status" aria-live="polite"><Circle v-if="busy" class="working" :size="10" /><Check v-else :size="12" /> {{ status }}</span><span class="word-count">{{ words }} words <span>·</span> {{ Math.max(1, Math.ceil(words / 200)) }} min read</span></footer>
  </div>
  <DialogRoot v-model:open="dialog"><DialogPortal><DialogOverlay class="dialog-overlay" /><DialogContent class="dialog-content"><DialogTitle class="dialog-title">Bring your local agent.</DialogTitle><DialogDescription class="dialog-description">Run the companion on your computer, then paste its pairing token. Your browser may ask for local network access.</DialogDescription><DialogClose class="dialog-close" aria-label="Close connection dialog"><X :size="18" /></DialogClose><ol class="setup-steps"><li>Clone the <a href="https://github.com/alexanderop/foolscap-web-poc" target="_blank" rel="noreferrer">GitHub repo</a> and run <code>pnpm install</code>.</li><li>Install Codex and sign in with <code>codex login</code>.</li><li>Choose a Markdown file and start the companion:<pre>{{ localCommand }}</pre></li></ol><form class="connection-form" @submit.prevent="connect"><label for="endpoint">Companion address</label><input id="endpoint" v-model="endpoint" type="url" required /><label for="token">Pairing token</label><input id="token" v-model="token" type="password" placeholder="Paste the token from your terminal" autocomplete="off" required /><p class="dialog-description">The token stays in this tab’s memory. Reloading disconnects it.</p><p v-if="connectionError" class="error-message" role="alert">{{ connectionError }}</p><button class="primary-button" :disabled="pairing">{{ pairing ? 'Connecting…' : 'Connect companion' }} <Plug :size="16" /></button></form></DialogContent></DialogPortal></DialogRoot>
</template>
