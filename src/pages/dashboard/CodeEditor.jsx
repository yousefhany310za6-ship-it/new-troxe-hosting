import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Compartment, EditorState } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search';
import { tags as t } from '@lezer/highlight';

// ---- language detection (each pack is its own lazy chunk) ------------------------

const legacy = (loader, name) => () => loader().then((m) => StreamLanguage.define(m[name]));

const LANGS = {
  javascript: { label: 'JavaScript', load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })) },
  typescript: { label: 'TypeScript', load: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true, typescript: true })) },
  json: { label: 'JSON', load: () => import('@codemirror/lang-json').then((m) => m.json()) },
  python: { label: 'Python', load: () => import('@codemirror/lang-python').then((m) => m.python()) },
  php: { label: 'PHP', load: () => import('@codemirror/lang-php').then((m) => m.php()) },
  html: { label: 'HTML', load: () => import('@codemirror/lang-html').then((m) => m.html()) },
  css: { label: 'CSS', load: () => import('@codemirror/lang-css').then((m) => m.css()) },
  markdown: { label: 'Markdown', load: () => import('@codemirror/lang-markdown').then((m) => m.markdown()) },
  yaml: { label: 'YAML', load: () => import('@codemirror/lang-yaml').then((m) => m.yaml()) },
  xml: { label: 'XML', load: () => import('@codemirror/lang-xml').then((m) => m.xml()) },
  sql: { label: 'SQL', load: () => import('@codemirror/lang-sql').then((m) => m.sql()) },
  java: { label: 'Java', load: () => import('@codemirror/lang-java').then((m) => m.java()) },
  cpp: { label: 'C / C++', load: () => import('@codemirror/lang-cpp').then((m) => m.cpp()) },
  rust: { label: 'Rust', load: () => import('@codemirror/lang-rust').then((m) => m.rust()) },
  go: { label: 'Go', load: () => import('@codemirror/lang-go').then((m) => m.go()) },
  shell: { label: 'Shell', load: legacy(() => import('@codemirror/legacy-modes/mode/shell'), 'shell') },
  dockerfile: { label: 'Dockerfile', load: legacy(() => import('@codemirror/legacy-modes/mode/dockerfile'), 'dockerFile') },
  toml: { label: 'TOML', load: legacy(() => import('@codemirror/legacy-modes/mode/toml'), 'toml') },
  properties: { label: 'Config', load: legacy(() => import('@codemirror/legacy-modes/mode/properties'), 'properties') },
};

const EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  json: 'json', jsonc: 'json', webmanifest: 'json',
  py: 'python', pyw: 'python',
  php: 'php', phtml: 'php',
  html: 'html', htm: 'html', vue: 'html',
  css: 'css', scss: 'css', less: 'css',
  md: 'markdown', markdown: 'markdown',
  yml: 'yaml', yaml: 'yaml',
  xml: 'xml', svg: 'xml',
  sql: 'sql',
  java: 'java',
  c: 'cpp', h: 'cpp', cc: 'cpp', cpp: 'cpp', hpp: 'cpp',
  rs: 'rust',
  go: 'go',
  sh: 'shell', bash: 'shell', zsh: 'shell', env: 'shell',
  toml: 'toml',
  ini: 'properties', cfg: 'properties', conf: 'properties', properties: 'properties',
};

/** { id, label, load } for a file name, or null (plain text). */
export function languageFor(filename) {
  const base = String(filename || '').split('/').pop().toLowerCase();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return { id: 'dockerfile', ...LANGS.dockerfile };
  if (base === '.env' || base.startsWith('.env.')) return { id: 'shell', ...LANGS.shell };
  if (base === 'makefile') return { id: 'shell', ...LANGS.shell };
  const ext = base.includes('.') ? base.split('.').pop() : '';
  const id = EXT[ext];
  return id ? { id, ...LANGS[id] } : null;
}

// ---- theme ----------------------------------------------------------------------

const FONT = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Noto Sans Arabic', monospace";
const BG = '#0a0a0d';

const highlightStyle = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword], color: '#ff7b72' },
  { tag: [t.string, t.special(t.string), t.character], color: '#a5d6ff' },
  { tag: [t.regexp, t.escape], color: '#7ee787' },
  { tag: [t.number, t.bool, t.null, t.atom, t.constant(t.name)], color: '#79c0ff' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: '#8b949e', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: '#d2a8ff' },
  { tag: [t.definition(t.variableName), t.definition(t.propertyName), t.local(t.variableName)], color: '#ffa657' },
  { tag: [t.className, t.typeName, t.namespace, t.macroName], color: '#ffa657' },
  { tag: [t.propertyName, t.attributeName], color: '#79c0ff' },
  { tag: [t.variableName, t.name], color: '#e6edf3' },
  { tag: [t.operator, t.derefOperator, t.compareOperator, t.logicOperator, t.arithmeticOperator], color: '#ff7b72' },
  { tag: [t.punctuation, t.separator, t.bracket, t.angleBracket, t.squareBracket, t.paren, t.brace], color: '#c9d1d9' },
  { tag: t.tagName, color: '#7ee787' },
  { tag: t.heading, color: '#79c0ff', fontWeight: '700' },
  { tag: [t.strong], fontWeight: '700' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.link, t.url], color: '#58a6ff', textDecoration: 'underline' },
  { tag: [t.meta, t.processingInstruction, t.documentMeta], color: '#8b949e' },
  { tag: t.invalid, color: '#f85149' },
]);

function makeTheme(fontSize) {
  return EditorView.theme(
    {
      '&': { height: '100%', backgroundColor: BG, color: '#e6edf3', fontSize: `${fontSize}px` },
      '&.cm-focused': { outline: 'none' },
      '.cm-scroller': { fontFamily: FONT, lineHeight: '1.65', overflow: 'auto' },
      '.cm-content': { caretColor: '#ffffff', padding: '12px 0 40px' },
      '.cm-line': { padding: '0 16px 0 8px' },
      '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#ffffff', borderLeftWidth: '2px' },
      '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
        backgroundColor: 'rgba(56,139,253,0.35)',
      },
      '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
      '.cm-gutters': { backgroundColor: BG, color: '#484f58', border: 'none', borderRight: '1px solid #1c1c1c' },
      '.cm-gutterElement': { padding: '0 10px 0 14px' },
      '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.04)', color: '#c9d1d9' },
      '.cm-foldGutter .cm-gutterElement': { cursor: 'pointer', padding: '0 4px', color: '#6e7681' },
      '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'rgba(110,118,129,0.35)', outline: '1px solid rgba(255,255,255,0.25)' },
      '.cm-selectionMatch': { backgroundColor: 'rgba(210,153,34,0.25)' },
      '.cm-foldPlaceholder': { backgroundColor: '#1c1c1c', border: '1px solid #303030', color: '#a1a1aa', padding: '0 6px', borderRadius: '4px' },
      // search panel
      '.cm-panels': { backgroundColor: '#111116', color: '#e6edf3', borderColor: '#1c1c1c' },
      '.cm-panels.cm-panels-top': { borderBottom: '1px solid #1c1c1c' },
      '.cm-panel.cm-search': { padding: '8px 10px', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '12.5px' },
      '.cm-panel.cm-search input, .cm-panel.cm-search .cm-textfield': {
        backgroundColor: '#0a0a0d', color: '#e6edf3', border: '1px solid #303030', borderRadius: '8px', padding: '4px 8px', outline: 'none',
      },
      '.cm-panel.cm-search input:focus': { borderColor: '#71717a' },
      '.cm-panel.cm-search .cm-button': {
        backgroundImage: 'none', backgroundColor: '#1c1c1c', color: '#e6edf3', border: '1px solid #303030', borderRadius: '8px', padding: '3px 10px', cursor: 'pointer',
      },
      '.cm-panel.cm-search .cm-button:hover': { backgroundColor: '#303030' },
      '.cm-panel.cm-search label': { color: '#a1a1aa' },
      '.cm-panel.cm-search [name=close]': { color: '#a1a1aa', cursor: 'pointer', background: 'none', border: 'none', fontSize: '16px' },
      '.cm-searchMatch': { backgroundColor: 'rgba(210,153,34,0.3)', outline: '1px solid rgba(210,153,34,0.5)' },
      '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(56,139,253,0.4)' },
    },
    { dark: true },
  );
}

const utf8Bytes = (s) => new TextEncoder().encode(s).length;

/**
 * Code editor with syntax highlighting (CodeMirror 6). Mount once per file
 * (parent passes `key`): `doc` is only the INITIAL content, edits are reported
 * through `onChange(text)`.
 */
const CodeEditor = forwardRef(function CodeEditor({ doc, filename, onChange, onSave, wrap = false, fontSize }, ref) {
  const host = useRef(null);
  const viewRef = useRef(null);
  const wrapComp = useRef(new Compartment()).current;
  const langComp = useRef(new Compartment()).current;
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  onChangeRef.current = onChange;
  onSaveRef.current = onSave;

  const lang = useMemo(() => languageFor(filename), [filename]);
  const [info, setInfo] = useState({ line: 1, col: 1, lines: (doc ?? '').split('\n').length, sel: 0, bytes: utf8Bytes(doc ?? '') });
  const [langReady, setLangReady] = useState(!lang);

  useEffect(() => {
    const size = fontSize ?? (typeof window !== 'undefined' && window.innerWidth < 640 ? 16 : 13.5);
    const state = EditorState.create({
      doc: doc ?? '',
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        indentUnit.of('  '),
        syntaxHighlighting(highlightStyle),
        bracketMatching(),
        closeBrackets(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({ top: true }),
        // Arabic / RTL strings and comments align per line instead of per document
        EditorView.perLineTextDirection.of(true),
        EditorView.contentAttributes.of({ spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
        keymap.of([
          { key: 'Mod-s', preventDefault: true, run: () => { onSaveRef.current?.(); return true; } },
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          indentWithTab,
        ]),
        makeTheme(size),
        wrapComp.of(wrap ? EditorView.lineWrapping : []),
        langComp.of([]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current?.(u.state.doc.toString());
          if (u.docChanged || u.selectionSet) {
            const sel = u.state.selection.main;
            const line = u.state.doc.lineAt(sel.head);
            setInfo({
              line: line.number,
              col: sel.head - line.from + 1,
              lines: u.state.doc.lines,
              sel: Math.abs(sel.to - sel.from),
              bytes: u.docChanged ? utf8Bytes(u.state.doc.toString()) : undefined,
            });
          }
        }),
      ],
    });
    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // the document is the initial value only: the parent remounts per file
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: wrapComp.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap, wrapComp]);

  useEffect(() => {
    let alive = true;
    if (!lang) {
      setLangReady(true);
      return undefined;
    }
    setLangReady(false);
    lang
      .load()
      .then((ext) => {
        if (!alive || !viewRef.current) return;
        viewRef.current.dispatch({ effects: langComp.reconfigure(ext) });
      })
      .catch(() => undefined)
      .finally(() => alive && setLangReady(true));
    return () => {
      alive = false;
    };
  }, [lang, langComp]);

  useImperativeHandle(ref, () => ({
    openSearch: () => {
      const v = viewRef.current;
      if (v) {
        v.focus();
        openSearchPanel(v);
      }
    },
    focus: () => viewRef.current?.focus(),
  }));

  // bytes are only recomputed on edits: keep the last value across selection moves
  const bytesRef = useRef(info.bytes);
  if (info.bytes !== undefined) bytesRef.current = info.bytes;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={host} className="min-h-0 flex-1 overflow-hidden" />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline bg-card px-4 py-1.5 font-mono text-[0.7rem] text-ink-muted">
        <span className="tabular-nums">
          Ln {info.line}, Col {info.col}
          {info.sel > 0 ? ` (${info.sel} selected)` : ''}
        </span>
        <span className="tabular-nums">{info.lines.toLocaleString()} lines</span>
        <span className="tabular-nums">{(bytesRef.current ?? 0).toLocaleString()} bytes</span>
        <span className="ml-auto flex items-center gap-4">
          <span className="hidden sm:inline">Spaces: 2</span>
          <span className="hidden sm:inline">UTF-8</span>
          <span className={lang ? 'font-semibold text-ink-secondary' : ''}>
            {lang ? lang.label : 'Plain text'}
            {lang && !langReady ? '…' : ''}
          </span>
        </span>
      </div>
    </div>
  );
});

export default CodeEditor;
