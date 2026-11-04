import { EditorView } from '@codemirror/view'
import { HighlightStyle } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/**
 * Tema do editor baseado em variáveis CSS — troca de claro/escuro sem recriar o editor.
 */
export const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'var(--text)',
    backgroundColor: 'var(--bg-elevated)',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono)',
    lineHeight: '1.6',
  },
  '.cm-content': {
    caretColor: 'var(--c-neon)',
    padding: '8px 0',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--c-neon)',
    borderLeftWidth: '2px',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'rgba(var(--c-neon-rgb), 0.22) !important',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--bg-elevated)',
    color: 'var(--text-subtle)',
    border: 'none',
    borderRight: '1px solid var(--border)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(var(--c-neon-rgb), 0.08)',
    color: 'var(--c-neon)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(var(--c-neon-rgb), 0.045)',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    padding: '0 10px 0 14px',
    minWidth: '44px',
  },
  '.cm-foldGutter .cm-gutterElement': {
    width: '16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  '.cm-fold-marker': {
    display: 'inline-block',
    cursor: 'pointer',
    color: 'var(--text-subtle)',
    transition: 'transform .15s ease, color .15s ease',
  },
  '.cm-fold-marker.is-open': {
    transform: 'rotate(90deg)',
  },
  '.cm-fold-marker:hover': {
    color: 'var(--c-neon)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'rgba(var(--c-violet-rgb), 0.15)',
    border: '1px solid rgba(var(--c-violet-rgb), 0.4)',
    color: 'var(--c-violet)',
    borderRadius: '4px',
    padding: '0 6px',
  },
  '.cm-matchingBracket': {
    backgroundColor: 'rgba(var(--c-cyan-rgb), 0.18)',
    outline: '1px solid rgba(var(--c-cyan-rgb), 0.6)',
    color: 'inherit !important',
  },
  '.cm-nonmatchingBracket': {
    backgroundColor: 'rgba(var(--c-error-rgb), 0.25)',
  },
  '.cm-selectionMatch': {
    backgroundColor: 'rgba(var(--c-violet-rgb), 0.18)',
  },
  '.cm-searchMatch': {
    backgroundColor: 'rgba(var(--c-warning-rgb), 0.25)',
    outline: '1px solid rgba(var(--c-warning-rgb), 0.6)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'rgba(var(--c-neon-rgb), 0.35)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--surface-2)',
    color: 'var(--text)',
    borderTop: '1px solid var(--border)',
  },
  '.cm-panels.cm-panels-bottom': {
    borderTop: '1px solid var(--border)',
  },
  '.cm-panel.cm-search': {
    padding: '8px 10px',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
  },
  '.cm-textfield': {
    backgroundColor: 'var(--bg-elevated)',
    border: '1px solid var(--border-strong)',
    borderRadius: '4px',
    color: 'var(--text)',
    padding: '3px 6px',
  },
  '.cm-button': {
    backgroundImage: 'none',
    backgroundColor: 'var(--surface-3)',
    border: '1px solid var(--border-strong)',
    borderRadius: '4px',
    color: 'var(--text)',
  },
  '.cm-tooltip': {
    backgroundColor: 'var(--surface-2)',
    border: '1px solid var(--border-strong)',
    borderRadius: '6px',
    color: 'var(--text)',
  },
  '.cm-diagnostic-error': {
    borderLeftColor: 'var(--c-error)',
  },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    textDecoration: 'underline wavy var(--c-error)',
    textUnderlineOffset: '3px',
  },
  '.cm-lint-marker-error': {
    content: 'none',
  },
})

export const highlightStyle = HighlightStyle.define([
  { tag: t.propertyName, color: 'var(--syn-key)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--syn-string)' },
  { tag: t.number, color: 'var(--syn-number)' },
  { tag: [t.bool], color: 'var(--syn-bool)' },
  { tag: t.null, color: 'var(--syn-null)' },
  { tag: [t.punctuation, t.separator, t.bracket, t.angleBracket], color: 'var(--syn-punct)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--syn-comment)', fontStyle: 'italic' },
  { tag: [t.tagName], color: 'var(--syn-tag)' },
  { tag: [t.attributeName], color: 'var(--syn-attr)' },
  { tag: [t.attributeValue], color: 'var(--syn-string)' },
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: 'var(--c-violet)', fontWeight: '600' },
  { tag: [t.typeName, t.standard(t.name)], color: 'var(--c-cyan)' },
  { tag: [t.operator], color: 'var(--syn-punct)' },
  { tag: [t.processingInstruction, t.documentMeta], color: 'var(--syn-comment)' },
  { tag: [t.invalid], color: 'var(--c-error)' },
])
