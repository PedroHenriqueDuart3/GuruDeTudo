import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import {
  bracketMatching,
  foldAll,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
  unfoldAll,
} from '@codemirror/language'
import { highlightSelectionMatches, openSearchPanel, searchKeymap } from '@codemirror/search'
import { lintGutter, setDiagnostics } from '@codemirror/lint'
import { editorTheme, highlightStyle } from './theme'

/** Acima disto o realce sintático é desligado para manter a digitação fluida. */
export const LARGE_DOC_CHARS = 6_000_000

/**
 * Editor de código baseado em CodeMirror 6.
 * O CodeMirror só desenha as linhas visíveis (viewport), então suporta documentos grandes.
 *
 * Props: value, onChange(text), language (extensão do CodeMirror), readOnly, fontSize,
 *        wrap, indent, diagnostics [{ line, col, message, severity }], ariaLabel
 * Ref: getValue(), setValue(text), goToLine(line, col), focus(), openSearch(), foldAll(), unfoldAll()
 */
const CodeEditor = forwardRef(function CodeEditor(
  { value = '', onChange, language, readOnly = false, fontSize = 13, wrap = false, indent = 2, diagnostics, ariaLabel, changeDelay = 200 },
  ref,
) {
  const hostRef = useRef(null)
  const viewRef = useRef(null)
  const onChangeRef = useRef(onChange)
  const timerRef = useRef(null)
  const lastEmitted = useRef(value)
  const compartments = useRef({
    lang: new Compartment(),
    readOnly: new Compartment(),
    wrap: new Compartment(),
    font: new Compartment(),
    indent: new Compartment(),
  })

  onChangeRef.current = onChange

  const langFor = (text) => (language && text.length < LARGE_DOC_CHARS ? language : [])

  // Criação única do editor
  useEffect(() => {
    const c = compartments.current
    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter({ markerDOM: foldMarker }),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        lintGutter(),
        syntaxHighlighting(highlightStyle),
        keymap.of([indentWithTab, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap]),
        editorTheme,
        c.lang.of(langFor(value)),
        c.readOnly.of(EditorState.readOnly.of(readOnly)),
        c.wrap.of(wrap ? EditorView.lineWrapping : []),
        c.font.of(EditorView.theme({ '&': { fontSize: `${fontSize}px` } })),
        c.indent.of(indentUnit.of(' '.repeat(indent))),
        EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? 'Editor de código' }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return
          clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => {
            const text = update.view.state.doc.toString()
            lastEmitted.current = text
            onChangeRef.current?.(text)
          }, changeDelay)
        }),
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    return () => {
      clearTimeout(timerRef.current)
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Valor externo (ex.: formatar, importar arquivo, carregar exemplo)
  useEffect(() => {
    const view = viewRef.current
    if (!view || value === lastEmitted.current) return
    if (value === view.state.doc.toString()) return
    clearTimeout(timerRef.current)
    lastEmitted.current = value
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: value },
      effects: compartments.current.lang.reconfigure(langFor(value)),
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.current.readOnly.reconfigure(EditorState.readOnly.of(readOnly)) })
  }, [readOnly])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.current.wrap.reconfigure(wrap ? EditorView.lineWrapping : []) })
  }, [wrap])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.font.reconfigure(EditorView.theme({ '&': { fontSize: `${fontSize}px` } })),
    })
  }, [fontSize])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: compartments.current.indent.reconfigure(indentUnit.of(' '.repeat(indent))) })
  }, [indent])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: compartments.current.lang.reconfigure(langFor(view.state.doc.toString())) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])

  // Diagnósticos (erros de sintaxe) vindos dos parsers de cada módulo
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const doc = view.state.doc
    const list = (diagnostics ?? [])
      .filter((d) => d.line >= 1 && d.line <= doc.lines)
      .map((d) => {
        const line = doc.line(d.line)
        const from = Math.min(line.to, line.from + Math.max(0, (d.col ?? 1) - 1))
        return { from, to: Math.min(line.to, from + (d.length ?? 1)) || from, message: d.message, severity: d.severity ?? 'error' }
      })
    view.dispatch(setDiagnostics(view.state, list))
  }, [diagnostics])

  useImperativeHandle(ref, () => ({
    getValue: () => viewRef.current?.state.doc.toString() ?? '',
    setValue(text) {
      const view = viewRef.current
      if (!view) return
      lastEmitted.current = text
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        effects: compartments.current.lang.reconfigure(langFor(text)),
      })
    },
    goToLine(lineNo, col = 1) {
      const view = viewRef.current
      if (!view) return
      const doc = view.state.doc
      const line = doc.line(Math.max(1, Math.min(doc.lines, lineNo)))
      const pos = Math.min(line.to, line.from + col - 1)
      view.dispatch({
        selection: EditorSelection.cursor(pos),
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
      })
      view.focus()
    },
    focus: () => viewRef.current?.focus(),
    openSearch: () => viewRef.current && openSearchPanel(viewRef.current),
    foldAll: () => viewRef.current && foldAll(viewRef.current),
    unfoldAll: () => viewRef.current && unfoldAll(viewRef.current),
    isLarge: () => (viewRef.current?.state.doc.length ?? 0) >= LARGE_DOC_CHARS,
  }))

  return <div ref={hostRef} className="code-editor" />
})

function foldMarker(open) {
  const el = document.createElement('span')
  el.className = `cm-fold-marker ${open ? 'is-open' : ''}`
  el.textContent = '›'
  el.title = open ? 'Recolher' : 'Expandir'
  return el
}

export default CodeEditor
