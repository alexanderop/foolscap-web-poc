import { StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
export type InlineProposal = {
  from: number
  to: number
  replacement: string
  reason: string
  accept: () => void
  reject: () => void
}
export const setProposal = StateEffect.define<InlineProposal | null>()
class ReviewWidget extends WidgetType {
  constructor(readonly proposal: InlineProposal) {
    super()
  }
  toDOM() {
    const panel = document.createElement('section')
    panel.className = 'inline-review'
    panel.setAttribute('aria-label', 'Suggested edit')
    const label = document.createElement('div')
    label.className = 'review-label'
    label.textContent = 'SUGGESTED REPLACEMENT'
    const text = document.createElement('div')
    text.className = 'review-text'
    text.textContent = this.proposal.replacement
    const reason = document.createElement('p')
    reason.className = 'review-reason'
    reason.textContent = this.proposal.reason
    const actions = document.createElement('div')
    actions.className = 'review-actions'
    for (const [title, handler, className] of [
      ['Accept edit', this.proposal.accept, 'accept-edit'],
      ['Reject', this.proposal.reject, 'reject-edit'],
    ] as const) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = title
      button.className = className
      button.addEventListener('click', handler)
      actions.append(button)
    }
    panel.append(label, text, reason, actions)
    return panel
  }
  ignoreEvent() {
    return true
  }
}
export const inlineReview = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    if (transaction.docChanged) decorations = Decoration.none
    for (const effect of transaction.effects)
      if (effect.is(setProposal)) {
        const proposal = effect.value
        decorations = proposal
          ? Decoration.set(
              [
                Decoration.mark({ class: 'proposed-original' }).range(proposal.from, proposal.to),
                Decoration.widget({
                  widget: new ReviewWidget(proposal),
                  block: true,
                  side: 1,
                }).range(transaction.state.doc.lineAt(proposal.to).to),
              ],
              true,
            )
          : Decoration.none
      }
    return decorations
  },
  provide: (field) => EditorView.decorations.from(field),
})
