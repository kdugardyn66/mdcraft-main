/* mdcraft — the Markdown editor (CodeMirror 6) and the editing operations the ribbon uses. */
(function () {
  'use strict';
  const MD = window.MD;
  const CM = window.CM;
  const { EditorView, EditorState, EditorSelection, Compartment, Decoration, ViewPlugin } = CM;

  // ------------------------------------------------------------------ look
  const t = CM.tags;
  const highlight = CM.HighlightStyle.define([
    { tag: t.heading1, class: 'cm-h cm-h1' },
    { tag: t.heading2, class: 'cm-h cm-h2' },
    { tag: t.heading3, class: 'cm-h cm-h3' },
    { tag: [t.heading4, t.heading5, t.heading6], class: 'cm-h cm-h4' },
    { tag: t.strong, class: 'cm-strong' },
    { tag: t.emphasis, class: 'cm-em' },
    { tag: t.strikethrough, class: 'cm-strike' },
    { tag: [t.link, t.url], class: 'cm-link' },
    { tag: t.monospace, class: 'cm-mono' },
    { tag: t.quote, class: 'cm-quote' },
    { tag: [t.processingInstruction, t.contentSeparator, t.labelName], class: 'cm-mark' },
    { tag: t.list, class: 'cm-list' },
    { tag: [t.meta, t.documentMeta], class: 'cm-meta' },
    { tag: [t.comment, t.blockComment], class: 'cm-comment' },
    { tag: [t.keyword, t.modifier, t.operatorKeyword], class: 'cm-kw' },
    { tag: [t.string, t.special(t.string), t.regexp], class: 'cm-str' },
    { tag: [t.number, t.bool, t.null, t.atom], class: 'cm-num' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.className, t.typeName], class: 'cm-fn' },
    { tag: [t.propertyName, t.attributeName], class: 'cm-prop' },
    { tag: [t.tagName, t.angleBracket], class: 'cm-tag' },
    { tag: t.invalid, class: 'cm-invalid' },
  ]);

  // Slide markers and page breaks get a band in the editor (like a slide separator).
  const SLIDE_RE = /^\s*<!--\s*slide\b/;
  const BREAK_RE = /^\s*<!--\s*(pagebreak|page-break|page break|newpage)\s*-->\s*$/i;
  function bandDecorations(view) {
    const out = [];
    const doc = view.state.doc;
    const starts = slideStartsOf(doc);
    const markerSet = new Map();
    starts.forEach((st, i) => { if (st.marker) markerSet.set(st.line, i + 1); });
    let inFence = false;
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i);
      const txt = line.text;
      if (/^\s*(```|~~~)/.test(txt)) inFence = !inFence;
      if (inFence) continue;
      if (markerSet.has(i)) {
        const cls = (/class\s*=\s*"([^"]+)"/.exec(txt) || [])[1] || '';
        out.push(Decoration.line({ attributes: { class: 'cm-band cm-slide-band', 'data-label': 'Slide ' + markerSet.get(i) + (cls ? ' · ' + cls : '') } }).range(line.from));
      } else if (BREAK_RE.test(txt)) {
        out.push(Decoration.line({ attributes: { class: 'cm-band cm-break-band', 'data-label': 'Page break' } }).range(line.from));
      }
    }
    return Decoration.set(out);
  }
  /**
   * Where each slide starts, in the renderer's order: [{line (1-based), marker}]. The
   * content before the first marker is a slide only when it has something besides the
   * front matter (the renderer skips empty slides).
   */
  function slideStartsOf(doc) {
    const markers = [];
    let inFence = false;
    let fmEnd = 0;
    if (doc.lines > 1 && doc.line(1).text === '---') {
      for (let i = 2; i <= doc.lines; i++) { const t = doc.line(i).text; if (t === '---' || t === '...') { fmEnd = i; break; } }
    }
    let leading = false;
    for (let i = fmEnd + 1; i <= doc.lines; i++) {
      const tx = doc.line(i).text;
      if (/^\s*(```|~~~)/.test(tx)) inFence = !inFence;
      if (!inFence && SLIDE_RE.test(tx)) { markers.push(i); continue; }
      if (!markers.length && tx.trim() !== '') leading = true;
    }
    if (!markers.length) return [];
    const out = markers.map((line) => ({ line, marker: true }));
    if (leading) out.unshift({ line: fmEnd + 1, marker: false });
    return out;
  }
  const bands = ViewPlugin.fromClass(class {
    constructor(v) { this.decorations = bandDecorations(v); }
    update(u) { if (u.docChanged) this.decorations = bandDecorations(u.view); }
  }, { decorations: (v) => v.decorations });

  // YAML front matter (--- … --- at the very top) is one block, not a setext heading.
  const frontMatter = {
    defineNodes: [{ name: 'FrontMatter', block: true, style: CM.tags.meta }],
    parseBlock: [{
      name: 'FrontMatter',
      before: 'HorizontalRule',
      parse(cx, line) {
        if (cx.lineStart !== 0 || line.text !== '---') return false;
        // only when a closing --- follows (else it's a horizontal rule)
        const head = cx.input.read(0, Math.min(cx.input.length, 20000));
        if (!/^---\r?\n[\s\S]*?\r?\n(---|\.\.\.)[ \t]*(\r?\n|$)/.test(head)) return false;
        const start = cx.lineStart;
        while (cx.nextLine()) {
          if (line.text === '---' || line.text === '...') {
            const end = cx.lineStart + line.text.length;
            cx.nextLine();
            cx.addElement(cx.elt('FrontMatter', start, end));
            return true;
          }
        }
        cx.addElement(cx.elt('FrontMatter', start, cx.prevLineEnd()));
        return true;
      },
    }],
  };

  // ------------------------------------------------------------------ the view
  const comp = { history: new Compartment(), lines: new Compartment(), wrap: new Compartment(), spell: new Compartment(), font: new Compartment(), tab: new Compartment(), brackets: new Compartment() };
  let view = null;
  let suppress = 0;

  function create(parent, opts) {
    const o = Object.assign({ lineNumbers: false, wrap: true, spellcheck: true, closeBrackets: false }, opts || {});
    const state = EditorState.create({
      doc: '',
      extensions: [
        comp.history.of(CM.history()),
        CM.drawSelection(),
        CM.dropCursor(),
        CM.highlightActiveLine(),
        CM.highlightActiveLineGutter(),
        CM.highlightSpecialChars(),
        CM.rectangularSelection(),
        CM.crosshairCursor(),
        CM.highlightSelectionMatches(),
        CM.indentOnInput(),
        CM.bracketMatching(),
        EditorState.allowMultipleSelections.of(true),
        CM.search({ top: true }),
        CM.markdown({ base: CM.markdownLanguage, codeLanguages: CM.codeLanguages, extensions: [frontMatter] }),
        CM.syntaxHighlighting(highlight),
        CM.scrollPastEnd(),
        bands,
        comp.lines.of(o.lineNumbers ? CM.lineNumbers() : []),
        comp.wrap.of(o.wrap ? EditorView.lineWrapping : []),
        comp.spell.of(EditorView.contentAttributes.of({ spellcheck: o.spellcheck ? 'true' : 'false', autocorrect: 'off', autocapitalize: 'off', 'aria-label': 'Markdown editor' })),
        comp.brackets.of(o.closeBrackets ? CM.closeBrackets() : []),
        comp.tab.of(EditorState.tabSize.of(4)),
        CM.keymap.of([...(o.closeBrackets ? CM.closeBracketsKeymap : []), ...CM.searchKeymap, ...CM.historyKeymap, ...CM.defaultKeymap, CM.indentWithTab]),
        CM.placeholder('Start writing… (Markdown)'),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !suppress) MD.onEditorChange && MD.onEditorChange();
          if (u.selectionSet || u.docChanged) MD.onEditorCursor && MD.onEditorCursor();
          if (u.focusChanged) document.body.classList.toggle('md-editing', u.view.hasFocus);
        }),
        EditorView.domEventHandlers({
          paste: (e) => MD.onEditorPaste ? MD.onEditorPaste(e) : false,
          drop: (e) => MD.onEditorDrop ? MD.onEditorDrop(e) : false,
        }),
      ],
    });
    view = new EditorView({ state, parent });
    E.view = view;
    return view;
  }

  // ------------------------------------------------------------------ text access
  const E = MD.editor = {
    create,
    get: () => view.state.doc.toString(),
    focus: () => view.focus(),
    hasFocus: () => view.hasFocus,
    undo: () => CM.undo(view),
    redo: () => CM.redo(view),
    selectAll: () => { CM.selectAll(view); view.focus(); },
    cursorLine: () => view.state.doc.lineAt(view.state.selection.main.head).number - 1,
    cursorPos() { const p = view.state.selection.main.head; const l = view.state.doc.lineAt(p); return { line: l.number, col: p - l.from + 1, sel: Math.abs(view.state.selection.main.to - view.state.selection.main.from) }; },
    selectedText: () => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to),
    /** Moves the cursor to a 0-based line and shows it. */
    goToLine(line0, select) {
      const n = Math.min(Math.max(1, line0 + 1), view.state.doc.lines);
      const l = view.state.doc.line(n);
      view.dispatch({ selection: select ? { anchor: l.from, head: l.to } : { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
      view.focus();
    },
    setOption(name, on) {
      const map = {
        lineNumbers: () => comp.lines.reconfigure(on ? CM.lineNumbers() : []),
        wrap: () => comp.wrap.reconfigure(on ? EditorView.lineWrapping : []),
        spellcheck: () => comp.spell.reconfigure(EditorView.contentAttributes.of({ spellcheck: on ? 'true' : 'false', autocorrect: 'off', autocapitalize: 'off' })),
        closeBrackets: () => comp.brackets.reconfigure(on ? CM.closeBrackets() : []),
      };
      if (map[name]) view.dispatch({ effects: map[name]() });
    },
    openFind() { CM.openSearchPanel(view); setTimeout(() => { const f = view.dom.querySelector('.cm-search input[name=search]'); f && f.focus(); f && f.select(); }, 0); },
    openReplace() { CM.openSearchPanel(view); setTimeout(() => { const f = view.dom.querySelector('.cm-search input[name=replace]'); (f || view.dom.querySelector('.cm-search input')).focus(); }, 0); },
    /** Finds `text` from the cursor (navigation pane search). */
    find(text) {
      if (!text) return false;
      const doc = view.state.doc.toString();
      const from = view.state.selection.main.to;
      let i = doc.toLowerCase().indexOf(text.toLowerCase(), from);
      if (i < 0) i = doc.toLowerCase().indexOf(text.toLowerCase());
      if (i < 0) return false;
      view.dispatch({ selection: { anchor: i, head: i + text.length }, effects: EditorView.scrollIntoView(i, { y: 'center' }) });
      return true;
    },
  };
  /** Replaces the whole text (a new or opened document) and starts a new undo history. */
  E.set = function (text) {
    suppress++;
    try {
      view.dispatch({ effects: comp.history.reconfigure([]) });
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: { anchor: 0 } });
      view.dispatch({ effects: comp.history.reconfigure(CM.history()) });
    } finally { suppress--; }
    view.scrollDOM.scrollTop = 0;
  };

  /**
   * Replaces the text with `text` as one undoable edit that only touches what differs, so the
   * cursor and scroll position stay put (reloading or merging a file changed elsewhere).
   */
  E.replaceAll = function (text) {
    const old = view.state.doc.toString();
    if (old === text) return;
    const hi = (s, i) => { const c = s.charCodeAt(i); return c >= 0xd800 && c <= 0xdbff; };
    let a = 0;
    while (a < old.length && a < text.length && old[a] === text[a]) a++;
    if (a > 0 && hi(old, a - 1)) a--; // don't split a surrogate pair
    let b = 0;
    while (b < old.length - a && b < text.length - a && old[old.length - 1 - b] === text[text.length - 1 - b]) b++;
    if (b > 0 && hi(old, old.length - b - 1)) b--;
    view.dispatch({ changes: { from: a, to: old.length - b, insert: text.slice(a, text.length - b) }, userEvent: 'input.replace' });
  };

  // ------------------------------------------------------------------ helpers
  const SEL = '\u0001';
  /** Inserts `text` at the selection. `\u0001…\u0001` marks what to select afterwards. */
  function insert(text, opts) {
    const st = view.state;
    const { from, to } = st.selection.main;
    let ins = text;
    let a = ins.indexOf(SEL), b = -1;
    if (a >= 0) { ins = ins.slice(0, a) + ins.slice(a + 1); b = ins.indexOf(SEL); if (b >= 0) ins = ins.slice(0, b) + ins.slice(b + 1); else b = a; }
    const anchor = a >= 0 ? from + a : from + ins.length;
    const head = a >= 0 ? from + b : anchor;
    view.dispatch({ changes: { from, to, insert: ins }, selection: { anchor, head }, scrollIntoView: true, userEvent: 'input' });
    if (!(opts && opts.noFocus)) view.focus();
  }
  E.insert = insert;
  E.SEL = SEL;

  /** Inserts a block: on its own lines, with a blank line before and after. */
  function insertBlock(text) {
    const st = view.state;
    const { from, to } = st.selection.main;
    const line = st.doc.lineAt(from);
    const atStartOfEmpty = line.text.trim() === '';
    // after the whole paragraph / table / list the cursor is in, not inside it
    let endLine = st.doc.lineAt(to).number;
    if (!atStartOfEmpty) while (endLine < st.doc.lines && st.doc.line(endLine + 1).text.trim() !== '') endLine++;
    let pos = atStartOfEmpty ? line.from : st.doc.line(endLine).to;
    let before = '';
    if (!atStartOfEmpty) before = '\n\n';
    else if (line.number > 1 && st.doc.line(line.number - 1).text.trim() !== '') before = '\n';
    const nextLineNo = (atStartOfEmpty ? line.number : endLine) + 1;
    let after = '\n';
    if (nextLineNo <= st.doc.lines && st.doc.line(nextLineNo).text.trim() !== '') after = '\n\n';
    else if (atStartOfEmpty && nextLineNo > st.doc.lines) after = '\n';
    const to2 = atStartOfEmpty ? line.to : pos;
    let ins = before + text + after;
    let a = ins.indexOf(SEL), b;
    if (a >= 0) { ins = ins.slice(0, a) + ins.slice(a + 1); b = ins.indexOf(SEL); if (b >= 0) ins = ins.slice(0, b) + ins.slice(b + 1); else b = a; }
    const anchor = a >= 0 ? pos + a : pos + ins.length - after.length;
    const head = a >= 0 ? pos + b : anchor;
    view.dispatch({ changes: { from: pos, to: to2, insert: ins }, selection: { anchor, head }, scrollIntoView: true, userEvent: 'input' });
    view.focus();
  }
  E.insertBlock = insertBlock;

  /** The word around the cursor when nothing is selected (Word applies formatting to it). */
  function wordAt(pos) {
    const line = view.state.doc.lineAt(pos);
    const off = pos - line.from;
    const s = line.text;
    const isW = (c) => /[\p{L}\p{N}_'-]/u.test(c);
    let a = off, b = off;
    while (a > 0 && isW(s[a - 1])) a--;
    while (b < s.length && isW(s[b])) b++;
    if (a === b || a === off && b === off) return null;
    if (off === a || off === b) { if (!(a < off && off < b)) return null; }
    return { from: line.from + a, to: line.from + b };
  }

  /** Bold, italic…: wraps or unwraps each selection with `mark` (and `close`). */
  function toggleWrap(mark, close, placeholder) {
    close = close || mark;
    const st = view.state;
    const changes = [];
    const ranges = [];
    for (const r of st.selection.ranges) {
      let { from, to } = r;
      if (from === to) {
        const w = wordAt(from);
        if (w) { from = w.from; to = w.to; }
      }
      const before = st.sliceDoc(Math.max(0, from - mark.length), from);
      const after = st.sliceDoc(to, to + close.length);
      const inner = st.sliceDoc(from, to);
      if (before === mark && after === close) {
        changes.push({ from: from - mark.length, to: from, insert: '' }, { from: to, to: to + close.length, insert: '' });
        ranges.push(EditorSelection.range(from - mark.length, to - mark.length));
      } else if (inner.startsWith(mark) && inner.endsWith(close) && inner.length >= mark.length + close.length) {
        changes.push({ from, to, insert: inner.slice(mark.length, inner.length - close.length) });
        ranges.push(EditorSelection.range(from, to - mark.length - close.length));
      } else if (from === to) {
        const ph = placeholder || 'text';
        changes.push({ from, insert: mark + ph + close });
        ranges.push(EditorSelection.range(from + mark.length, from + mark.length + ph.length));
      } else {
        changes.push({ from, insert: mark }, { from: to, insert: close });
        ranges.push(EditorSelection.range(from + mark.length, to + mark.length));
      }
    }
    view.dispatch(st.update({ changes, selection: EditorSelection.create(ranges), scrollIntoView: true, userEvent: 'input' }));
    view.focus();
  }
  E.toggleWrap = toggleWrap;

  /** Lines covered by the selection. */
  function selectedLines() {
    const st = view.state;
    const seen = new Set();
    const lines = [];
    for (const r of st.selection.ranges) {
      const a = st.doc.lineAt(r.from).number, b = st.doc.lineAt(r.to).number;
      for (let i = a; i <= b; i++) if (!seen.has(i)) { seen.add(i); lines.push(st.doc.line(i)); }
    }
    return lines;
  }

  const LIST_RE = /^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;
  /** Bullets, numbering, checklist, quote: on when any line lacks it, else off. */
  function toggleLines(kind) {
    const lines = selectedLines().filter((l, i, all) => all.length === 1 || l.text.trim() !== '');
    const has = (txt) => {
      if (kind === 'quote') return /^\s*>\s?/.test(txt);
      const m = LIST_RE.exec(txt); const mk = m && m[2] || '';
      if (kind === 'task') return /\[[ xX]\]/.test(mk);
      if (kind === 'number') return /^\d/.test(mk);
      if (kind === 'bullet') return /^[-*+]/.test(mk) && !/\[/.test(mk);
      return false;
    };
    const allHave = lines.every((l) => has(l.text));
    const changes = [];
    let n = 1;
    for (const l of lines) {
      if (kind === 'quote') {
        if (allHave) { const m = /^(\s*)>\s?/.exec(l.text); changes.push({ from: l.from + m[1].length, to: l.from + m[0].length, insert: '' }); }
        else changes.push({ from: l.from, insert: '> ' });
        continue;
      }
      const m = LIST_RE.exec(l.text);
      const indent = m[1], old = m[2] || '';
      const from = l.from + indent.length, to = from + old.length;
      if (allHave) changes.push({ from, to, insert: '' });
      else {
        const mk = kind === 'bullet' ? '- ' : kind === 'task' ? '- [ ] ' : (n++) + '. ';
        changes.push({ from, to, insert: mk });
      }
    }
    view.dispatch({ changes, scrollIntoView: true, userEvent: 'input' });
    view.focus();
  }
  E.toggleLines = toggleLines;

  /** Heading level 1–6 for the selected lines; 0 = Normal text. */
  function setHeading(level) {
    const changes = [];
    for (const l of selectedLines()) {
      const m = /^(\s{0,3})(#{1,6}\s+|#{1,6}$)?/.exec(l.text);
      const from = l.from + m[1].length, to = from + (m[2] || '').length;
      const cur = m[2] ? m[2].trim().length : 0;
      const ins = level && cur !== level ? '#'.repeat(level) + ' ' : level && cur === level ? '' : '';
      if (level && cur === level) changes.push({ from, to, insert: '' }); // toggle off
      else changes.push({ from, to, insert: ins });
    }
    view.dispatch({ changes, scrollIntoView: true, userEvent: 'input' });
    view.focus();
  }
  E.setHeading = setHeading;
  /** Heading level of the cursor's line (0 = none). */
  E.currentHeading = () => { const l = view.state.doc.lineAt(view.state.selection.main.head); const m = /^\s{0,3}(#{1,6})(\s|$)/.exec(l.text); return m ? m[1].length : 0; };
  /** Inline formats active at the cursor (approximate: looks at the syntax tree). */
  E.activeFormats = () => {
    const out = new Set();
    const pos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(pos);
    const before = line.text.slice(0, pos - line.from), after = line.text.slice(pos - line.from);
    const count = (s, m) => s.split(m).length - 1;
    if (count(before, '**') % 2 === 1 && after.includes('**')) out.add('bold');
    if ((count(before.replace(/\*\*/g, ''), '*') % 2 === 1 && after.replace(/\*\*/g, '').includes('*')) || (count(before.replace(/__/g, ''), '_') % 2 === 1 && /(^|[^_])_([^_]|$)/.test(after))) out.add('italic');
    if (count(before, '~~') % 2 === 1 && after.includes('~~')) out.add('strike');
    if (count(before, '==') % 2 === 1 && after.includes('==')) out.add('highlight');
    if (count(before, '`') % 2 === 1 && after.includes('`')) out.add('code');
    if (/<u>[^<]*$/.test(before) && after.includes('</u>')) out.add('underline');
    const t = line.text;
    if (/^\s*[-*+]\s+\[[ xX]\]/.test(t)) out.add('task');
    else if (/^\s*[-*+]\s/.test(t)) out.add('bullet');
    else if (/^\s*\d+[.)]\s/.test(t)) out.add('number');
    if (/^\s*>/.test(t)) out.add('quote');
    return out;
  };

  /** Removes inline Markdown formatting from the selection. */
  E.clearFormatting = () => {
    const st = view.state;
    const { from, to } = st.selection.main;
    if (from === to) return;
    const text = st.sliceDoc(from, to)
      .replace(/<\/?(u|sub|sup|mark|b|i|em|strong|span)[^>]*>/gi, '')
      .replace(/(\*\*|__)(.+?)\1/g, '$2').replace(/(\*|_)(.+?)\1/g, '$2')
      .replace(/~~(.+?)~~/g, '$1').replace(/==(.+?)==/g, '$1').replace(/`([^`]+)`/g, '$1')
      .replace(/(^|[^~])~([^~\s]+)~/g, '$1$2').replace(/\^([^^\s]+)\^/g, '$1');
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from, head: from + text.length }, userEvent: 'input' });
    view.focus();
  };

  // ------------------------------------------------------------------ inline styles
  // Font, size, text colour and background are written as HTML with a style attribute, which
  // every Markdown renderer keeps: <span style="…">words</span> inside a paragraph, and
  // <div style="…"> (with blank lines, so the Markdown inside still works) around paragraphs.
  const parseStyle = (s) => {
    const m = new Map();
    for (const part of String(s || '').split(';')) {
      const i = part.indexOf(':');
      if (i > 0) { const k = part.slice(0, i).trim().toLowerCase(), v = part.slice(i + 1).trim(); if (k && v) m.set(k, v); }
    }
    return m;
  };
  const styleText = (m) => [...m].map(([k, v]) => k + ': ' + v).join('; ');
  /** Every <span>/<div> in the text, with where its tags are and its style (if it has only a style). */
  function styledElements(text) {
    const out = [], stack = [];
    const re = /<(span|div)\b([^>]*)>|<\/(span|div)\s*>/gi;
    let m;
    while ((m = re.exec(text))) {
      if (m[1]) {
        const sm = /^\s+style\s*=\s*"([^"]*)"\s*$/i.exec(m[2]);
        stack.push({ tag: m[1].toLowerCase(), openFrom: m.index, openTo: m.index + m[0].length, style: sm ? sm[1] : null });
      } else {
        const tag = m[3].toLowerCase();
        for (let i = stack.length - 1; i >= 0; i--) {
          if (stack[i].tag === tag) { const e = stack.splice(i, 1)[0]; e.closeFrom = m.index; e.closeTo = m.index + m[0].length; out.push(e); break; }
        }
      }
    }
    return out.filter((e) => e.style !== null);
  }
  /** Styled elements around from..to, innermost first. */
  function enclosing(text, from, to) {
    return styledElements(text).filter((e) => e.openTo <= from && e.closeFrom >= to).sort((a, b) => b.openFrom - a.openFrom);
  }
  /** True when from..to is all of the element's content (apart from blank space). */
  const fills = (text, e, from, to) => text.slice(e.openTo, from).trim() === '' && text.slice(to, e.closeFrom).trim() === '';

  /** The style at the cursor or selection: the properties of the elements around it (inner wins). */
  E.styleAt = () => {
    const st = view.state, { from, to } = st.selection.main;
    const text = st.doc.toString();
    const out = new Map();
    for (const e of enclosing(text, from, to).reverse()) for (const [k, v] of parseStyle(e.style)) out.set(k, v);
    return out;
  };

  /**
   * Sets CSS properties on the selection ({'font-family': '"Arial"', color: null…}; null removes).
   * The element the selection fills (or, with only a cursor, the one around it) is changed in
   * place; otherwise the selection is wrapped: a <span> within a line, a <div> around lines.
   * An element left without properties is removed. opts.block: always a <div> (whole paragraphs).
   */
  E.applyStyle = (props, opts) => {
    opts = opts || {};
    const st = view.state;
    const text = st.doc.toString();
    let { from, to } = st.selection.main;
    const cursorOnly = from === to;
    const around = enclosing(text, from, to);
    let target = around.find((e) => fills(text, e, from, to)) || null;
    if (!target && cursorOnly && around.length && around[0].tag === 'span') target = around[0];
    // only removing: use the nearest element that has the property
    const removing = Object.values(props).every((v) => v == null);
    if (removing && !target) target = around.find((e) => Object.keys(props).some((k) => parseStyle(e.style).has(k))) || null;
    if (removing && target && !Object.keys(props).some((k) => parseStyle(target.style).has(k))) target = around.find((e) => Object.keys(props).some((k) => parseStyle(e.style).has(k))) || null;
    if (target) {
      const m = parseStyle(target.style);
      for (const [k, v] of Object.entries(props)) { if (v == null || v === '') m.delete(k); else m.set(k, v); }
      if (target.tag === 'div' && m.has('background-color') && !m.has('padding')) m.set('padding', '8px');
      if (target.tag === 'div' && !m.has('background-color') && m.get('padding') === '8px') m.delete('padding');
      let changes;
      if (m.size) changes = [{ from: target.openFrom, to: target.openTo, insert: '<' + target.tag + ' style="' + styleText(m) + '">' }];
      else {
        // no properties left: take the tags (and a div's blank lines) away
        let a = target.openFrom, b = target.openTo, c = target.closeFrom, d = target.closeTo;
        if (target.tag === 'div') { while (b < c && /\s/.test(text[b])) b++; while (c > b && /\s/.test(text[c - 1])) c--; }
        changes = [{ from: a, to: b, insert: '' }, { from: c, to: d, insert: '' }];
      }
      view.dispatch({ changes, userEvent: 'input' });
      view.focus();
      return true;
    }
    if (removing) return false;
    const m = new Map();
    for (const [k, v] of Object.entries(props)) if (v != null && v !== '') m.set(k, v);
    if (cursorOnly) {
      const w = wordAt(from);
      if (w) { from = w.from; to = w.to; }
    }
    let sel = st.sliceDoc(from, to);
    const block = opts.block || sel.includes('\n');
    if (block) {
      if (m.has('background-color') && !m.has('padding')) m.set('padding', '8px');
      const l1 = st.doc.lineAt(from);
      let l2 = st.doc.lineAt(to);
      if (to === l2.from && to > from) l2 = st.doc.line(l2.number - 1);
      from = l1.from; to = l2.to; sel = st.sliceDoc(from, to);
      const before = l1.number > 1 && st.doc.line(l1.number - 1).text.trim() !== '' ? '\n' : '';
      const after = l2.number < st.doc.lines && st.doc.line(l2.number + 1).text.trim() !== '' ? '\n' : '';
      const open = before + '<div style="' + styleText(m) + '">\n\n';
      view.dispatch({ changes: { from, to, insert: open + sel + '\n\n</div>' + after }, selection: { anchor: from + open.length, head: from + open.length + sel.length }, scrollIntoView: true, userEvent: 'input' });
    } else {
      const inner = sel || 'text';
      const open = '<span style="' + styleText(m) + '">';
      view.dispatch({ changes: { from, to, insert: open + inner + '</span>' }, selection: { anchor: from + open.length, head: from + open.length + inner.length }, scrollIntoView: true, userEvent: 'input' });
    }
    view.focus();
    return true;
  };

  // ------------------------------------------------------------------ front matter
  const FM_RE = /^---\r?\n([\s\S]*?)\r?\n(---|\.\.\.)\r?\n?/;
  E.frontMatter = () => {
    const m = FM_RE.exec(E.get());
    const out = {};
    if (!m) return out;
    for (const l of m[1].split(/\r?\n/)) {
      const mm = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(l);
      if (mm) out[mm[1]] = mm[2].trim().replace(/^["']|["']$/g, '');
    }
    return out;
  };
  /** Sets (or with null, removes) top-level front matter keys; creates the block if needed. */
  E.setFrontMatter = (pairs) => {
    const doc = E.get();
    const m = FM_RE.exec(doc);
    const quote = (v) => (/[:#\[\]{}&*!|>'"%@`]|^\s|\s$/.test(v) ? '"' + String(v).replace(/"/g, '\\"') + '"' : v);
    let lines = m ? m[1].split(/\r?\n/) : [];
    for (const [k, v] of Object.entries(pairs)) {
      const i = lines.findIndex((l) => new RegExp('^' + k + '\\s*:').test(l));
      if (v == null || v === '') { if (i >= 0) lines.splice(i, 1); }
      else if (i >= 0) lines[i] = k + ': ' + quote(v);
      else lines.push(k + ': ' + quote(v));
    }
    const block = lines.length ? '---\n' + lines.join('\n') + '\n---\n' : '';
    const from = 0, to = m ? m[0].length : 0;
    let ins = block;
    if (!m && block && !doc.startsWith('\n')) ins += '\n';
    view.dispatch({ changes: { from, to, insert: ins }, userEvent: 'input' });
  };

  // ------------------------------------------------------------------ tables
  E.tableMarkdown = (rows, cols) => {
    const head = '| ' + Array.from({ length: cols }, (_, i) => (i === 0 ? SEL + 'Column 1' + SEL : 'Column ' + (i + 1))).join(' | ') + ' |';
    const sep = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |';
    const body = Array.from({ length: Math.max(1, rows - 1) }, () => '| ' + Array.from({ length: cols }, () => '   ').join(' | ') + ' |');
    return [head, sep, ...body].join('\n');
  };
  /** The GFM table around the cursor: {from, to, rows (cells)} or null. */
  function tableAt() {
    const st = view.state;
    const cur = st.doc.lineAt(st.selection.main.head);
    const isRow = (l) => /^\s*\|.*\|\s*$/.test(l.text) || /^\s*[^|]+\|/.test(l.text) && /\|/.test(l.text);
    if (!isRow(cur)) return null;
    let a = cur.number, b = cur.number;
    while (a > 1 && isRow(st.doc.line(a - 1))) a--;
    while (b < st.doc.lines && isRow(st.doc.line(b + 1))) b++;
    const lines = [];
    for (let i = a; i <= b; i++) lines.push(st.doc.line(i));
    if (lines.length < 2 || !/^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/.test(lines[1].text)) return null;
    const split = (s) => { let t = s.trim(); if (t.startsWith('|')) t = t.slice(1); if (t.endsWith('|') && !t.endsWith('\\|')) t = t.slice(0, -1); return t.split(/(?<!\\)\|/).map((c) => c.trim()); };
    return { from: lines[0].from, to: lines[lines.length - 1].to, first: a, rows: lines.map((l) => split(l.text)), cur: cur.number - a };
  }
  E.inTable = () => !!tableAt();
  /** Aligns the pipes of the table at the cursor. */
  E.formatTable = (mutate) => {
    const tb = tableAt();
    if (!tb) { MD.toast('Put the cursor in a table first'); return false; }
    let rows = tb.rows;
    if (mutate) rows = mutate(rows, tb.cur) || rows;
    const n = Math.max(...rows.map((r) => r.length));
    rows = rows.map((r) => { const c = r.slice(); while (c.length < n) c.push(''); return c; });
    const aligns = rows[1].map((c) => (c.startsWith(':') && c.endsWith(':') ? 'c' : c.endsWith(':') ? 'r' : c.startsWith(':') ? 'l' : ''));
    const w = Array.from({ length: n }, (_, i) => Math.max(3, ...rows.filter((_, j) => j !== 1).map((r) => [...(r[i] || '')].length)));
    const pad = (s, k, a) => { const len = [...s].length; const sp = k - len; if (a === 'r') return ' '.repeat(sp) + s; if (a === 'c') return ' '.repeat(Math.floor(sp / 2)) + s + ' '.repeat(Math.ceil(sp / 2)); return s + ' '.repeat(sp); };
    const out = rows.map((r, j) => {
      if (j === 1) return '| ' + w.map((k, i) => { const a = aligns[i]; const d = '-'.repeat(Math.max(1, k - (a === 'c' ? 2 : a ? 1 : 0))); return a === 'c' ? ':' + d + ':' : a === 'r' ? d + ':' : a === 'l' ? ':' + d : d; }).join(' | ') + ' |';
      return '| ' + r.map((c, i) => pad(c, w[i], aligns[i])).join(' | ') + ' |';
    }).join('\n');
    view.dispatch({ changes: { from: tb.from, to: tb.to, insert: out }, userEvent: 'input' });
    view.focus();
    return true;
  };
  E.tableAddRow = () => E.formatTable((rows, cur) => { const r = rows.slice(); r.splice(Math.max(2, cur + 1), 0, rows[0].map(() => '')); return r; });
  E.tableAddCol = () => E.formatTable((rows) => rows.map((r, j) => [...r, j === 0 ? 'New' : j === 1 ? '---' : '']));
  E.tableDelRow = () => E.formatTable((rows, cur) => { if (cur < 2 || rows.length <= 3) return rows; const r = rows.slice(); r.splice(cur, 1); return r; });

  // ------------------------------------------------------------------ slides
  /** Line numbers (1-based) of `<!-- slide -->` markers outside code fences. */
  E.slideMarkers = () => slideStartsOf(view.state.doc).filter((x) => x.marker).map((x) => x.line);
  E.slideStarts = () => slideStartsOf(view.state.doc);
  /** Number of slides the renderer will show. */
  E.slideCount = () => E.slideStarts().length;
  /** The slide (1-based) the cursor is on. */
  E.currentSlide = () => {
    const line = E.cursorLine() + 1;
    const st = E.slideStarts();
    let n = 1;
    st.forEach((x, i) => { if (x.line <= line) n = i + 1; });
    return n;
  };
  /** Range (1-based lines) of slide n: [start, end] (start is its marker line). */
  E.slideRange = (n) => {
    const st = E.slideStarts();
    const doc = view.state.doc;
    if (!st.length) return [1, doc.lines];
    const i = Math.max(0, Math.min(st.length - 1, n - 1));
    return [st[i].line, i + 1 < st.length ? st[i + 1].line - 1 : doc.lines];
  };
  E.goToSlide = (n) => {
    const st = E.slideStarts();
    if (!st.length) return;
    const s0 = st[Math.max(0, Math.min(st.length - 1, n - 1))];
    const doc = view.state.doc;
    let line = s0.line + (s0.marker ? 1 : 0);
    while (line < doc.lines && doc.line(line).text.trim() === '') line++;
    E.goToLine(line - 1);
  };
  /** The marker line (1-based) of the current slide, or null when it has none. */
  function currentMarkerLine() {
    const st = E.slideStarts();
    const x = st[E.currentSlide() - 1];
    return x && x.marker ? x.line : null;
  }
  /** Sets the `class` of the current slide's marker (its layout). Slide 1 gets a marker at the top of its content when needed. */
  E.setSlideClass = (cls) => {
    const doc = view.state.doc;
    const ml = currentMarkerLine();
    if (ml) { replaceMarkerClass(doc.line(ml), cls); return; }
    // the first slide has no marker: give it one where it starts
    const st = E.slideStarts();
    const startLine = st.length ? st[0].line : (FM_RE.exec(E.get()) ? doc.lineAt(FM_RE.exec(E.get())[0].length).number : 1);
    const pos = doc.line(Math.min(startLine, doc.lines)).from;
    view.dispatch({ changes: { from: pos, insert: '<!-- slide' + (cls ? ' class="' + cls + '"' : '') + ' -->\n\n' }, userEvent: 'input' });
    view.focus();
  };
  function replaceMarkerClass(line, cls) {
    let tx = line.text;
    if (/class\s*=\s*"[^"]*"/.test(tx)) tx = cls ? tx.replace(/class\s*=\s*"[^"]*"/, 'class="' + cls + '"') : tx.replace(/\s*class\s*=\s*"[^"]*"/, '');
    else if (cls) tx = tx.replace(/<!--\s*slide/, '<!-- slide class="' + cls + '"');
    view.dispatch({ changes: { from: line.from, to: line.to, insert: tx }, userEvent: 'input' });
    view.focus();
  }
  /** Sets an attribute (`data-background-color`) on the current slide's marker. */
  E.setSlideAttr = (name, value) => {
    let ml = currentMarkerLine();
    if (!ml) { E.setSlideClass(''); ml = currentMarkerLine(); }
    if (!ml) return;
    const line = view.state.doc.line(ml);
    let tx = line.text;
    tx = tx.replace(new RegExp('\\s*' + name + '\\s*=\\s*"[^"]*"'), '');
    if (value) tx = tx.replace(/\s*-->\s*$/, ' ' + name + '="' + value + '" -->');
    view.dispatch({ changes: { from: line.from, to: line.to, insert: tx }, userEvent: 'input' });
  };
  /** Inserts a new slide after the current one, with a layout skeleton. */
  E.newSlide = (layout) => {
    const doc = view.state.doc;
    const n = E.currentSlide();
    const end = E.slideCount() ? E.slideRange(n)[1] : doc.lines;
    const L = (window.MD.slideLayouts || {})[layout || 'content'] || { cls: '', body: '## ' + SEL + 'Title' + SEL + '\n\n- Point' };
    const marker = '<!-- slide' + (L.cls ? ' class="' + L.cls + '"' : '') + ' -->';
    const endLine = doc.line(end);
    const prefix = endLine.text.trim() === '' ? '\n' : '\n\n';
    let ins = prefix + marker + '\n\n' + L.body + '\n';
    let a = ins.indexOf(SEL), b;
    if (a >= 0) { ins = ins.slice(0, a) + ins.slice(a + 1); b = ins.indexOf(SEL); ins = ins.slice(0, b) + ins.slice(b + 1); }
    const from = endLine.to;
    // keep one blank line before the next marker
    const nextIsMarker = end < doc.lines;
    if (nextIsMarker) ins += '\n';
    view.dispatch({ changes: { from, insert: ins }, selection: a >= 0 ? { anchor: from + a, head: from + b } : { anchor: from + ins.length }, effects: EditorView.scrollIntoView(from + Math.max(0, a), { y: 'center' }), userEvent: 'input' });
    view.focus();
  };
  /** The text of slide n with a marker line in front (so it can be pasted anywhere). */
  function slideText(n) {
    const doc = view.state.doc;
    const [s0, e0] = E.slideRange(n);
    let text = doc.sliceString(doc.line(s0).from, doc.line(e0).to).replace(/\s+$/, '');
    if (!SLIDE_RE.test(doc.line(s0).text)) text = '<!-- slide -->\n\n' + text.replace(/^\s+/, '');
    return text;
  }
  E.duplicateSlide = () => {
    const n = E.currentSlide();
    if (!E.slideCount()) { MD.toast('This document has no slides yet'); return; }
    const [, e0] = E.slideRange(n);
    const doc = view.state.doc;
    view.dispatch({ changes: { from: doc.line(e0).to, insert: '\n\n' + slideText(n) + '\n' }, userEvent: 'input' });
    E.goToSlide(n + 1);
  };
  E.deleteSlide = () => {
    const count = E.slideCount();
    if (count <= 1) { MD.toast('This is the only slide'); return; }
    const n = E.currentSlide();
    const [s0, e0] = E.slideRange(n);
    const doc = view.state.doc;
    view.dispatch({ changes: { from: doc.line(s0).from, to: Math.min(doc.length, doc.line(e0).to + 1), insert: '' }, userEvent: 'delete' });
    // a first slide without its own marker: the next one's marker now opens the document body
    E.goToSlide(Math.max(1, Math.min(n, count - 1)));
  };
  /** Moves the current slide up (-1) or down (+1). */
  E.moveSlide = (dir) => {
    const count = E.slideCount();
    const n = E.currentSlide();
    const other = n + dir;
    if (other < 1 || other > count) { MD.toast('Already at the ' + (dir < 0 ? 'start' : 'end')); return; }
    const a = Math.min(n, other), b = Math.max(n, other);
    const doc = view.state.doc;
    const [a1] = E.slideRange(a);
    const [, b2] = E.slideRange(b);
    const A = slideText(a), B = slideText(b);
    view.dispatch({ changes: { from: doc.line(a1).from, to: doc.line(b2).to, insert: B + '\n\n' + A + '\n' }, userEvent: 'input' });
    E.goToSlide(other);
  };
  /** Adds a speaker-notes paragraph at the end of the current slide. */
  E.addNotes = () => {
    const n = E.currentSlide();
    const [s, e] = E.slideRange(n);
    const doc = view.state.doc;
    const body = doc.sliceString(doc.line(s).from, doc.line(e).to);
    if (/^Notes?:/m.test(body) || /<aside class="notes"/.test(body)) {
      const i = body.search(/^Notes?:|<aside class="notes"/m);
      const pos = doc.line(s).from + i;
      view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
      view.focus();
      return;
    }
    let endLine = e;
    while (endLine > s && doc.line(endLine).text.trim() === '') endLine--;
    const at = doc.line(endLine).to;
    const ins = '\n\nNote: ' + 'What to say on this slide.';
    view.dispatch({ changes: { from: at, insert: ins }, selection: { anchor: at + 8, head: at + ins.length }, effects: EditorView.scrollIntoView(at, { y: 'center' }), userEvent: 'input' });
    view.focus();
  };
})();
