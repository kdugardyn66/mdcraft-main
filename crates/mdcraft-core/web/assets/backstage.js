/* mdcraft — the File view ("backstage"): start page, templates, open, save as, info,
 * print, export, options, about. */
(function () {
  'use strict';
  const MD = window.MD;
  const ML = window.ML;
  const E = MD.editor;
  const { h } = MD;
  const bs = document.getElementById('md-backstage');
  const pageEl = document.getElementById('md-bs-page');
  let page = 'home';

  MD.backstageOpen = () => !bs.hidden;
  MD.openBackstage = (p) => {
    MD.closeMenu();
    bs.hidden = false;
    document.body.classList.add('md-in-backstage');
    show(p || 'home');
  };
  MD.closeBackstage = () => {
    if (!MD.doc || !MD.doc.open) { show('home'); return; } // nothing to go back to
    bs.hidden = true;
    document.body.classList.remove('md-in-backstage');
    setTimeout(() => E.focus(), 0);
  };
  bs.querySelector('#md-bs-nav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-page]');
    if (!b) return;
    // Save As is the system's Save window, not a page
    if (b.dataset.page === 'saveas') { MD.closeBackstage(); setTimeout(() => MD.saveAs(), 0); return; }
    show(b.dataset.page);
  });

  function show(p) {
    page = p;
    bs.querySelectorAll('#md-bs-nav [data-page]').forEach((b) => b.classList.toggle('on', b.dataset.page === p));
    bs.classList.toggle('md-no-doc', !(MD.doc && MD.doc.open));
    const fn = pages[p] || pages.home;
    pageEl.replaceChildren();
    pageEl.scrollTop = 0;
    Promise.resolve(fn()).then((el) => { if (el && page === p) { pageEl.replaceChildren(el); MDIcons.fill(pageEl); } }).catch((e) => pageEl.replaceChildren(h('p.md-error', String(e.message || e))));
  }
  MD.showBackstagePage = show;

  // ------------------------------------------------------------------ template thumbnails
  const previewCache = new Map();
  async function templatePreview(id) {
    if (!previewCache.has(id)) previewCache.set(id, MD.api('/api/template/preview?id=' + encodeURIComponent(id)).catch(() => null));
    return previewCache.get(id);
  }
  function thumb(t, preview) {
    const frame = h('div.md-thumb' + (t.kind === 'presentation' ? '.md-thumb-deck' : '.md-thumb-doc'));
    const inner = h('div.md-thumb-inner');
    frame.append(inner);
    (preview || templatePreview(t.id)).then((p) => {
      if (!p) return;
      const theme = (p.meta && p.meta.theme) || t.theme;
      const art = h('article.markdown-body.md-thumb-body.theme-' + theme + (p.slides ? '.ml-deck' : ''));
      art.innerHTML = p.html;
      if (p.slides) {
        const first = art.querySelector('.ml-slide');
        art.replaceChildren();
        if (first) art.append(first);
      }
      art.querySelectorAll('.ml-diagram, .ml-chart-box, .ml-math-block').forEach((d) => { d.replaceChildren(h('div.md-thumb-ph')); });
      inner.replaceChildren(art);
      if (!p.slides) fitScale(frame, art, 794);
    });
    return frame;
  }
  // document thumbnails: a 794 px page scaled to the card's width
  const ro = new ResizeObserver((entries) => { for (const e of entries) { const a = e.target.__fit; if (a) a.el.style.transform = 'scale(' + (e.contentRect.width / a.w) + ')'; } });
  function fitScale(frame, el, w) { frame.__fit = { el, w }; ro.observe(frame); el.style.transform = 'scale(' + ((frame.clientWidth || 190) / w) + ')'; }
  function templateCard(t, small) {
    const card = h('button.md-tpl' + (small ? '.md-tpl-small' : ''), { title: t.description },
      thumb(t),
      h('span.md-tpl-name', t.name),
      small ? null : h('span.md-tpl-desc', t.description));
    card.addEventListener('click', () => MD.uiNew(t.id));
    return card;
  }
  let templates = null;
  async function allTemplates() { if (!templates) templates = await MD.api('/api/templates'); return templates; }

  // ------------------------------------------------------------------ my templates
  // The user's own templates (.mdd documents, .mds slides) in the templates folder.
  async function userTemplates() { try { return (await MD.api('/api/user-templates')).templates || []; } catch (e) { return []; } }
  const userPreviewCache = new Map();
  function userPreview(t) {
    const key = t.path + '@' + t.modified;
    if (!userPreviewCache.has(key)) userPreviewCache.set(key, MD.api('/api/user-template/preview?path=' + encodeURIComponent(t.path)).catch(() => null));
    return userPreviewCache.get(key);
  }
  function userTemplateCard(t, small, redraw) {
    const act = (icon, title, run) => {
      const b = h('span.md-tpl-act', { role: 'button', tabIndex: 0, title }, MD.icon(icon, 16));
      b.addEventListener('click', (e) => { e.stopPropagation(); run(); });
      return b;
    };
    const card = h('button.md-tpl.md-tpl-mine' + (small ? '.md-tpl-small' : ''), { title: (t.description || t.name) + '\n' + t.path },
      h('div.md-tpl-thumbwrap', thumb(t, userPreview(t)),
        small ? null : h('div.md-tpl-acts',
          act('pencil', 'Edit the template', () => MD.editUserTemplate(t)),
          act('rename', 'Rename', () => MD.renameUserTemplate(t).then((ok) => ok && redraw && redraw())),
          act('trash', 'Delete (move to the Trash)', () => MD.deleteUserTemplate(t).then((ok) => ok && redraw && redraw())))),
      h('span.md-tpl-name', t.name),
      small ? null : h('span.md-tpl-desc', (t.kind === 'presentation' ? 'Slides' : 'Document') + (t.description && t.description !== t.name ? ' · ' + t.description : '')));
    card.addEventListener('click', () => MD.uiNewFromUserTemplate(t.path));
    return card;
  }
  MD.editUserTemplate = (t) => MD.uiOpen(t.path);
  MD.renameUserTemplate = async (t) => {
    const name = await MD.prompt('Rename template', 'Name', t.name);
    if (!name || name === t.name) return false;
    try {
      const r = await MD.api('/api/user-template/rename', { path: t.path, name });
      if (MD.doc.open && MD.doc.path === t.path) { MD.doc.path = r.path; MD.doc.name = MD.basename(r.path); MD.updateTitle && MD.updateTitle(); }
      MD.toast('Renamed to “' + MD.basename(r.path) + '”');
      return true;
    } catch (e) { MD.alert('Cannot rename', e.message); return false; }
  };
  MD.deleteUserTemplate = async (t) => {
    if (!(await MD.confirm('Delete template', 'Move the template “' + t.name + '” to the Trash? Documents made from it are not affected.', 'Move to Trash'))) return false;
    try {
      await MD.api('/api/user-template/delete', { path: t.path });
      if (MD.doc.open && MD.doc.path === t.path) { MD.doc.saved = false; MD.doc.dirty = true; MD.updateTitle && MD.updateTitle(); }
      MD.toast('“' + t.name + '” moved to the Trash');
      return true;
    } catch (e) { MD.alert('Cannot delete', e.message); return false; }
  };
  /** The "My templates" block: actions, then the user's templates (filtered like the rest). */
  function myTemplatesSection(list, filterFn, redraw) {
    const shown = list.filter(filterFn);
    const btn = (icon, label, run, title) => h('button.md-btn', { onclick: run, title: title || '' }, MD.icon(icon, 18), label);
    const head = h('div.md-bs-section-head.md-mytpl-head', h('h2', 'My templates'),
      h('div.md-mytpl-actions',
        btn('file-plus', 'New document template', () => MD.uiNewTemplate('document')),
        btn('present', 'New slide template', () => MD.uiNewTemplate('presentation')),
        MD.doc.open ? btn('save-as', 'Save this document as a template', () => { MD.closeBackstage(); MD.saveAs({ template: true }); }) : null,
        MD.isNative() ? btn('folder-open', 'Templates folder', () => MD.native('reveal', { path: MD.app.templatesDir }), MD.app.templatesDir) : null));
    const body = shown.length ? h('div.md-tpl-cards', shown.map((t) => userTemplateCard(t, false, redraw)))
      : h('p.md-empty.md-mytpl-empty', list.length ? 'None of your templates match.'
        : 'You have no templates yet. Make one with New document template or New slide template, or save any document as a template: File › Save As, File type “Markdown template”.');
    return [head, body];
  }

  // ------------------------------------------------------------------ recent list
  function recentList(list, opts) {
    const wrap = h('div.md-recent');
    if (!list.length) { wrap.append(h('p.md-empty', opts && opts.empty || 'Documents you open will show up here.')); return wrap; }
    const table = h('div.md-recent-table');
    for (const r of list) {
      const row = h('div.md-recent-row' + (r.missing ? '.md-missing' : ''), { title: r.path },
        MD.icon(/\.(md|markdown)$/i.test(r.name) ? 'file-md' : 'file-text', 22),
        h('div.md-recent-name', h('b', r.name), h('small', r.folder)),
        h('div.md-recent-date', r.missing ? 'not found' : MD.fmtDate(r.opened)),
        h('button.md-icon-btn.md-pin' + (r.pinned ? '.on' : ''), { title: r.pinned ? 'Unpin' : 'Pin to the list', dataset: { act: 'pin' } }, MD.icon('pin', 16)),
        h('button.md-icon-btn', { title: 'Remove from the list', dataset: { act: 'remove' } }, MD.icon('x', 16)));
      row.addEventListener('click', async (e) => {
        const act = e.target.closest('[data-act]');
        if (act) {
          e.stopPropagation();
          const v = act.dataset.act === 'pin' ? await MD.api('/api/recent/pin', { path: r.path, pinned: !r.pinned }) : await MD.api('/api/recent/remove', { path: r.path });
          MD.app.recent = v;
          show(page);
          return;
        }
        if (r.missing) { MD.toast(r.path + ' no longer exists'); return; }
        MD.uiOpen(r.path);
      });
      table.append(row);
    }
    wrap.append(table);
    return wrap;
  }
  async function freshRecent() { try { MD.app.recent = await MD.api('/api/recent'); } catch (e) { /* keep */ } return MD.app.recent || []; }
  function sortRecent(list) { return list.slice().sort((a, b) => (b.pinned - a.pinned) || (b.opened - a.opened)); }

  // ------------------------------------------------------------------ folder browser
  /** A file browser for Open / Save As / pick a file (also used when there are no native dialogs). */
  MD.folderBrowser = (opts) => {
    const o = Object.assign({ mode: 'open', filter: 'md', dir: null, name: '', onPick: () => {} }, opts);
    const crumbs = h('div.md-fb-crumbs');
    const list = h('div.md-fb-list');
    const places = h('div.md-fb-places');
    const nameInput = o.mode === 'save' ? h('input.md-input.md-fb-filename', { value: o.name, spellcheck: false }) : null;
    let dir = o.dir;
    let selected = null;
    async function load(d) {
      let v;
      try { v = await MD.api('/api/dir?filter=' + o.filter + (d ? '&path=' + encodeURIComponent(d) : '')); }
      catch (e) { MD.toast(e.message); if (d) return load(null); return; }
      dir = v.path;
      selected = null;
      crumbs.replaceChildren();
      const parts = v.path.split(/[\\/]/);
      let acc = '';
      parts.forEach((p, i) => {
        acc = i === 0 ? (p === '' ? '/' : p + (MD.app.sep || '/')) : MD.join(acc, p);
        const target = acc;
        if (i > 0 || p !== '') crumbs.append(h('button.md-crumb', { onclick: () => load(target) }, i === 0 && p === '' ? '/' : p), h('span.md-crumb-sep', '›'));
        else crumbs.append(h('button.md-crumb', { onclick: () => load('/') }, '/'));
      });
      places.replaceChildren(...(v.places || []).map((p) => h('button.md-fb-place' + (p.path === v.path ? '.on' : ''), { onclick: () => load(p.path) }, MD.icon(p.name === 'Home' ? 'home' : 'folder', 16), p.name)));
      list.replaceChildren();
      if (v.parent) list.append(row({ name: '..', path: v.parent, dir: true, up: true }));
      for (const e of v.entries) list.append(row(e));
      if (!v.entries.length) list.append(h('div.md-empty', o.filter === 'md' ? 'No Markdown files here' : 'Empty folder'));
    }
    function row(e) {
      const r = h('div.md-fb-row' + (e.dir ? '.md-fb-dir' : ''), { tabindex: 0 },
        MD.icon(e.dir ? (e.up ? 'arrow-left' : 'folder') : /\.(md|markdown|mdown|mkd|txt|mdd|mds)$/i.test(e.name) ? 'file-md' : /\.(png|jpe?g|gif|svg|webp|avif|bmp|heic|tiff?)$/i.test(e.name) ? 'picture' : 'file', 18),
        h('span.md-fb-name', e.up ? 'Up one level' : e.name),
        h('span.md-fb-date', e.up ? '' : MD.fmtDate(e.mtime)),
        h('span.md-fb-size', e.dir ? '' : MD.fmtSize(e.size)));
      r.addEventListener('click', () => {
        if (e.dir) { load(e.path); return; }
        list.querySelectorAll('.sel').forEach((x) => x.classList.remove('sel'));
        r.classList.add('sel');
        selected = e.path;
        if (nameInput) nameInput.value = e.name;
      });
      r.addEventListener('dblclick', () => { if (!e.dir) o.onPick(e.path); });
      r.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { if (e.dir) load(e.path); else o.onPick(e.path); } });
      return r;
    }
    const newFolder = o.mode === 'save' ? h('button.md-btn', { onclick: async () => {
      const n = await MD.prompt('New folder', 'Folder name', 'New folder');
      if (!n) return;
      try { await MD.api('/api/file/save', { path: MD.join(MD.join(dir, n), '.keep'), text: '', recent: false }); load(MD.join(dir, n)); } catch (e) { MD.toast(e.message); }
    } }, 'New folder') : null;
    const action = h('button.md-btn.md-primary', { onclick: () => {
      if (o.mode === 'save') {
        let n = nameInput.value.trim();
        if (!n) { nameInput.focus(); return; }
        if (!/\.[\w]+$/.test(n)) n += o.ext || '.md';
        o.onPick(MD.join(dir, n));
      } else if (selected) o.onPick(selected);
      else MD.toast('Choose a file first');
    } }, o.mode === 'save' ? 'Save' : 'Open');
    if (nameInput) nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') action.click(); });
    const el = h('div.md-fb', h('div.md-fb-side', places), h('div.md-fb-main', crumbs, list, h('div.md-fb-foot', nameInput ? MD.field('File name', nameInput) : h('div.md-grow'), newFolder, action)));
    load(dir);
    el.load = load;
    return el;
  };

  // ------------------------------------------------------------------ pages
  /**
   * Options → Document fonts: the body font, code font and size that new documents get in
   * their front matter (mainfont, monofont, fontsize). Empty = the theme's.
   */
  function docFontsSection(sec) {
    const fontSel = (key, mono) => {
      const cur = MD.pref(key) || '';
      const s = MD.select([['', mono ? 'Theme code font' : 'Theme font'], ...(cur ? [[cur, cur]] : [])], cur);
      MD.fonts().then((fonts) => {
        const list = mono ? [...fonts.filter((f) => f.mono), ...fonts.filter((f) => !f.mono && f.sans)] : fonts;
        const groups = mono ? [['Fixed width', list.filter((f) => f.mono)], ['Sans serif', list.filter((f) => !f.mono)]] : [['All fonts', list]];
        s.replaceChildren(h('option', { value: '' }, mono ? 'Theme code font' : 'Theme font'));
        for (const [label, fs] of groups) if (fs.length) s.append(h('optgroup', { label }, fs.map((f) => h('option', { value: f.family, selected: f.family === cur, style: { fontFamily: '"' + f.family + '"' } }, f.family))));
        if (cur && !list.some((f) => f.family === cur)) s.append(h('option', { value: cur, selected: true }, cur + ' (not installed)'));
      });
      s.addEventListener('change', () => MD.setPref(key, s.value || null));
      return s;
    };
    const size = MD.select([['', 'Theme size'], ...MD.fontSizes.map((n) => [n + 'pt', n + ' pt'])], MD.pref('docFontsize') || '');
    size.addEventListener('change', () => MD.setPref('docFontsize', size.value || null));
    const applyBtn = h('button.md-btn', { title: 'Write these into the front matter of the open document' }, 'Use for the open document');
    applyBtn.addEventListener('click', () => {
      if (!MD.doc.open) { MD.toast('No document is open'); return; }
      E.setFrontMatter({ mainfont: MD.pref('docMainfont') || null, monofont: MD.pref('docMonofont') || null, fontsize: MD.pref('docFontsize') || null });
      MD.toast('Fonts set in the front matter');
    });
    return sec('Document fonts',
      h('p.md-hint', 'New documents get these at the top, in the front matter (mainfont, monofont, fontsize). Change them for one document on the Design tab.'),
      MD.field('Body font (mainfont)', fontSel('docMainfont', false)),
      MD.field('Code font (monofont)', fontSel('docMonofont', true), 'Fixed-width fonts first, then sans-serif fonts.'),
      MD.field('Font size (fontsize)', size),
      h('div.md-opt-actions', applyBtn));
  }

  const pages = {
    async home() {
      const hr = new Date().getHours();
      const greet = hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
      const list = await allTemplates();
      const featured = ['blank', 'blank-deck', 'report', 'letter', 'pitch', 'status'].map((id) => list.find((t) => t.id === id)).filter(Boolean);
      const root = h('div.md-bs-content',
        h('h1.md-bs-h1', greet),
        h('div.md-bs-section-head', h('h2', 'New'), h('button.md-link', { onclick: () => show('new') }, 'More templates →')),
        h('div.md-tpl-row', featured.map((t) => templateCard(t, true))));
      const mine = await userTemplates();
      if (mine.length) root.append(h('div.md-bs-section-head', h('h2', 'My templates'), h('button.md-link', { onclick: () => show('new') }, 'Manage templates →')), h('div.md-tpl-row', mine.slice(0, 6).map((t) => userTemplateCard(t, true))));
      // documents left unsaved by a crashed or killed window
      let rec = [];
      try { rec = await MD.api('/api/autosave/list'); } catch (e) { /* ignore */ }
      if (rec.length) {
        root.append(h('div.md-bs-section-head', h('h2', 'Recovered documents')), h('p.md-hint', 'MdCraft closed before these were saved. Open one to keep working on it.'));
        const tbl = h('div.md-recent-table');
        for (const r of rec) {
          const row = h('div.md-recent-row.md-recover', MD.icon('recover', 22), h('div.md-recent-name', h('b', r.name || 'Untitled'), h('small', (r.path || '') + ' · ' + r.chars + ' characters')), h('div.md-recent-date', MD.fmtDate(r.saved)),
            h('button.md-btn', { dataset: { act: 'open' } }, 'Open'), h('button.md-icon-btn', { title: 'Discard', dataset: { act: 'discard' } }, MD.icon('trash', 16)));
          row.addEventListener('click', async (e) => {
            const act = e.target.closest('[data-act]');
            if (act && act.dataset.act === 'discard') { if (await MD.confirm('Discard', 'Delete the recovered copy of “' + (r.name || 'Untitled') + '”?', 'Discard')) { await MD.api('/api/autosave/discard', { key: r.key }); show('home'); } return; }
            const v = await MD.api('/api/autosave/get?key=' + encodeURIComponent(r.key));
            await MD.openRecovered(v);
            await MD.api('/api/autosave/discard', { key: r.key });
          });
          tbl.append(row);
        }
        root.append(tbl);
      }
      const recent = sortRecent(await freshRecent());
      root.append(h('div.md-bs-section-head', h('h2', 'Recent'), h('button.md-link', { onclick: () => show('open') }, 'More documents →')), recentList(recent.slice(0, 12)));
      return root;
    },

    async new() {
      const list = await allTemplates();
      let filter = 'all';
      const q = h('input.md-input.md-bs-search', { type: 'search', placeholder: 'Search templates (report, letter, cv, pitch…)', spellcheck: false });
      const grid = h('div.md-tpl-grid');
      const chips = h('div.md-chips', ...[['all', 'All'], ['document', 'Documents'], ['presentation', 'Presentations']].map(([id, label]) => h('button.md-chip' + (id === 'all' ? '.on' : ''), { dataset: { f: id } }, label)));
      chips.addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; filter = b.dataset.f; chips.querySelectorAll('.md-chip').forEach((c) => c.classList.toggle('on', c === b)); draw(); });
      let mine = await userTemplates();
      async function draw() {
        let l = list;
        const query = q.value.trim().toLowerCase();
        if (query) l = await MD.api('/api/templates?q=' + encodeURIComponent(q.value.trim()));
        l = l.filter((t) => filter === 'all' || t.kind === filter);
        const docs = l.filter((t) => t.kind === 'document'), decks = l.filter((t) => t.kind === 'presentation');
        grid.replaceChildren();
        // the user's own templates first, apart from the standard ones
        const mineFilter = (t) => (filter === 'all' || t.kind === filter) && (!query || (t.name + ' ' + t.description).toLowerCase().includes(query));
        grid.append(...myTemplatesSection(mine, mineFilter, async () => { mine = await userTemplates(); draw(); }));
        grid.append(h('div.md-bs-section-head', h('h2', 'Standard templates')));
        if (docs.length) grid.append(h('h3.md-tpl-cat', 'Documents'), h('div.md-tpl-cards', docs.map((t) => templateCard(t))));
        if (decks.length) grid.append(h('h3.md-tpl-cat', 'Presentations'), h('div.md-tpl-cards', decks.map((t) => templateCard(t))));
        if (!l.length) grid.append(h('p.md-empty', 'No standard templates match “' + q.value + '”.'));
        MDIcons.fill(grid);
      }
      q.addEventListener('input', draw);
      draw();
      return h('div.md-bs-content', h('h1.md-bs-h1', 'New'), h('div.md-bs-toolbar', q, chips), grid);
    },

    async open() {
      const recent = sortRecent(await freshRecent());
      const right = h('div.md-bs-open-right');
      const nav = h('div.md-bs-open-nav');
      const setMode = (m) => {
        nav.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
        if (m === 'recent') right.replaceChildren(h('h2', 'Recent documents'), recentList(recent));
        else if (m === 'pinned') right.replaceChildren(h('h2', 'Pinned'), recentList(recent.filter((r) => r.pinned), { empty: 'Pin documents you use often: hover a recent document and click the pin.' }));
        else right.replaceChildren(h('h2', 'Browse this computer'), MD.folderBrowser({ mode: 'open', dir: MD.doc && MD.doc.saved ? MD.dirname(MD.doc.path) : null, onPick: (p) => MD.uiOpen(p) }));
        MDIcons.fill(right);
      };
      nav.append(
        h('button', { dataset: { m: 'recent' } }, MD.icon('clock', 22), 'Recent'),
        h('button', { dataset: { m: 'pinned' } }, MD.icon('pin', 22), 'Pinned'),
        h('button', { dataset: { m: 'browse' } }, MD.icon('folder', 22), 'This computer'),
        MD.isNative() ? h('button', { onclick: () => MD.openDialog(true) }, MD.icon('folder-open', 22), 'Browse…') : null);
      nav.addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (b) setMode(b.dataset.m); });
      setMode(recent.length ? 'recent' : 'browse');
      return h('div.md-bs-content', h('h1.md-bs-h1', 'Open'), h('div.md-bs-open', nav, right));
    },

    async info() {
      if (!MD.doc.open) return h('div.md-bs-content', h('h1.md-bs-h1', 'Info'), h('p.md-empty', 'No document is open.'));
      const fm = E.frontMatter();
      const st = MD.stats();
      const fields = [['title', 'Title'], ['subtitle', 'Subtitle'], ['author', 'Author'], ['date', 'Date'], ['description', 'Description'], ['keywords', 'Keywords']];
      const inputs = {};
      const form = h('div.md-info-form', fields.map(([k, label]) => { inputs[k] = h('input.md-input', { value: fm[k] || '', placeholder: k === 'author' ? MD.app.author : '' }); return MD.field(label, inputs[k]); }));
      const themeSel = MD.select([['', '(default)'], ...MD.themes.map((t) => [t.id, t.name + (t.kind === 'deck' ? ' (slides)' : '')])], fm.theme || '');
      form.append(MD.field('Theme', themeSel));
      const apply = h('button.md-btn.md-primary', { onclick: () => {
        const pairs = {}; for (const [k] of fields) pairs[k] = inputs[k].value.trim() || null;
        pairs.theme = themeSel.value || null;
        E.setFrontMatter(pairs);
        MD.toast('Properties updated');
      } }, 'Apply');
      const statRows = [['Words', st.words], ['Characters', st.chars], ['Characters (no spaces)', st.charsNoSpace], ['Paragraphs', st.paragraphs], ['Headings', st.headings], ['Slides', st.slides || '—'], ['Reading time', st.readMin + ' min'], st.slides ? ['Speaking time', st.speakMin + ' min'] : null].filter(Boolean);
      return h('div.md-bs-content', h('h1.md-bs-h1', 'Info'),
        h('div.md-info',
          h('div.md-info-main', h('h2', MD.doc.name), h('p.md-hint', MD.doc.saved ? MD.doc.path : 'Not saved yet'),
            h('div.md-bs-toolbar', MD.doc.saved && MD.isNative() ? h('button.md-btn', { onclick: () => MD.native('reveal', { path: MD.doc.path }) }, MD.icon('folder-open', 18), 'Open file location') : null,
              h('button.md-btn', { onclick: () => MD.run('review.accessibility') }, MD.icon('accessibility', 18), 'Check accessibility')),
            h('h3', 'Properties'), h('p.md-hint', 'Stored as front matter at the top of the Markdown file.'), form, h('div.md-bs-toolbar', apply)),
          h('div.md-info-side', h('h3', 'Statistics'), h('table.md-stats', statRows.map(([k, v]) => h('tr', h('th', k), h('td', String(v))))))));
    },

    async print() {
      const deck = MD.isDeck();
      const fm = E.frontMatter();
      const paper = MD.select([['a4', 'A4'], ['letter', 'Letter'], ['a5', 'A5'], ['legal', 'Legal']], fm.paper || 'a4');
      const orient = MD.select([['portrait', deck ? 'Portrait — slide and its notes on one page' : 'Portrait'], ['landscape', deck ? 'Landscape — full-page slides' : 'Landscape']], fm.orientation || (deck ? 'landscape' : 'portrait'));
      const margins = MD.select([['normal', 'Normal'], ['narrow', 'Narrow'], ['wide', 'Wide']], fm.margins || 'normal');
      const save = () => E.setFrontMatter({ paper: paper.value === 'a4' ? null : paper.value, orientation: orient.value === (deck ? 'landscape' : 'portrait') && !deck ? null : orient.value, margins: margins.value === 'normal' ? null : margins.value });
      [paper, orient, margins].forEach((s) => s.addEventListener('change', save));
      const preview = h('div.md-print-preview.paper-' + (fm.paper || 'a4') + (orient.value === 'landscape' ? '.landscape' : ''));
      const clone = document.getElementById('ml-content').cloneNode(true);
      clone.removeAttribute('id');
      preview.append(h('div.md-print-sheet', clone));
      return h('div.md-bs-content', h('h1.md-bs-h1', 'Print'),
        h('div.md-print',
          h('div.md-print-opts',
            h('button.md-big-btn', { onclick: () => { MD.closeBackstage(); setTimeout(() => ML.print(), 50); } }, MD.icon('printer', 36), h('span', 'Print')),
            h('p.md-hint', 'Choose “Save as PDF” (or “Print to File”) in the print dialog to make a PDF.'),
            MD.field('Paper', paper), MD.field('Orientation', orient), MD.field('Margins', margins),
            deck ? h('p.md-hint', 'Slides print one per page; speaker notes print under their slide in portrait, or on the next page in landscape.') : h('p.md-hint', 'Page breaks: Insert › Page break (' + MD.keyLabel('Mod+Enter') + ').')),
          preview));
    },

    async export() {
      const card = (icon, title, desc, run) => { const b = h('button.md-export-card', h('span.md-export-ic', MD.icon(icon, 32)), h('span', h('b', title), h('small', desc))); b.addEventListener('click', run); return b; };
      return h('div.md-bs-content', h('h1.md-bs-h1', 'Export'),
        h('div.md-export',
          card('web', 'Web page (.html)', 'One self-contained file with the rendered diagrams, math and styles. Opens in any browser.', () => MD.exportHtml()),
          card('pdf', 'PDF', 'Print with “Save as PDF”. Uses the page size, margins and theme of the document.', () => MD.exportPdf()),
          card('clipboard-rich', 'Copy as formatted text', 'Paste into Word, Outlook, Google Docs or an email with the formatting kept.', () => MD.copyRich())),
        h('p.md-hint', 'To save the Markdown under another name, or as a template, use File › Save As.'));
    },

    async options() {
      const P = MD.app.prefs;
      const ui = P.ui || {}, rd = P.render || {};
      const sec = (title, ...kids) => h('section.md-opt-sec', h('h2', title), ...kids);
      const cb = (label, key, hint, render) => { const c = MD.checkbox(label, render ? rd[key] ?? defaultsR[key] : MD.pref(key), hint); c.input.addEventListener('change', () => (render ? MD.setRenderPref(key, c.input.checked) : MD.setPref(key, c.input.checked))); return c; };
      const sel = (label, key, options, hint, render) => { const s = MD.select(options, render ? rd[key] ?? defaultsR[key] : MD.pref(key)); s.addEventListener('change', () => (render ? MD.setRenderPref(key, s.value) : MD.setPref(key, s.value))); return MD.field(label, s, hint); };
      const txt = (label, key, placeholder, hint, render) => { const i = h('input.md-input', { value: (render ? rd[key] : ui[key]) || '', placeholder: placeholder || '', spellcheck: false }); i.addEventListener('change', () => (render ? MD.setRenderPref(key, i.value.trim() || null) : MD.setPref(key, i.value.trim() || null))); return MD.field(label, i, hint); };
      const defaultsR = { breaks: false, typographer: false, emoji: true, enableScriptExecution: false, scrollSync: true };
      return h('div.md-bs-content.md-options', h('h1.md-bs-h1', 'Options'),
        sec('General',
          txt('Your name', 'author', MD.app.author, 'Used by templates and new slides ({{author}}).'),
          sel('Appearance', 'appearance', [['system', 'Use system setting'], ['light', 'Light'], ['dark', 'Dark']]),
          sel('Start with', 'startup', [['start', 'The start page'], ['blank', 'A blank document'], ['last', 'The last document']]),
          cb('Save automatically while I type (saved documents)', 'autosave', 'Unsaved documents are always kept for recovery.')),
        docFontsSection(sec),
        sec('Editor',
          sel('Font', 'editorFont', [['mono', 'Monospace (JetBrains Mono)'], ['sans', 'Sans serif (Source Sans 3)'], ['serif', 'Serif (Source Serif 4)']]),
          sel('Font size', 'editorFontSize', [12, 13, 14, 15, 16, 17, 18, 20, 22].map((n) => [n, n + ' px'])),
          cb('Line numbers', 'lineNumbers'), cb('Word wrap', 'wrap'), cb('Check spelling as you type', 'spellcheck'), cb('Close brackets and quotes automatically', 'closeBrackets')),
        sec('Preview',
          cb('Scroll the preview with the cursor', 'sync'),
          sel('Math', 'math', [['katex', 'KaTeX (fast)'], ['mathjax', 'MathJax (more complete LaTeX)']], null, true),
          sel('Diagram theme', 'mermaidTheme', [['auto', 'Follow the appearance'], ['default', 'Default'], ['neutral', 'Neutral'], ['forest', 'Forest'], ['dark', 'Dark'], ['base', 'Base']], null, true),
          sel('Front matter', 'frontMatter', [['none', 'Hidden'], ['table', 'As a table'], ['code', 'As YAML']], 'How the --- block at the top shows in the preview.', true),
          cb('A single line break starts a new line', 'breaks', 'Off: a blank line starts a new paragraph (standard Markdown).', true),
          cb('Smart quotes and dashes', 'typographer', null, true),
          cb('Emoji shortcodes (:smile:)', 'emoji', null, true)),
        sec('Code, diagrams and media',
          cb('Run code chunks (```python {cmd=true})', 'enableScriptExecution', 'Runs code from documents on this computer. Only turn on for documents you trust.', true),
          txt('Python', 'python', 'python3 (or the folder\'s .venv)', null, true),
          sel('PlantUML', 'plantumlRender', [['local', 'On this computer (Java + plantuml.jar)'], ['online', 'Online (plantuml.com)'], ['auto', 'Local when available, else online']], 'Mermaid, Graphviz, charts and math never leave this computer.', true),
          txt('plantuml.jar', 'plantumlJar', 'detected automatically', null, true),
          txt('Kroki server', 'krokiServer', 'https://kroki.io', 'Only used by ```kroki-… blocks.', true)),
        h('p.md-hint', 'Preferences are saved in ', h('code', (MD.app.configDir || 'your settings folder') + ''), '.'));
    },

    async about() {
      const ext = (url, label) => h('a', { href: url, onclick: (e) => { e.preventDefault(); MD.openExternal(url); } }, label || url);
      return h('div.md-bs-content.md-about',
        h('div.md-about-head', h('span.md-about-logo', MD.icon('logo', 72)), h('div', h('h1', 'MdCraft'), h('p', 'Version ' + MD.app.version + ' · ' + MD.app.platform), h('p.md-hint', 'Write in Markdown, get Word-style documents and PowerPoint-style slides.'))),
        h('h2', 'Built from'),
        h('ul',
          h('li', h('b', 'WordCraft'), ' — the application template: workspace layout, the ribbon and File view, design tokens, conventions (MIT OR Apache-2.0, © ArtCraft Team and the WordCraft contributors). ', ext('https://github.com/storytold/wordcraft')),
          h('li', h('b', 'MarkDown Live'), ' — the Markdown renderer and live preview: diagrams, math, charts, CSV, code chunks, media, slides (MIT, © Kris Dugardyn).')),
        h('h2', 'Open-source components'),
        h('p.md-hint', 'comrak, tao, wry, CodeMirror, Mermaid, KaTeX, MathJax, highlight.js, Chart.js, Vega, Plotly, Viz.js (Graphviz), WaveDrom, flowchart.js, SmilesDrawer, Mol*, morphdom. Fonts: Inter, Source Sans 3, Source Serif 4, JetBrains Mono (SIL Open Font License). See THIRD_PARTY_NOTICES.md.'),
        h('p.md-hint', 'MdCraft is independent and not affiliated with Microsoft. Word and PowerPoint are trademarks of Microsoft Corporation, named only to describe the kind of documents the templates resemble.'),
        h('div.md-bs-toolbar', h('button.md-btn', { onclick: () => MD.run('help.shortcuts') }, MD.icon('keyboard', 18), 'Keyboard shortcuts'), h('button.md-btn', { onclick: () => MD.run('help.markdown') }, MD.icon('help', 18), 'Markdown tour')));
    },
  };
})();
