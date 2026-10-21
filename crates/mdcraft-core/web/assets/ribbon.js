/* mdcraft — the ribbon (tabs, groups, galleries) and command search. */
(function () {
  'use strict';
  const MD = window.MD;
  const E = MD.editor;
  const { h } = MD;

  // ------------------------------------------------------------------ menus for split buttons
  const menus = {
    diagram: () => MD.diagrams.map((d) => ({ label: d.name, icon: d.icon, cmd: 'insert.diagram', args: { id: d.id } })),
    chart: () => MD.charts.map((d) => ({ label: d.name, icon: d.icon, cmd: 'insert.chart', args: { id: d.id } })),
    callout: () => MD.callouts.map((c) => ({ label: c.name, icon: 'callout', sub: c.text, cmd: 'insert.callout', args: { id: c.id }, preview: h('span.md-callout-dot.md-co-' + c.id.toLowerCase()) })),
    code: () => [...MD.codeLanguages.map(([id, name]) => ({ label: name, icon: 'code-block', cmd: 'insert.code', args: { lang: id } })), { sep: true }, { label: 'Python that runs (code chunk)', icon: 'run', cmd: 'insert.code', args: { lang: 'python', run: true, code: 'import math\nprint(f"π ≈ {math.pi:.5f}")' } }],
    math: () => MD.equations.map((q) => (q.inline ? { label: q.name, icon: 'sigma', cmd: 'insert.mathInline', shortcut: 'Mod+Shift+M' } : { label: q.name, icon: 'math', cmd: 'insert.math', args: { tex: q.tex }, sub: q.tex && !q.tex.includes(E.SEL) ? q.tex.replace(/\n/g, ' ').slice(0, 42) : '' })),
    table: (anchor) => tableGrid(anchor),
    newSlide: () => Object.entries(MD.slideLayouts).map(([id, L]) => ({ label: L.name, icon: L.icon, cmd: 'slides.new', args: { layout: id } })),
    layout: () => [...Object.entries(MD.slideLayouts).map(([id, L]) => ({ label: L.name, icon: L.icon, cmd: 'slides.layout', args: { layout: id } }))],
    paper: () => [['a4', 'A4 (210 × 297 mm)'], ['letter', 'Letter (8.5 × 11 in)'], ['a5', 'A5 (148 × 210 mm)'], ['legal', 'Legal (8.5 × 14 in)']].map(([id, label]) => ({ label, icon: 'page-size', cmd: 'design.paper', args: { id }, checked: (E.frontMatter().paper || 'a4') === id })),
    orientation: () => [['portrait', 'Portrait'], ['landscape', 'Landscape']].map(([id, label]) => ({ label, icon: 'orientation', cmd: 'design.orientation', args: { id }, checked: (E.frontMatter().orientation || 'portrait') === id })),
    margins: () => [['normal', 'Normal (2.5 cm)'], ['narrow', 'Narrow (1.27 cm)'], ['wide', 'Wide (3.5 cm)']].map(([id, label]) => ({ label, icon: 'margins', cmd: 'design.margins', args: { id }, checked: (E.frontMatter().margins || 'normal') === id })),
    watermark: () => [['DRAFT', 'Draft'], ['CONFIDENTIAL', 'Confidential'], ['DO NOT COPY', 'Do not copy'], ['SAMPLE', 'Sample'], ['URGENT', 'Urgent']].map(([text, label]) => ({ label, icon: 'watermark', cmd: 'design.watermark', args: { text }, checked: E.frontMatter().watermark === text }))
      .concat([{ sep: true }, { label: 'Custom watermark…', icon: 'watermark', cmd: 'design.watermark' }, { label: 'Remove watermark', icon: 'x', cmd: 'design.watermark', args: { text: '' } }]),
    present: () => [{ label: 'From beginning', icon: 'present', cmd: 'slides.present', shortcut: 'F5' }, { label: 'From current slide', icon: 'present-current', cmd: 'slides.presentCurrent', shortcut: 'Shift+F5' }],
    date: () => { const d = new Date(); return [d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }), d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), d.toISOString().slice(0, 10), d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })].map((f) => ({ label: f, run: () => E.insert(f) })); },
    media: () => [{ label: 'Video or audio file…', icon: 'video', cmd: 'insert.video' }, { label: 'Online video (YouTube, Vimeo)…', icon: 'web', cmd: 'insert.online' }],
    highlight: (anchor) => { colorPicker(anchor, 'highlight'); return null; },
    fontColor: (anchor) => { colorPicker(anchor, 'fontColor'); return null; },
    chem: () => [{ label: '3D molecule (Mol*)', icon: 'molecule', cmd: 'insert.molecule' }, { label: 'Chemical structure (SMILES)', icon: 'molecule', cmd: 'insert.smiles' }, { label: 'Chemical equation', icon: 'math', cmd: 'insert.math', args: { tex: '\\ce{CH4 + 2O2 -> CO2 + 2H2O}' } }],
  };

  function tableGrid(anchor) {
    const N = 8, M = 10;
    const label = h('div.md-menu-header', 'Insert table');
    const grid = h('div.md-tgrid');
    for (let r = 0; r < M; r++) for (let c = 0; c < N; c++) { const cell = h('div.md-tcell'); cell.dataset.r = r; cell.dataset.c = c; grid.append(cell); }
    grid.addEventListener('mouseover', (e) => {
      const t = e.target.closest('.md-tcell'); if (!t) return;
      const R = +t.dataset.r, Cc = +t.dataset.c;
      grid.querySelectorAll('.md-tcell').forEach((x) => x.classList.toggle('on', +x.dataset.r <= R && +x.dataset.c <= Cc));
      label.textContent = (Cc + 1) + ' × ' + (R + 1) + ' table';
    });
    grid.addEventListener('click', (e) => { const t = e.target.closest('.md-tcell'); if (!t) return; MD.closeMenu(); MD.run('insert.table', { rows: +t.dataset.r + 1, cols: +t.dataset.c + 1 }); });
    const more = h('div.md-menu-list',
      menuButton('Insert table…', 'table', () => MD.run('insert.tableDialog')),
      menuButton('Table from a CSV file…', 'csv', () => MD.run('insert.csv')),
      menuButton('Tidy the table at the cursor', 'table', () => MD.run('table.format')));
    MD.popup(anchor, h('div', label, grid, h('div.md-menu-sep'), more));
    return null;
  }
  // ------------------------------------------------------------------ colour picker
  // Word's colours: theme colours with lighter and darker shades, standard colours, and for
  // highlighting Word's highlighter colours plus soft ones. "Custom colors" are the user's own
  // (More colors… or a #hex code), kept in the preferences; right-click one to remove it.
  const THEME = ['#FFFFFF', '#000000', '#E7E6E6', '#44546A', '#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47'];
  const STANDARD = ['#C00000', '#FF0000', '#FFC000', '#FFFF00', '#92D050', '#00B050', '#00B0F0', '#0070C0', '#002060', '#7030A0'];
  const HIGHLIGHT = ['yellow', '#00FF00', '#00FFFF', '#FF00FF', '#0000FF', '#FF0000', '#000080', '#008080', '#008000', '#800080', '#800000', '#808000', '#808080', '#C0C0C0', '#000000',
    '#FFF2CC', '#E2EFDA', '#DDEBF7', '#FCE4D6', '#EDE7F6', '#FFE699', '#C6E0B4', '#BDD7EE', '#F8CBAD', '#D9D2E9'];
  const mix = (hex, to, t) => { const n = parseInt(hex.slice(1), 16), c = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(v + (to - v) * t)); return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase(); };
  const shades = (hex) => [hex, mix(hex, 255, 0.8), mix(hex, 255, 0.6), mix(hex, 255, 0.4), mix(hex, 0, 0.25), mix(hex, 0, 0.5)];
  const PICKERS = {
    highlight: { cmd: 'format.highlight', pref: 'highlightColor', fallback: 'yellow', none: 'No color', title: 'Highlight color' },
    fontColor: { cmd: 'format.color', pref: 'fontColor', fallback: '#C00000', none: 'Automatic', title: 'Font color' },
  };
  let colorInput = null; // one hidden <input type=color>, outside the popup (the system panel outlives it)
  function colorPicker(anchor, kind) {
    const P = PICKERS[kind];
    const pick = (color) => { MD.closeMenu(); MD.run(P.cmd, { color }); };
    const swatch = (c, title) => {
      const b = h('button.md-swatch', { title: title || c, style: { background: c }, dataset: { color: c } });
      b.addEventListener('click', () => pick(c));
      return b;
    };
    const current = MD.pref(P.pref) || P.fallback;
    const panel = h('div.md-colors');
    const noneBtn = h('button.md-menu-item.md-colors-none', h('span.md-swatch.md-swatch-none'), h('span.md-menu-label', P.none));
    noneBtn.addEventListener('click', () => pick('none'));
    panel.append(h('div.md-menu-header', P.title), noneBtn);
    if (kind === 'highlight') {
      panel.append(h('div.md-colors-label', 'Highlighter colors'), h('div.md-colors-grid', HIGHLIGHT.map((c) => swatch(c))));
    } else {
      const cols = THEME.map(shades);
      const grid = h('div.md-colors-grid.md-colors-theme');
      for (let r = 0; r < 6; r++) for (let c = 0; c < 10; c++) grid.append(swatch(cols[c][r], r === 0 ? cols[c][0] : cols[c][r] + (r < 4 ? ' (lighter)' : ' (darker)')));
      panel.append(h('div.md-colors-label', 'Theme colors'), grid);
    }
    panel.append(h('div.md-colors-label', 'Standard colors'), h('div.md-colors-grid', STANDARD.map((c) => swatch(c))));
    // custom colours
    const custom = h('div.md-colors-grid.md-colors-custom');
    const drawCustom = () => {
      const list = MD.pref('customColors') || [];
      custom.replaceChildren(...list.map((c) => {
        const b = swatch(c, c + ' — right-click to remove');
        b.addEventListener('contextmenu', (e) => { e.preventDefault(); MD.setPref('customColors', (MD.pref('customColors') || []).filter((x) => x !== c)); drawCustom(); });
        return b;
      }));
      if (!list.length) custom.append(h('span.md-colors-empty', 'None yet'));
    };
    const addCustom = (c) => { const list = (MD.pref('customColors') || []).filter((x) => x.toLowerCase() !== c.toLowerCase()); list.unshift(c); MD.setPref('customColors', list.slice(0, 20)); };
    drawCustom();
    const hex = h('input.md-input.md-colors-hex', { placeholder: '#1F77B4', spellcheck: false, value: /^#/.test(current) ? current : '' });
    const addHex = () => {
      let v = hex.value.trim(); if (/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v)) v = '#' + v;
      if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v) && !(window.CSS && CSS.supports('color', v))) { hex.classList.add('md-bad'); return; }
      addCustom(v.toUpperCase()); pick(v.toUpperCase());
    };
    hex.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addHex(); } });
    const addBtn = h('button.md-btn.md-colors-add', { title: 'Add this colour to your custom colours and use it' }, 'Add');
    addBtn.addEventListener('click', addHex);
    const more = h('button.md-menu-item', MD.icon('palette', 18), h('span.md-menu-label', 'More colors…'));
    more.addEventListener('click', () => {
      if (!colorInput) { colorInput = h('input', { type: 'color', style: { position: 'fixed', left: '-100px', top: '0', opacity: '0' } }); document.body.append(colorInput); }
      colorInput.value = /^#[0-9a-f]{6}$/i.test(current) ? current : '#ff0000';
      colorInput.onchange = () => { const c = colorInput.value.toUpperCase(); addCustom(c); MD.run(P.cmd, { color: c }); };
      MD.closeMenu();
      colorInput.click();
    });
    panel.append(h('div.md-colors-label', 'Custom colors'), custom, h('div.md-colors-hexrow', hex, addBtn), h('div.md-menu-sep'), more);
    MD.popup(anchor, panel, { cls: 'md-colors-menu', noFocus: true });
  }

  // ------------------------------------------------------------------ font and size boxes
  /** The current font family / size for the boxes: at the cursor, else the document's. */
  function fontState() {
    let st = new Map();
    try { st = E.styleAt(); } catch (e) { /* no document */ }
    const fm = (MD.doc && MD.doc.open) ? E.frontMatter() : {};
    const clean = (v) => String(v || '').replace(/\s*\(.*$/, '').trim();
    return {
      family: MD.plainFontName(st.get('font-family')) || clean(fm.mainfont),
      size: (st.get('font-size') || fm.fontsize || '').replace(/\s*pt$/, ''),
      docMain: clean(fm.mainfont), docMono: clean(fm.monofont), docSize: String(fm.fontsize || '').replace(/\s*pt$/, ''),
    };
  }
  // fontFamily / fontSize: the selection (Home); docMain / docMono / docSize: the front matter (Design)
  const BOX = {
    fontFamily: { family: true, title: 'Font', placeholder: 'Theme font', state: 'family' },
    fontSize: { family: false, title: 'Font size (points)', placeholder: '—', state: 'size' },
    docMain: { family: true, title: 'Body font of the document (mainfont)', placeholder: 'Theme font', state: 'docMain', cmd: 'design.mainfont' },
    docMono: { family: true, mono: true, title: 'Code font of the document (monofont)', placeholder: 'Theme code font', state: 'docMono', cmd: 'design.monofont' },
    docSize: { family: false, title: 'Font size of the document (fontsize)', placeholder: 'Theme', state: 'docSize', cmd: 'design.fontsize' },
  };
  function fontBox(kind) {
    const B = BOX[kind];
    const family = B.family;
    const input = h('input.md-font-input', { spellcheck: false, autocomplete: 'off', title: B.title, placeholder: B.placeholder, dataset: { fontbox: kind } });
    const arrow = h('button.md-rb-arrow.md-font-arrow', { title: family ? 'Fonts' : 'Font sizes', tabIndex: -1 }, MD.icon('caret', 12));
    const wrap = h('div.md-font-box.md-font-box-' + (family ? 'family' : 'size'), input, arrow);
    let typed = false;
    const apply = (v) => {
      typed = false; MD.closeMenu();
      if (B.cmd) MD.run(B.cmd, { value: v });
      else MD.run(family ? 'format.fontFamily' : 'format.fontSize', family ? { family: v } : { size: v });
    };
    const open = (filter) => (family ? fontList(wrap, filter, apply, B.mono) : sizeList(wrap, apply, B.state));
    arrow.addEventListener('mousedown', (e) => e.preventDefault());
    arrow.addEventListener('click', () => { input.focus(); open(''); });
    input.addEventListener('focus', () => input.select());
    input.addEventListener('input', () => { typed = true; if (family) open(input.value); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const sel = document.querySelector('.md-font-menu .md-font-item.sel'); apply(sel && typed && family ? sel.dataset.family : input.value.trim()); }
      else if (e.key === 'Escape') { e.preventDefault(); typed = false; MD.closeMenu(); refreshFontBoxes(true); E.focus(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!document.querySelector('.md-font-menu')) { open(family && typed ? input.value : ''); return; }
        const items = [...document.querySelectorAll('.md-font-menu .md-font-item')];
        let i = items.findIndex((x) => x.classList.contains('sel'));
        i = Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
        items.forEach((x, j) => x.classList.toggle('sel', j === i));
        items[i] && items[i].scrollIntoView({ block: 'nearest' });
        if (items[i]) { input.value = items[i].dataset.family ?? items[i].dataset.size; typed = true; }
      }
    });
    input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) { typed = false; refreshFontBoxes(true); } }, 200));
    return wrap;
  }
  async function fontList(anchor, filter, apply, mono) {
    let fonts = await MD.fonts();
    // code fonts: fixed-width fonts first, then sans-serif fonts
    if (mono) fonts = [...fonts.filter((f) => f.mono), ...fonts.filter((f) => !f.mono && f.sans)];
    const q = (filter || '').trim().toLowerCase();
    const recent = mono ? [] : (MD.pref('recentFonts') || []).filter((f) => !q || f.toLowerCase().includes(q));
    const all = fonts.filter((f) => !q || f.family.toLowerCase().includes(q));
    const item = (fam, sub) => {
      const b = h('button.md-menu-item.md-font-item', { dataset: { family: fam }, title: fam },
        h('span.md-font-sample', { style: { fontFamily: fam ? '"' + fam + '", system-ui' : null } }, fam || 'Theme font'), sub ? h('small', sub) : null);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => apply(fam));
      return b;
    };
    const list = h('div.md-menu-list.md-font-list');
    if (!q) list.append(item('', mono ? 'the theme’s code font' : 'the document’s font'));
    if (recent.length) list.append(h('div.md-menu-header', 'Recently used'), ...recent.map((f) => item(f)));
    const header = (t) => h('div.md-menu-header', t);
    if (!all.length) list.append(header(fonts.length ? 'No font matches “' + filter + '”' : 'Loading fonts…'));
    else if (mono) {
      const fixed = all.filter((f) => f.mono), sans = all.filter((f) => !f.mono);
      if (fixed.length) list.append(header('Fixed width (' + fixed.length + ')'), ...fixed.map((f) => item(f.family)));
      if (sans.length) list.append(header('Sans serif (' + sans.length + ')'), ...sans.map((f) => item(f.family)));
    } else {
      list.append(header('All fonts (' + all.length + ')'));
      for (const f of all) list.append(item(f.family, f.mono ? 'fixed width' : ''));
    }
    const first = list.querySelector('.md-font-item');
    if (first && q) first.classList.add('sel');
    MD.popup(anchor, list, { cls: 'md-font-menu', noFocus: true });
  }
  function sizeList(anchor, apply, state) {
    const list = h('div.md-menu-list.md-font-list.md-size-list');
    const cur = fontState()[state || 'size'];
    const item = (v, label) => {
      const b = h('button.md-menu-item.md-font-item' + (String(v) === cur ? '.sel' : ''), { dataset: { size: v } }, h('span.md-menu-label', label || String(v)));
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => apply(v === '' ? '' : v + 'pt'));
      return b;
    };
    list.append(item('', 'Theme size'), ...MD.fontSizes.map((v) => item(v)));
    MD.popup(anchor, list, { cls: 'md-font-menu md-size-menu', noFocus: true });
    list.querySelector('.sel')?.scrollIntoView({ block: 'center' });
  }
  /** Shows the font and size at the cursor in the boxes (not while one is being typed in). */
  function refreshFontBoxes(force) {
    const boxes = document.querySelectorAll('#md-ribbon [data-fontbox]');
    if (!boxes.length) return;
    const fs = fontState();
    for (const b of boxes) {
      if (!force && document.activeElement === b) continue;
      const B = BOX[b.dataset.fontbox];
      b.value = fs[B.state] || '';
      if (B.family) b.style.fontFamily = b.value ? '"' + b.value + '", system-ui' : '';
    }
    const hl = document.querySelector('#md-ribbon [data-cmd="format.highlight"]');
    if (hl) hl.style.setProperty('--swatch', MD.pref('highlightColor') || 'yellow');
    const fc = document.querySelector('#md-ribbon [data-cmd="format.color"]');
    if (fc) fc.style.setProperty('--swatch', MD.pref('fontColor') || '#C00000');
  }
  MD.refreshFontBoxes = refreshFontBoxes;

  function menuButton(label, icon, run) {
    const b = h('button.md-menu-item', h('span.md-menu-check'), MD.icon(icon, 18), h('span.md-menu-label', label), h('span.md-menu-key'));
    b.addEventListener('click', () => { MD.closeMenu(); run(); });
    return b;
  }

  // ------------------------------------------------------------------ layout
  const L = (cmd, extra) => Object.assign({ cmd, size: 'large' }, extra || {});
  const s = (cmd, extra) => Object.assign({ cmd, size: 'small' }, extra || {});
  const i = (cmd, extra) => Object.assign({ cmd, size: 'icon' }, extra || {});
  const TABS = [
    { id: 'home', label: 'Home', groups: [
      { label: 'Clipboard', items: [L('edit.paste'), { col: [s('edit.cut'), s('edit.copy'), s('format.clear', { label: 'Clear formatting' })] }] },
      { label: 'Font', items: [{ rows: [
        [{ widget: 'fontFamily' }, { widget: 'fontSize' }, i('format.grow'), i('format.shrink')],
        [i('format.bold'), i('format.italic'), i('format.underline'), i('format.strike'), i('format.code'), i('format.sub'), i('format.sup'), i('format.highlight', { menu: 'highlight' }), i('format.color', { menu: 'fontColor' }), i('format.clear')]] }] },
      { label: 'Paragraph', items: [{ rows: [[i('format.bullets'), i('format.numbering'), i('format.checklist'), i('format.outdent'), i('format.indent')], [i('format.quote'), i('insert.hr'), i('insert.callout', { menu: 'callout' }), i('insert.code', { menu: 'code' })]] }] },
      { label: 'Styles', items: [{ gallery: 'styles' }] },
      { label: 'Editing', items: [{ col: [s('edit.find'), s('edit.replace'), s('edit.selectAll')] }] },
    ] },
    { id: 'insert', label: 'Insert', groups: [
      { label: 'Pages', items: [{ col: [s('insert.cover'), s('insert.pagebreak'), s('insert.toc')] }] },
      { label: 'Tables', items: [L('insert.table', { menu: 'table', dropOnly: true })] },
      { label: 'Illustrations', items: [L('insert.picture'), L('insert.diagram', { menu: 'diagram' }), L('insert.chart', { menu: 'chart' }), { col: [s('insert.video', { label: 'Media', menu: 'media', dropOnly: true }), s('insert.molecule', { label: 'Chemistry', menu: 'chem', dropOnly: true }), s('insert.import', { label: 'Include file' })] }] },
      { label: 'Links', items: [L('insert.link'), { col: [s('insert.footnote'), s('insert.details', { label: 'Collapsible' })] }] },
      { label: 'Blocks', items: [L('insert.callout', { menu: 'callout' }), L('insert.code', { menu: 'code' }), L('insert.math', { menu: 'math' })] },
      { label: 'Text', items: [{ col: [s('insert.date', { menu: 'date', dropOnly: true }), s('insert.emoji'), s('insert.symbol')] }, L('insert.properties', { label: 'Properties' })] },
    ] },
    { id: 'design', label: 'Design', groups: [
      { label: 'Document themes', items: [{ gallery: 'themes' }] },
      { label: 'Document fonts', items: [{ widget: 'docFonts' }] },
      { label: 'Page setup', items: [{ col: [s('design.paper', { menu: 'paper', dropOnly: true, label: 'Size' }), s('design.orientation', { menu: 'orientation', dropOnly: true }), s('design.margins', { menu: 'margins', dropOnly: true })] }] },
      { label: 'Page background', items: [L('design.watermark', { menu: 'watermark', dropOnly: true })] },
      { label: 'Formatting', items: [{ col: [s('design.numbered'), s('design.justify')] }] },
    ] },
    { id: 'slides', label: 'Slides', groups: [
      { label: 'Slides', items: [L('slides.new', { menu: 'newSlide' }), { gallery: 'layouts' }, { col: [s('slides.duplicate'), s('slides.delete'), s('slides.notes')] }, { col: [s('slides.up'), s('slides.down'), s('slides.background', { label: 'Background' })] }] },
      { label: 'Slide themes', items: [{ gallery: 'deckThemes' }] },
      { label: 'Start slide show', items: [L('slides.present'), L('slides.presentCurrent')] },
      { label: 'Outline', items: [L('slides.fromHeadings')] },
    ] },
    { id: 'review', label: 'Review', groups: [
      { label: 'Proofing', items: [L('review.spelling', { label: 'Spelling' }), L('review.wordcount')] },
      { label: 'Accessibility', items: [L('review.accessibility')] },
      { label: 'Structure', items: [L('review.outline'), { col: [s('table.format'), s('edit.goto')] }] },
    ] },
    { id: 'view', label: 'View', groups: [
      { label: 'Views', items: [L('view.write'), L('view.split'), L('view.read'), L('slides.present', { label: 'Present', menu: 'present' })] },
      { label: 'Show', items: [{ col: [s('view.nav'), s('view.lineNumbers'), s('view.wrap')] }, { col: [s('view.sync'), s('review.spelling', { label: 'Spelling' }), s('view.focus', { label: 'Focus mode' })] }] },
      { label: 'Zoom', items: [L('view.zoomReset'), { col: [s('view.zoomIn'), s('view.zoomOut'), s('view.pageWidth')] }] },
      { label: 'Interface', items: [{ col: [s('view.light'), s('view.dark'), s('view.system')] }, L('view.darkPage')] },
      { label: 'Preview', items: [{ col: [s('view.refresh'), s('view.mathEngine'), s('view.runCode')] }] },
      { label: 'Window', items: [L('file.newWindow'), { col: [s('view.ribbon'), s('help.shortcuts'), s('help.search')] }] },
    ] },
    { id: 'table', label: 'Table', contextual: true, groups: [
      { label: 'Rows & columns', items: [L('table.addRow'), L('table.addCol'), L('table.delRow')] },
      { label: 'Format', items: [L('table.format')] },
    ] },
  ];
  MD.ribbonTabs = TABS;

  // ------------------------------------------------------------------ rendering
  const ribbon = document.getElementById('md-ribbon');
  const tabsEl = document.getElementById('md-tabs');
  let current = 'home';
  let peek = false;

  function button(it) {
    const c = MD.command(it.cmd);
    if (!c) { console.warn('ribbon: no command', it.cmd); return null; }
    const label = it.label || c.label;
    const tip = (c.label + (c.key ? ' (' + MD.keyLabel(c.key) + ')' : '')).replace(/…$/, '');
    const b = h('button.md-rb.md-rb-' + it.size, { title: tip, dataset: { cmd: it.cmd } });
    if (it.args) b.dataset.args = JSON.stringify(it.args);
    const iconSize = it.size === 'large' ? 30 : 18;
    if (it.size === 'large') b.append(MD.icon(c.icon, iconSize), h('span.md-rb-label', label, it.menu ? h('span.md-caret', MD.icon('caret', 12)) : null));
    else if (it.size === 'small') { b.append(MD.icon(c.icon, iconSize), h('span.md-rb-label', label)); if (it.menu) b.append(h('span.md-caret', MD.icon('caret', 12))); }
    else b.append(MD.icon(c.icon, iconSize));
    if (it.menu && it.dropOnly) {
      b.dataset.menu = it.menu;
      return b;
    }
    if (it.menu) {
      // split button: the main part runs the command, the arrow opens the menu
      const wrap = h('div.md-split-btn.md-split-' + it.size);
      const arrow = h('button.md-rb-arrow', { title: label + ' options', dataset: { menu: it.menu } }, MD.icon('caret', 12));
      if (it.size === 'large') b.querySelector('.md-caret')?.remove();
      wrap.append(b, arrow);
      return wrap;
    }
    return b;
  }

  function gallery(kind) {
    const g = h('div.md-gallery.md-gallery-' + kind, { dataset: { gallery: kind } });
    if (kind === 'styles') {
      const styles = [['format.normal', 'Normal', 'p'], ['format.h1', 'Heading 1', 'h1'], ['format.h2', 'Heading 2', 'h2'], ['format.h3', 'Heading 3', 'h3'], ['format.h4', 'Heading 4', 'h4'], ['format.quote', 'Quote', 'q'], ['format.code', 'Code', 'c']];
      for (const [cmd, name, tag] of styles) g.append(h('button.md-style-tile.md-st-' + tag, { dataset: { cmd }, title: name + (MD.command(cmd).key ? ' (' + MD.keyLabel(MD.command(cmd).key) + ')' : '') }, h('span.md-style-sample', tag === 'c' ? 'AaBb' : 'AaBbCc'), h('span.md-style-name', name)));
    } else if (kind === 'themes' || kind === 'deckThemes') {
      const list = MD.themes.filter((t) => (kind === 'themes' ? t.kind === 'document' : t.kind === 'deck'));
      for (const t of list) {
        const tile = h('button.md-theme-tile', { dataset: { cmd: 'design.theme', args: JSON.stringify({ id: t.id }) }, title: t.name + ' theme' },
          h('span.md-theme-preview.theme-swatch-' + t.id, { style: { background: t.kind === 'deck' ? t.colors[0] : '#fff', fontFamily: '"' + t.font + '", sans-serif' } },
            h('span.md-theme-aa', { style: { color: t.kind === 'deck' ? t.colors[2] : t.colors[0] } }, 'Aa'),
            h('span.md-theme-bars', ...t.colors.map((c) => h('i', { style: { background: c } })))),
          h('span.md-theme-name', t.name));
        g.append(tile);
      }
    } else if (kind === 'layouts') {
      for (const [id, Lay] of Object.entries(MD.slideLayouts)) {
        if (id === 'blank' || id === 'image') continue;
        g.append(h('button.md-layout-tile', { dataset: { cmd: 'slides.layout', args: JSON.stringify({ layout: id }) }, title: 'Layout: ' + Lay.name }, MD.icon(Lay.icon, 26), h('span', Lay.name.replace(' slide', '').replace('Title and content', 'Content').replace('Section header', 'Section').replace('Two content', 'Two columns'))));
      }
    }
    return g;
  }

  function renderTab(id) {
    const tab = TABS.find((t) => t.id === id) || TABS[0];
    const body = h('div.md-rb-body');
    for (const grp of tab.groups) {
      const content = h('div.md-rb-content');
      for (const it of grp.items) {
        if (it.gallery) content.append(gallery(it.gallery));
        else if (it.col) content.append(h('div.md-rb-col', it.col.map(button)));
        else if (it.rows) content.append(h('div.md-rb-rows', it.rows.map((r) => h('div.md-rb-row', r.map((x) => (x.widget ? fontBox(x.widget) : button(x)))))));
        else if (it.widget === 'docFonts') content.append(h('div.md-docfonts',
          ...[['Body', 'docMain'], ['Code', 'docMono'], ['Size', 'docSize']].map(([l, k]) => h('label.md-docfonts-line', h('span', l), fontBox(k)))));
        else content.append(button(it));
      }
      body.append(h('div.md-rb-group', content, h('div.md-rb-glabel', grp.label)));
    }
    ribbon.replaceChildren(body);
    MDIcons.fill(ribbon);
    refresh();
  }

  function renderTabs() {
    tabsEl.replaceChildren(...TABS.filter((t) => !t.contextual || contextualVisible(t)).map((t) =>
      h('button.md-tab', { role: 'tab', class: (t.id === current ? 'on' : '') + (t.contextual ? ' md-tab-ctx' : ''), dataset: { tab: t.id } }, t.label)));
  }
  function contextualVisible(t) { return t.id === 'table' && tableActive; }
  let tableActive = false;

  MD.selectTab = (id) => {
    current = id;
    renderTabs();
    renderTab(id);
    if (MD.pref && MD.pref('ribbonCollapsed')) { peek = true; document.body.classList.add('md-ribbon-peek'); }
  };
  MD.currentTab = () => current;

  tabsEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    if (MD.backstageOpen()) MD.closeBackstage();
    MD.selectTab(b.dataset.tab);
  });
  tabsEl.addEventListener('dblclick', (e) => { if (e.target.closest('[data-tab]')) MD.run('view.ribbon'); });

  // clicks on anything with data-cmd (ribbon, status bar, backstage)
  document.addEventListener('click', (e) => {
    const arrow = e.target.closest('[data-menu]');
    if (arrow && (arrow.classList.contains('md-rb-arrow') || arrow.classList.contains('md-rb'))) {
      e.preventDefault();
      const m = menus[arrow.dataset.menu];
      if (m) { const items = m(arrow); if (items) MD.menu(arrow, items); }
      return;
    }
    const el = e.target.closest('[data-cmd]');
    if (!el || el.disabled) return;
    if (el.closest('.md-menu')) return; // menus handle their own clicks
    e.preventDefault();
    const args = el.dataset.args ? JSON.parse(el.dataset.args) : undefined;
    const withAnchor = args ? Object.assign({ anchor: el }, args) : { anchor: el };
    MD.run(el.dataset.cmd, el.dataset.args ? withAnchor : (['insert.emoji', 'insert.symbol', 'slides.background', 'insert.date'].includes(el.dataset.cmd) ? { anchor: el } : undefined));
    if (peek && el.closest('#md-ribbon')) { peek = false; document.body.classList.remove('md-ribbon-peek'); }
  });
  document.addEventListener('mousedown', (e) => {
    if (peek && !e.target.closest('#md-top') && !e.target.closest('.md-menu')) { peek = false; document.body.classList.remove('md-ribbon-peek'); }
  });

  // ------------------------------------------------------------------ state (checked / enabled)
  let refreshTimer = null;
  function refresh() {
    MD.updateFormatState();
    const wasTable = tableActive;
    tableActive = E.inTable();
    if (wasTable !== tableActive) { renderTabs(); if (!tableActive && current === 'table') MD.selectTab('home'); }
    for (const el of document.querySelectorAll('#md-ribbon [data-cmd], #md-status [data-cmd]')) {
      const c = MD.command(el.dataset.cmd);
      if (!c) continue;
      const args = el.dataset.args ? JSON.parse(el.dataset.args) : undefined;
      if (c.checked) el.classList.toggle('on', !!c.checked(args));
      if (c.enabled) el.disabled = !c.enabled();
    }
    refreshFontBoxes();
  }
  MD.refreshRibbon = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 60); };

  // ------------------------------------------------------------------ command search (Alt+Q)
  const search = document.getElementById('md-search');
  const results = document.getElementById('md-search-results');
  let hits = [];
  let sel = 0;
  function score(c, q) {
    const label = c.label.toLowerCase(), kw = (c.keywords || '').toLowerCase(), id = c.id.toLowerCase();
    if (label.startsWith(q)) return 3;
    if (label.split(/\s+/).some((w) => w.startsWith(q))) return 2.5;
    if (label.includes(q)) return 2;
    if (q.split(/\s+/).every((w) => label.includes(w) || kw.includes(w) || id.includes(w))) return 1;
    return 0;
  }
  function showResults() {
    const q = search.value.trim().toLowerCase();
    if (!q) { results.hidden = true; return; }
    hits = [...MD.commands.values()].filter((c) => !c.hidden).map((c) => [c, score(c, q)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([c]) => c);
    // templates too
    sel = 0;
    results.replaceChildren(...hits.map((c, i) => h('button.md-menu-item' + (i === sel ? '.sel' : ''), { dataset: { i } }, h('span.md-menu-check'), MD.icon(c.icon, 18), h('span.md-menu-label', c.label), h('span.md-menu-key', MD.keyLabel(c.key || '')))));
    if (!hits.length) results.replaceChildren(h('div.md-menu-header', 'No commands match “' + search.value + '”'));
    results.hidden = false;
  }
  function pick(i) {
    const c = hits[i];
    if (!c) return;
    results.hidden = true; search.value = ''; search.blur();
    MD.run(c.id);
  }
  search.addEventListener('input', showResults);
  search.addEventListener('focus', showResults);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % Math.max(1, hits.length);
      results.querySelectorAll('.md-menu-item').forEach((b, i) => b.classList.toggle('sel', i === sel));
    } else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
    else if (e.key === 'Escape') { e.preventDefault(); search.value = ''; results.hidden = true; E.focus(); }
  });
  results.addEventListener('mousedown', (e) => { const b = e.target.closest('[data-i]'); if (b) { e.preventDefault(); pick(+b.dataset.i); } });
  search.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 150));

  MD.renderRibbon = () => { renderTabs(); renderTab(current); };
})();
