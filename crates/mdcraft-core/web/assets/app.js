/* mdcraft — the application: the open document, files, views, panes, status bar,
 * preferences, export and the native shell's events. Loaded last. */
(function () {
  'use strict';
  const MD = window.MD;
  const ML = window.ML;
  const E = MD.editor;
  const { h } = MD;
  const $ = (id) => document.getElementById(id);
  const content = $('ml-content');

  // ================================================================== preferences
  const DEFAULTS = { darkPage: false, wrap: true, lineNumbers: false, spellcheck: true, sync: true, appearance: 'system', editorFont: 'mono', editorFontSize: 15,
    view: 'split', nav: false, navTab: 'outline', ribbonCollapsed: false, autosave: false, closeBrackets: false, startup: 'start', zoom: 1, split: 50 };
  MD.pref = (k) => { const ui = (MD.app && MD.app.prefs && MD.app.prefs.ui) || {}; return k in ui ? ui[k] : DEFAULTS[k]; };
  let prefTimer = null, prefPatch = {};
  MD.setPref = (k, v) => {
    MD.app.prefs.ui[k] = v;
    prefPatch[k] = v;
    clearTimeout(prefTimer);
    prefTimer = setTimeout(() => { const p = prefPatch; prefPatch = {}; MD.api('/api/prefs', { ui: p }).catch((e) => MD.toast(e.message)); }, 300);
    applyPref(k);
    MD.refreshRibbon();
  };
  MD.setRenderPref = async (k, v) => {
    try { MD.app.prefs = await MD.api('/api/prefs', { render: { [k]: v } }); } catch (e) { MD.toast(e.message); }
    if (k === 'math') { try { localStorage.removeItem('ml.math'); } catch (e) { /* ignore */ } ML.rerender(); }
  };
  function applyPref(k) {
    const v = MD.pref(k);
    switch (k) {
      case 'wrap': case 'lineNumbers': case 'spellcheck': case 'closeBrackets': E.setOption(k, !!v); break;
      case 'sync': ML.setSync(!!v); break;
      case 'appearance': {
        const dark = v === 'dark' || ((!v || v === 'system') && matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.dataset.ui = dark ? 'dark' : 'light';
        if (MD.isNative()) MD.native('theme', { dark });
        break;
      }
      case 'darkPage': ML.setThemePref(v ? 'dark' : 'light'); break;
      case 'editorFont': case 'editorFontSize': {
        const fam = { mono: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace', sans: '"Source Sans 3", "Segoe UI", sans-serif', serif: '"Source Serif 4", Georgia, serif' }[MD.pref('editorFont')] || 'monospace';
        $('md-editor').style.setProperty('--ed-font', fam);
        $('md-editor').style.setProperty('--ed-size', MD.pref('editorFontSize') + 'px');
        break;
      }
      case 'ribbonCollapsed': document.body.classList.toggle('md-ribbon-collapsed', !!v); $('md-collapse').innerHTML = MDIcons.icon(v ? 'chevron-down' : 'chevron-up', 18); break;
      case 'split': $('md-main').style.setProperty('--split', v + '%'); break;
      default: break;
    }
  }

  // ================================================================== the document
  const doc = MD.doc = { open: false, path: '', name: '', saved: false, dirty: false, key: '', lastSaved: null };
  let untitledN = { document: 0, presentation: 0 };

  function newKey() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function setDoc(fields, text) {
    Object.assign(doc, { open: true, dirty: false, lastSaved: null }, fields);
    if (!doc.key) doc.key = newKey();
    E.set(text);
    pushNow();
    updateTitle();
    updateStatus();
    if (MD.backstageOpen()) MD.closeBackstage();
    document.body.classList.toggle('md-no-document', false);
    MD.refreshRibbon();
    setTimeout(() => E.focus(), 30);
  }

  /** Asks to save a changed document. Resolves true when it's fine to go on. */
  MD.confirmDiscard = async () => {
    if (!doc.open || !doc.dirty) return true;
    const v = await MD.dialog({
      title: 'MdCraft',
      body: h('div', h('p.md-dlg-text', h('b', 'Do you want to save the changes to “' + doc.name + '”?')), h('p.md-hint', 'Your changes will be lost if you don’t save them.')),
      buttons: [{ label: 'Don’t Save', value: 'discard', left: true }, { label: 'Cancel', value: null }, { label: 'Save', value: 'save', primary: true }],
    });
    if (v === 'save') return await MD.save();
    if (v === 'discard') { discardAutosave(); return true; }
    return false;
  };

  /**
   * The template text with the default fonts from Options added to its front matter
   * (mainfont, monofont, fontsize; keys the template sets itself are kept). Presentations get
   * the fonts but not the size: slides size their text themselves.
   */
  MD.withDefaultFonts = (text, kind) => {
    const want = [['mainfont', MD.pref('docMainfont')], ['monofont', MD.pref('docMonofont')]];
    if (kind !== 'presentation') want.push(['fontsize', MD.pref('docFontsize')]);
    const add = want.filter(([, v]) => v);
    if (!add.length) return text;
    const m = /^---\r?\n([\s\S]*?)\r?\n(---|\.\.\.)\r?\n?/.exec(text);
    const has = (k) => m && new RegExp('^' + k + '\\s*:', 'm').test(m[1]);
    const lines = add.filter(([k]) => !has(k)).map(([k, v]) => k + ': ' + v);
    if (!lines.length) return text;
    if (m) return text.slice(0, m.index) + '---\n' + m[1] + '\n' + lines.join('\n') + '\n' + m[2] + '\n' + text.slice(m.index + m[0].length);
    return '---\n' + lines.join('\n') + '\n---\n\n' + text;
  };

  /** A new document from one of the user's templates (.mdd / .mds). */
  MD.newFromUserTemplate = async (path) => {
    if (!(await MD.confirmDiscard())) return;
    let t;
    try { t = await MD.api('/api/user-template?path=' + encodeURIComponent(path)); } catch (e) { MD.toast(e.message); return; }
    const kind = t.kind === 'presentation' ? 'presentation' : 'document';
    const n = ++untitledN[kind];
    const name = (kind === 'presentation' ? 'Presentation ' : 'Document ') + n + '.md';
    setDoc({ path: MD.join(MD.app.documents, name), name, saved: false, key: newKey(), template: null, newTemplate: false }, t.text);
    if (kind === 'presentation' && MD.currentTab() === 'home') MD.selectTab('slides');
  };
  /** Starts a new custom template (from the blank document or blank deck); saving it puts it in
   *  the templates folder (Save As, File type: Markdown template). */
  MD.newTemplate = async (kind) => {
    await MD.newFromTemplate(kind === 'presentation' ? 'blank-deck' : 'blank');
    if (!doc.open) return;
    const ext = kind === 'presentation' ? 'mds' : 'mdd';
    doc.newTemplate = true;
    doc.name = (kind === 'presentation' ? 'New slide template.' : 'New document template.') + ext;
    doc.path = MD.join(MD.app.templatesDir, doc.name);
    updateTitle(); updateStatus();
    MD.toast('A new template: write it, then save it (⌘S) to add it to My templates.', 6000);
  };

  MD.newFromTemplate = async (id) => {
    if (!(await MD.confirmDiscard())) return;
    let t;
    try { t = await MD.api('/api/template?id=' + encodeURIComponent(id)); } catch (e) { MD.toast(e.message); return; }
    const kind = t.kind === 'presentation' ? 'presentation' : 'document';
    const base = kind === 'presentation' ? 'Presentation' : 'Document';
    const n = ++untitledN[kind];
    const name = base + ' ' + n + '.md';
    setDoc({ path: MD.join(MD.app.documents, name), name, saved: false, key: newKey(), template: id, newTemplate: false }, MD.withDefaultFonts(t.text, kind));
    if (kind === 'presentation' && MD.currentTab() === 'home') MD.selectTab('slides');
  };

  MD.openPath = async (path) => {
    if (doc.open && doc.saved && doc.path === path) { MD.closeBackstage(); return; }
    if (!(await MD.confirmDiscard())) return;
    let f;
    try { f = await MD.api('/api/file?path=' + encodeURIComponent(path)); } catch (e) { MD.alert('Cannot open', e.message); return; }
    setDoc({ path: f.path, name: f.name, saved: true, key: newKey(), diskStamp: f.stamp, keptOverDisk: false }, f.text);
    doc.savedText = f.text;
    MD.app.recent = null;
  };
  /** The version of a file changed elsewhere, as a new unsaved document (next to the original,
   *  so its pictures still show). */
  MD.openCopy = async (path) => {
    let f;
    try { f = await MD.api('/api/file?recent=0&path=' + encodeURIComponent(path)); } catch (e) { MD.alert('Cannot open', e.message); return; }
    const name = f.name.replace(/\.(md|markdown|mdown|mkd|txt)$/i, '') + ' (changed on disk).md';
    setDoc({ path: MD.join(MD.dirname(f.path), name), name, saved: false, key: newKey(), diskStamp: null, keptOverDisk: false }, f.text);
    doc.dirty = true; updateTitle(); updateStatus();
    MD.toast('The version of “' + f.name + '” changed by another application, as a new document. Save it to keep it.', 6000);
  };

  // ================================================================== changes made by other applications
  // The open file is checked every 1.5 s, when the window gets focus and just before saving.
  // When another application changed it, MdCraft asks what to do with the two versions.
  let diskBusy = false, saving = 0;
  /** Resolves 'same' (nothing to do), 'busy', or the choice made: 'reload', 'merge', 'window', 'keep'. */
  async function checkDisk(beforeSave) {
    if (!doc.open || !doc.saved || !doc.diskStamp) return 'same';
    if (diskBusy) return 'busy';
    if (!beforeSave && (saving || MD.dialogOpen() || (MD.presenting && MD.presenting()))) return 'same'; // ask later
    diskBusy = true;
    try {
      const path = doc.path;
      let st;
      try { st = await MD.api('/api/file/stat?path=' + encodeURIComponent(path)); } catch (e) { return 'same'; }
      if (path !== doc.path || st.stamp === doc.diskStamp) return 'same';
      if (!st.exists) {
        if (doc.diskStamp !== 'missing') {
          doc.diskStamp = 'missing'; doc.keptOverDisk = true; doc.dirty = true; updateTitle(); updateStatus();
          MD.toast('“' + doc.name + '” was moved or deleted by another application. Save to keep it.', 6000);
        }
        return 'same';
      }
      let f;
      try { f = await MD.api('/api/file?recent=0&path=' + encodeURIComponent(path)); } catch (e) { return 'same'; }
      if (path !== doc.path) return 'same';
      const disk = f.text, mine = E.get();
      if (disk === mine || disk === doc.savedText) {
        // only touched, or changed to exactly what is in the editor
        doc.diskStamp = f.stamp;
        if (disk === mine) { doc.savedText = disk; doc.keptOverDisk = false; doc.dirty = false; updateTitle(); updateStatus(); }
        return 'same';
      }
      const dirty = doc.dirty;
      const choice = await MD.dialog({
        title: 'MdCraft',
        width: 600,
        body: h('div',
          h('p.md-dlg-text', h('b', '“' + doc.name + '” was changed by another application.')),
          h('p.md-hint', dirty
            ? 'You also have unsaved changes. Merge combines both versions (conflicts are marked in the text), Reload discards your changes, Open in New Window shows the other version as a new document.'
            : 'Reload shows the new version here. Open in New Window shows it as a new document and keeps this one as it is.')),
        buttons: [
          { label: 'Keep Mine', value: 'keep', left: true },
          MD.isNative() ? { label: 'Open in New Window', value: 'window' } : null,
          { label: dirty ? 'Reload (Discard Mine)' : 'Reload', value: 'reload', primary: !dirty, danger: dirty },
          dirty ? { label: 'Merge', value: 'merge', primary: true } : null,
        ].filter(Boolean),
      }) || 'keep';
      if (path !== doc.path) return 'same';
      if (choice === 'reload') {
        doc.savedText = disk;
        E.replaceAll(disk);
        Object.assign(doc, { diskStamp: f.stamp, keptOverDisk: false, dirty: false });
        discardAutosave();
        MD.toast('Reloaded “' + doc.name + '”. Undo brings your version back.');
      } else if (choice === 'merge') {
        let r;
        try { r = await MD.api('/api/merge', { base: doc.savedText || '', ours: E.get(), theirs: disk }); } catch (e) { MD.alert('Cannot merge', e.message); return 'keep'; }
        doc.savedText = disk;
        E.replaceAll(r.text);
        Object.assign(doc, { diskStamp: f.stamp, keptOverDisk: false, dirty: r.text !== disk });
        if (r.conflicts) {
          E.find('<<<<<<< Your changes');
          MD.alert('Merged with conflicts', (r.conflicts === 1 ? 'One place was' : r.conflicts + ' places were') + ' changed in both versions. Each is marked between “<<<<<<< Your changes” and “>>>>>>> Changed on disk”: keep what you want, remove the markers, then save.');
        } else {
          MD.toast(doc.dirty ? 'Merged both versions. Save to keep the result.' : 'Merged: both versions are the same.', 5000);
        }
      } else {
        if (choice === 'window') MD.native('new-window', { path, copy: true });
        // the editor's version stays; saving it replaces the other one
        Object.assign(doc, { diskStamp: f.stamp, keptOverDisk: true, dirty: true });
      }
      updateTitle(); updateStatus();
      return choice;
    } finally { diskBusy = false; }
  }
  MD.checkDisk = checkDisk;
  setInterval(() => { if (MD.booted) checkDisk(false); }, 1500);
  addEventListener('focus', () => { if (MD.booted) checkDisk(false); });
  MD.openRecovered = async (v) => {
    if (!(await MD.confirmDiscard())) return;
    const name = v.name || 'Recovered.md';
    setDoc({ path: v.path || MD.join(MD.app.documents, name), name, saved: false, key: newKey() }, v.text || '');
    doc.dirty = true; updateTitle(); updateStatus();
    MD.toast('Recovered “' + name + '”. Save it to keep it.', 5000);
  };

  MD.openDialog = async (forceNative) => {
    if (MD.isNative()) {
      try {
        const p = await MD.native('open-dialog', { title: 'Open', filters: [['Markdown', ['md', 'markdown', 'mdown', 'mkd', 'txt']], ['Markdown templates', ['mdd', 'mds']], ['All files', ['*']]], dir: doc.saved ? MD.dirname(doc.path) : MD.app.documents });
        if (p) MD.openPath(p);
        return;
      } catch (e) { if (forceNative) { MD.toast(e.message); return; } }
    }
    MD.openBackstage('open');
  };

  MD.suggestName = () => {
    if (doc.saved || doc.newTemplate) return doc.name;
    const fm = E.frontMatter();
    let t = fm.title || (/^#\s+(.+)$/m.exec(E.get().replace(/^---[\s\S]*?\n---\n/, '')) || [])[1] || doc.name.replace(/\.md$/, '');
    t = t.replace(/[\\/:*?"<>|#]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Document';
    return t + '.md';
  };

  MD.save = async () => {
    if (!doc.open) return false;
    if (!doc.saved) return await MD.saveAs();
    return await MD.saveTo(doc.path, true);
  };
  // ------------------------------------------------------------------ Save As
  // The system's Save window with a File type: "Markdown file (.md)" or "Markdown template".
  // A template is .mdd (document) or .mds (slides), whichever the document is, and goes to the
  // templates folder (File › New › My templates).
  MD.isTemplatePath = (p) => /\.(mdd|mds)$/i.test(p || '');
  MD.saveTypes = () => {
    const tExt = MD.isDeck() ? 'mds' : 'mdd';
    return [
      { label: 'Markdown file (.md)', ext: 'md', dir: null },
      { label: (tExt === 'mds' ? 'Markdown slide template' : 'Markdown document template') + ' (.' + tExt + ')', ext: tExt, dir: MD.app.templatesDir },
    ];
  };
  /** opts.template: preselect the template type (default: when the document is one). */
  MD.saveAs = async (opts) => {
    if (!doc.open) return false;
    const asTemplate = opts && opts.template !== undefined ? !!opts.template : (MD.isTemplatePath(doc.path) || !!doc.newTemplate);
    const types = MD.saveTypes();
    const type = asTemplate ? 1 : 0;
    const name = MD.suggestName().replace(/\.[\w]+$/, '') + '.' + types[type].ext;
    const dir = asTemplate ? MD.app.templatesDir : (doc.saved && !MD.isTemplatePath(doc.path) ? MD.dirname(doc.path) : MD.app.documents);
    // Templates always go to the templates folder (File › New › My templates lists that folder):
    // whatever folder was browsed to, only the file name is used.
    const done = async (p, askedOverwrite) => {
      let target = p;
      if (MD.isTemplatePath(p)) {
        target = MD.join(MD.app.templatesDir, MD.basename(p));
        if (target !== doc.path && (target !== p || !askedOverwrite)) {
          let exists = false;
          try { exists = (await MD.api('/api/file/stat?path=' + encodeURIComponent(target))).exists; } catch (e) { /* ignore */ }
          if (exists && !(await MD.confirm('Replace template', 'You already have a template called “' + MD.basename(target).replace(/\.(mdd|mds)$/i, '') + '”. Replace it?', 'Replace'))) return false;
        }
      }
      const ok = await MD.saveTo(target);
      if (ok && MD.isTemplatePath(target)) {
        doc.newTemplate = false;
        MD.toast(target !== p ? 'Templates are kept in My templates: saved there as “' + MD.basename(target) + '”.' : 'Saved as a template. Find it under File › New › My templates.', 6000);
      }
      return ok;
    };
    if (MD.isNative()) {
      try {
        const r = await MD.native('save-dialog', { title: 'Save As', name, dir, types, type });
        if (!r) return false;
        if (typeof r === 'string') return await done(/\.[\w]+$/.test(MD.basename(r)) ? r : r + '.' + types[type].ext, true); // an older shell
        return await done(r.path, true);
      } catch (e) { /* no native dialog: the in-app one */ }
    }
    return await saveAsDialog(types, type, name, dir, done);
  };
  /** Save As in a browser tab (mdcraft-cli serve): a folder browser with the same File type choice. */
  function saveAsDialog(types, type, name, dir, done) {
    return new Promise((resolve) => {
      let close = () => {};
      let cur = type;
      const typeSel = MD.select(types.map((t, i) => [i, t.label]), cur);
      const holder = h('div.md-saveas-browser');
      const browser = (d) => {
        if (types[cur].dir) {
          // a template: always the templates folder, so only a name to type
          const input = h('input.md-input.md-fb-filename', { value: name.replace(/\.[\w]+$/, '') + '.' + types[cur].ext, spellcheck: false });
          const save = async () => { let n = input.value.trim(); if (!n) { input.focus(); return; } n = n.replace(/\.[\w]+$/, '') + '.' + types[cur].ext; if (await done(MD.join(types[cur].dir, n), false)) { close(true); resolve(true); } };
          input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
          holder.replaceChildren(h('p.md-hint', 'Templates are always saved in My templates (' + types[cur].dir + ').'),
            h('div.md-fb-foot', MD.field('File name', input), h('button.md-btn.md-primary', { onclick: save }, 'Save')));
          setTimeout(() => input.focus(), 0);
          return;
        }
        const fb = MD.folderBrowser({ mode: 'save', dir: d, name: name.replace(/\.[\w]+$/, '') + '.' + types[cur].ext, ext: '.' + types[cur].ext, filter: 'md',
          onPick: async (p) => { const fixed = p.replace(/\.[\w]+$/, '') + '.' + types[cur].ext; if (await done(fixed, false)) { close(true); resolve(true); } } });
        holder.replaceChildren(fb);
      };
      typeSel.addEventListener('change', () => {
        const nameInput = holder.querySelector('.md-fb-filename');
        if (nameInput) name = nameInput.value;
        cur = +typeSel.value;
        browser(types[cur].dir || dir);
      });
      browser(dir);
      MD.dialog({ title: 'Save As', width: 820, body: h('div', MD.field('File type', typeSel), holder), buttons: null, onOpen: (d, c) => { close = c; } })
        .then(() => resolve(false));
    });
  }
  MD.saveTo = async (path, quiet) => {
    // Don't silently overwrite what another application just wrote.
    if (doc.saved && path === doc.path) {
      const c = await checkDisk(true);
      if (c === 'busy' || c === 'reload' || c === 'merge') return false;
    }
    const text = E.get();
    saving++;
    try {
      const r = await MD.api('/api/file/save', { path, text });
      const moved = r.path !== doc.path;
      Object.assign(doc, { path: r.path, name: r.name, saved: true, dirty: E.get() !== text, lastSaved: Date.now(), savedText: text, diskStamp: r.stamp, keptOverDisk: false });
      if (moved) pushNow();
      discardAutosave();
      updateTitle(); updateStatus();
      if (!quiet) MD.toast('Saved ' + r.name);
      return true;
    } catch (e) { MD.alert('Cannot save', e.message); return false; } finally { saving--; }
  };
  MD.closeDocument = async () => {
    if (!(await MD.confirmDiscard())) return;
    doc.open = false; doc.dirty = false; doc.path = ''; doc.name = ''; doc.saved = false;
    E.set('');
    content.innerHTML = '';
    document.body.classList.add('md-no-document');
    updateTitle(); updateStatus();
    MD.openBackstage('home');
  };
  MD.newWindow = () => { if (MD.isNative()) MD.native('new-window', {}); else MD.toast('New windows are available in the desktop app'); };

  // ------------------------------------------------------------------ syncing the text with the renderer
  let pushTimer = null;
  function pushNow() {
    clearTimeout(pushTimer);
    if (!doc.open) return;
    MD.api('/api/doc', { path: doc.path, text: E.get() }).catch((e) => console.warn(e));
  }
  let autosaveTimer = null, recoveryTimer = null;
  MD.onEditorChange = () => {
    if (!doc.open) {
      // typing on the empty start canvas makes a new document
      Object.assign(doc, { open: true, path: MD.join(MD.app.documents, 'Document ' + (++untitledN.document) + '.md'), name: 'Document ' + untitledN.document + '.md', saved: false, key: newKey() });
      document.body.classList.remove('md-no-document');
    }
    doc.dirty = doc.savedText === undefined || E.get() !== doc.savedText || !doc.saved || !!doc.keptOverDisk;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 70);
    updateTitle();
    scheduleStatus();
    clearTimeout(recoveryTimer);
    recoveryTimer = setTimeout(writeAutosave, 4000);
    if (MD.pref('autosave') && doc.saved) { clearTimeout(autosaveTimer); autosaveTimer = setTimeout(() => { if (doc.dirty && doc.saved) MD.saveTo(doc.path, true); }, 2500); }
  };
  function writeAutosave() {
    if (!doc.open || !doc.dirty) return;
    MD.api('/api/autosave', { key: doc.key, path: doc.path, name: doc.name, text: E.get() }).catch(() => {});
  }
  function discardAutosave() { if (doc.key) MD.api('/api/autosave', { key: doc.key, text: null }).catch(() => {}); clearTimeout(recoveryTimer); }

  let cursorTimer = null;
  MD.onEditorCursor = () => {
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => {
      const p = E.cursorPos();
      $('md-st-pos').textContent = 'Ln ' + p.line + ', Col ' + p.col + (p.sel ? ' (' + p.sel + ' selected)' : '');
      if (MD.pref('sync') && MD.view() === 'split') ML.cursor(p.line - 1);
      MD.refreshRibbon();
      markNavCurrent();
      if (MD.isDeck()) $('md-st-slides').textContent = 'Slide ' + E.currentSlide() + ' of ' + E.slideCount();
    }, 40);
  };

  // pictures dropped or pasted into the editor
  MD.onEditorPaste = () => false;
  MD.onEditorDrop = (e) => {
    if (MD.isNative()) { e.preventDefault(); return true; } // the shell delivers dropped paths
    return false;
  };

  // ================================================================== title and status bar
  MD.updateTitle = () => updateTitle();
  function updateTitle() {
    const name = doc.open ? doc.name : 'MdCraft';
    const t = doc.open ? (doc.dirty ? '• ' : '') + name + ' — MdCraft' : 'MdCraft';
    document.title = t;
    const dn = $('md-docname');
    dn.textContent = doc.open ? name.replace(/\.md$/, '') + (doc.saved ? (doc.dirty ? ' • Edited' : ' • Saved') : ' • Not saved') : '';
    dn.title = doc.saved ? doc.path : 'Not saved yet';
    if (MD.isNative()) MD.native('set-title', { title: t });
    $('md-st-save').textContent = !doc.open ? '' : !doc.saved ? 'Not saved yet' : doc.dirty ? 'Edited' : 'Saved';
  }
  MD.docTitle = () => (E.frontMatter().title || doc.name.replace(/\.md$/, ''));
  ML.docTitle = MD.docTitle;
  ML.isNative = MD.isNative;

  MD.stats = () => {
    const raw = E.get();
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n(---|\.\.\.)\r?\n?/, '').replace(/<!--[\s\S]*?-->/g, '');
    const prose = body.replace(/```[\s\S]*?```/g, ' ').replace(/[#>*_`~=|\-[\]()!]+/g, ' ');
    const words = (prose.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
    const slides = E.slideCount();
    return {
      words, chars: body.length, charsNoSpace: body.replace(/\s/g, '').length,
      paragraphs: body.split(/\n\s*\n/).filter((p) => p.trim()).length, headings: (body.match(/^#{1,6}\s/gm) || []).length,
      lines: raw.split('\n').length, slides, readMin: Math.max(1, Math.round(words / 230)), speakMin: Math.max(1, Math.round(words / 130)),
    };
  };
  let statusTimer = null;
  function scheduleStatus() { clearTimeout(statusTimer); statusTimer = setTimeout(updateStatus, 250); }
  function updateStatus() {
    if (!doc.open) { $('md-st-words').textContent = ''; $('md-st-pos').textContent = ''; $('md-st-slides').hidden = true; return; }
    const s = MD.stats();
    $('md-st-words').textContent = s.words.toLocaleString() + ' word' + (s.words === 1 ? '' : 's');
    $('md-st-slides').hidden = !s.slides;
    if (s.slides) $('md-st-slides').textContent = 'Slide ' + E.currentSlide() + ' of ' + s.slides;
    updateTitle();
  }

  // ================================================================== views and panes
  const main = $('md-main');
  MD.view = () => main.dataset.view;
  MD.setView = (v) => {
    main.dataset.view = v;
    if (MD.pref('view') !== v) MD.setPref('view', v);
    if (v !== 'read') setTimeout(() => E.view.requestMeasure(), 0);
    MD.refreshRibbon();
  };
  MD.navOpen = () => !$('md-nav').hidden;
  MD.setNav = (open, tab) => {
    $('md-nav').hidden = !open;
    if (tab) setNavTab(tab);
    if (MD.pref('nav') !== open) MD.setPref('nav', open);
    if (open) buildNav();
    MD.refreshRibbon();
  };
  function setNavTab(t) {
    navTab = t;
    $('md-nav-tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.nav === t));
    if (MD.pref('navTab') !== t) MD.setPref('navTab', t);
    buildNav();
  }
  let navTab = 'outline';
  $('md-nav-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-nav]'); if (b) setNavTab(b.dataset.nav); });
  $('md-nav-filter').addEventListener('input', () => buildNav());
  $('md-nav-filter').addEventListener('keydown', (e) => { if (e.key === 'Enter') { if (!E.find($('md-nav-filter').value)) MD.toast('Not found'); } });

  function buildNav() {
    if (!MD.navOpen()) return;
    const body = $('md-nav-body');
    const q = $('md-nav-filter').value.trim().toLowerCase();
    if (navTab === 'slides') {
      const slides = [...content.querySelectorAll('.ml-slide-wrap .ml-slide')];
      if (!slides.length) { body.replaceChildren(h('p.md-empty', 'This document has no slides. Slides › New slide adds one, or Slides › Convert to slides splits it at the headings.')); return; }
      const themeCls = [...content.classList].filter((c) => c.startsWith('theme-'));
      body.replaceChildren(...slides.map((s, i) => {
        const clone = s.cloneNode(true);
        clone.querySelectorAll('canvas, video, iframe, .ml-molstar').forEach((c) => c.replaceWith(h('div.md-thumb-ph')));
        const art = h('article.markdown-body.ml-deck.md-nav-slide-body', clone);
        themeCls.forEach((c) => art.classList.add(c));
        const item = h('button.md-nav-slide', { dataset: { n: i + 1 }, title: 'Slide ' + (i + 1) }, h('span.md-nav-slide-n', String(i + 1)), h('div.md-nav-slide-frame', art));
        return item;
      }));
    } else {
      const hs = (ML.state.headings || []).filter((x) => !q || x.text.toLowerCase().includes(q));
      if (!hs.length) { body.replaceChildren(h('p.md-empty', q ? 'No headings match.' : 'Headings (# Title, ## Section…) show up here.')); return; }
      body.replaceChildren(...hs.map((x) => h('button.md-nav-h.l' + x.level, { dataset: { line: x.line, id: x.id }, title: x.text }, x.text)));
    }
    markNavCurrent();
  }
  $('md-nav-body').addEventListener('click', (e) => {
    const s = e.target.closest('.md-nav-slide');
    if (s) { E.goToSlide(+s.dataset.n); scrollPreviewToSlide(+s.dataset.n); return; }
    const hh = e.target.closest('.md-nav-h');
    if (hh) { E.goToLine(+hh.dataset.line - 1); const el = document.getElementById(hh.dataset.id); if (el && MD.view() !== 'write') el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  });
  function scrollPreviewToSlide(n) { const w = content.querySelector('.ml-slide-wrap[data-slide-n="' + n + '"]'); if (w && MD.view() !== 'write') w.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  function markNavCurrent() {
    if (!MD.navOpen()) return;
    const body = $('md-nav-body');
    if (navTab === 'slides') {
      const cur = E.currentSlide();
      body.querySelectorAll('.md-nav-slide').forEach((b) => b.classList.toggle('on', +b.dataset.n === cur));
      const on = body.querySelector('.md-nav-slide.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    } else {
      const line = E.cursorLine() + 1;
      let cur = null;
      body.querySelectorAll('.md-nav-h').forEach((b) => { if (+b.dataset.line <= line) cur = b; });
      body.querySelectorAll('.md-nav-h').forEach((b) => b.classList.toggle('on', b === cur));
    }
  }

  // splitter
  (function () {
    const split = $('md-split');
    let drag = false;
    split.addEventListener('mousedown', (e) => { drag = true; e.preventDefault(); document.body.classList.add('md-dragging'); });
    addEventListener('mousemove', (e) => {
      if (!drag) return;
      const r = main.getBoundingClientRect();
      const navW = MD.navOpen() ? $('md-nav').getBoundingClientRect().width : 0;
      const pct = Math.max(20, Math.min(80, ((e.clientX - r.left - navW) / (r.width - navW)) * 100));
      main.style.setProperty('--split', pct.toFixed(1) + '%');
    });
    addEventListener('mouseup', () => { if (!drag) return; drag = false; document.body.classList.remove('md-dragging'); MD.setPref('split', parseFloat(main.style.getPropertyValue('--split')) || 50); });
    split.addEventListener('dblclick', () => { MD.setPref('split', 50); });
  })();

  // preview → editor: double-click a block to edit it
  content.addEventListener('dblclick', (e) => {
    if (window.getSelection && String(window.getSelection()).trim() && !e.target.closest('.ml-slide')) { /* a word selection */ }
    const el = e.target.closest('[data-sourcepos]');
    if (!el) return;
    const m = /^(\d+):/.exec(el.getAttribute('data-sourcepos'));
    if (!m) return;
    if (MD.view() === 'read') MD.setView('split');
    E.goToLine(+m[1] - 1);
  });
  ML.previewKeys = () => false;

  MD.toggleFocus = () => { document.body.classList.toggle('md-focus'); if (document.body.classList.contains('md-focus')) { MD.setView('write'); MD.toast('Focus mode — Esc to leave'); } else MD.setView(MD.pref('view') === 'write' ? 'split' : MD.pref('view')); MD.refreshRibbon(); };
  MD.zoomToWidth = () => {
    const pane = $('ml-scroller').getBoundingClientRect().width;
    const page = MD.isDeck() ? 980 : (pageWidthPx() + 80);
    ML.setZoom(Math.max(0.5, Math.min(2.5, (pane - 40) / page)));
  };
  function pageWidthPx() { const fm = E.frontMatter(); const w = { a4: 794, letter: 816, a5: 559, legal: 816 }[fm.paper || 'a4'] || 794; return fm.orientation === 'landscape' ? Math.round(w * 1.414) : w; }

  // zoom: status slider ↔ preview
  ML.onZoom = (z) => { $('md-zoom-slider').value = Math.round(z * 100); $('md-zoom-label').textContent = Math.round(z * 100) + '%'; if (Math.abs((MD.pref('zoom') || 1) - z) > 0.001) MD.setPref('zoom', z); };
  $('md-zoom-slider').addEventListener('input', (e) => ML.setZoom(+e.target.value / 100));
  $('ml-scroller').addEventListener('wheel', (e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); ML.setZoom(ML.state.zoom + (e.deltaY < 0 ? 0.1 : -0.1)); } }, { passive: false });

  // ================================================================== the rendered document: themes, page setup
  MD.isDeck = () => (ML.lastState && ML.lastState.slides > 0) || (doc.open && E.slideMarkers().length > 0);
  MD.currentTheme = () => E.frontMatter().theme || (MD.isDeck() ? 'paper' : 'office');
  MD.currentSlideClass = () => {
    const st = E.slideStarts()[E.currentSlide() - 1];
    if (!st || !st.marker) return '';
    return (/class\s*=\s*"([^"]*)"/.exec(E.view.state.doc.line(st.line).text) || [])[1] || '';
  };
  const pageStyle = h('style', { id: 'md-page-style' });
  document.head.append(pageStyle);
  function applyDocumentLook(s) {
    const meta = s.meta || {};
    const deck = s.slides > 0;
    const known = MD.themes.map((t) => t.id);
    let theme = (meta.theme || '').toLowerCase();
    if (!known.includes(theme)) theme = deck ? 'paper' : 'office';
    const keep = [...content.classList].filter((c) => !/^(theme-|paper-|margins-|ml-deck$|md-numbered$|md-justify$|md-landscape$)/.test(c));
    const paper = (meta.paper || 'a4').toLowerCase();
    const cls = [...keep, 'theme-' + theme, 'paper-' + paper, 'margins-' + (meta.margins || 'normal').toLowerCase()];
    if (deck) cls.push('ml-deck');
    if (/^(true|yes|on)$/i.test(meta.numbered || '')) cls.push('md-numbered');
    if (/^(true|yes|on)$/i.test(meta.justify || '')) cls.push('md-justify');
    const landscape = (meta.orientation || (deck ? 'landscape' : 'portrait')).toLowerCase() === 'landscape';
    if (landscape) cls.push('md-landscape');
    content.className = cls.join(' ');
    $('md-page').className = 'md-page-' + (deck ? 'deck' : 'doc') + ' paper-' + paper + (landscape ? ' md-landscape' : '');
    const wm = $('md-watermark');
    wm.hidden = !meta.watermark || deck;
    wm.textContent = meta.watermark || '';
    const size = { a4: 'A4', letter: 'letter', a5: 'A5', legal: 'legal' }[paper] || 'A4';
    const margin = { normal: '20mm 22mm', narrow: '12.7mm', wide: '30mm 35mm' }[(meta.margins || 'normal').toLowerCase()] || '20mm 22mm';
    pageStyle.textContent = '@page { size: ' + size + ' ' + (landscape ? 'landscape' : 'portrait') + '; margin: ' + (deck ? '10mm' : margin) + '; }';
    $('md-st-slides').hidden = !deck;
  }
  const prevUpdate = ML.onUpdate;
  ML.onUpdate = (s) => {
    prevUpdate && prevUpdate(s);
    ML.lastState = s;
    if (!doc.open) return;
    applyDocumentLook(s);
    updateStatus();
    if (MD.navOpen()) { buildNav(); (ML.renderPromise || Promise.resolve()).then(() => { if (navTab === 'slides') buildNav(); }); }
    MD.refreshRibbon();
  };
  ML.onOpenLink = async (path) => {
    if (path === doc.path) return;
    MD.openPath(path);
  };
  MD.openExternal = (url) => { if (MD.isNative()) MD.native('open-external', { url }); else window.open(url, '_blank', 'noopener'); };
  ML.openExternal = MD.openExternal;

  // ================================================================== files from outside (pictures, links)
  /** Picks a file: the native dialog, or the in-app browser. */
  MD.pickFile = async (opts) => {
    if (MD.isNative()) {
      try {
        const filters = opts.extensions ? [[opts.title.replace(/^Insert (a |an )?/i, ''), opts.extensions], ['All files', ['*']]] : [['All files', ['*']]];
        return await MD.native('open-dialog', { title: opts.title, filters, dir: doc.saved ? MD.dirname(doc.path) : MD.app.documents });
      } catch (e) { /* fall through */ }
    }
    return await new Promise((resolve) => {
      let done = false;
      const fb = MD.folderBrowser({ mode: 'open', filter: opts.filter || 'all', dir: doc.saved ? MD.dirname(doc.path) : null, onPick: (p) => { done = true; resolve(p); close(); } });
      let close = () => {};
      MD.dialog({ title: opts.title || 'Choose a file', width: 780, body: fb, buttons: null, onOpen: (d, c) => { close = c; } }).then(() => { if (!done) resolve(null); });
    });
  };
  /** The path to write in the document for a file (relative when possible). */
  MD.relativeAsset = async (p, copy) => {
    try {
      const v = await MD.api('/api/picture', { doc: doc.path, src: p, copy: !!copy });
      if (v.copied) MD.toast('Copied the picture into the document’s images folder');
      return v.path;
    } catch (e) { return p; }
  };

  // ================================================================== export
  async function fetchText(u) { const r = await fetch(u); return r.ok ? r.text() : ''; }
  async function fontDataUrl(u) {
    try { const r = await fetch(u); const b = await r.blob(); return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); }); } catch (e) { return u; }
  }
  /** CSS with url(...) font references replaced by data: URLs (self-contained). */
  async function inlineFonts(css, base, only) {
    const urls = [...new Set([...css.matchAll(/url\(["']?([^"')]+\.woff2)["']?\)/g)].map((m) => m[1]))];
    for (const u of urls) {
      if (only && !only.some((f) => u.includes(f))) continue;
      const abs = u.startsWith('/') ? u : base + u;
      css = css.split(u).join(await fontDataUrl(abs));
    }
    return css;
  }
  /** A standalone HTML page of the rendered document (diagrams as SVG, charts as pictures). */
  MD.buildHtmlPage = async () => {
    const clone = await ML.withTheme('light', async () => { await ML.settled(60000); return ML.cloneRendered(); });
    clone.querySelectorAll('[data-sourcepos]').forEach((e) => e.removeAttribute('data-sourcepos'));
    clone.querySelectorAll('[data-done]').forEach((e) => e.removeAttribute('data-done'));
    const theme = MD.currentTheme();
    const fontsNeeded = { office: ['SourceSans3'], report: ['SourceSerif4', 'SourceSans3'], classic: ['SourceSerif4'], modern: ['Inter'], letter: ['SourceSerif4'], newsletter: ['SourceSans3', 'SourceSerif4'], github: [] }[theme] || ['Inter', 'SourceSans3', 'SourceSerif4'];
    let css = await fetchText('/assets/fonts.css');
    css = css.split('@font-face').filter((b, i) => i === 0 || fontsNeeded.some((f) => b.includes(f)) || b.includes('JetBrains') && clone.querySelector('pre, code')).join('@font-face');
    css = await inlineFonts(css, '/fonts/');
    css += '\n' + await fetchText('/assets/markdown.css') + '\n' + await fetchText('/assets/themes.css') + '\n' + await fetchText('/vendor/hljs/styles/github.min.css');
    if (clone.querySelector('.katex')) css += '\n' + await inlineFonts(await fetchText('/vendor/katex/katex.min.css'), '/vendor/katex/');
    css += '\n' + pageStyle.textContent + '\nbody{margin:0;background:#fff}.markdown-body{margin:0 auto}\n@media screen{.markdown-body:not(.ml-deck){max-width:860px;padding:48px 40px 80px}}';
    const title = MD.docTitle();
    const wm = !$('md-watermark').hidden ? '<div id="md-watermark">' + MD.esc($('md-watermark').textContent) + '</div>' : '';
    return '<!doctype html>\n<html lang="en" data-theme="light">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<meta name="generator" content="MdCraft ' + MD.app.version + '">\n<title>' + MD.esc(title) + '</title>\n<style>\n' + css + '\n</style>\n</head>\n<body>\n' + wm + '<article class="' + content.className + '">\n' + clone.innerHTML + '\n</article>\n</body>\n</html>\n';
  };
  async function saveText(name, text, ext) {
    if (MD.isNative()) {
      const p = await MD.native('save-dialog', { name, dir: doc.saved ? MD.dirname(doc.path) : MD.app.documents, filters: [[ext.toUpperCase(), [ext]]] }).catch(() => null);
      if (!p) return;
      try { await MD.api('/api/file/save', { path: p, text, recent: false }); MD.toast('Exported ' + MD.basename(p)); } catch (e) { MD.alert('Export failed', e.message); }
      return;
    }
    const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: ext === 'html' ? 'text/html' : 'text/plain' })), download: name });
    document.body.append(a); a.click(); a.remove();
  }
  MD.exportHtml = async () => {
    if (!doc.open) return;
    MD.toast('Preparing the web page…', 20000);
    try { const html = await MD.buildHtmlPage(); await saveText(MD.suggestName().replace(/\.md$/, '') + '.html', html, 'html'); }
    catch (e) { MD.alert('Export failed', e.message || String(e)); }
  };
  MD.exportPdf = async () => {
    if (MD.backstageOpen()) MD.closeBackstage();
    MD.toast('In the print dialog, choose “Save as PDF” or “Print to File”.', 5000);
    setTimeout(() => ML.print(), 400);
  };
  MD.copyRich = async () => {
    const clone = await ML.withTheme('light', async () => { await ML.settled(30000); return ML.cloneRendered(); });
    const holder = h('div.markdown-body', { contenteditable: 'true', style: { position: 'fixed', left: '-10000px', top: '0', width: '800px', background: '#fff', color: '#000' } });
    holder.className += ' ' + [...content.classList].filter((c) => c.startsWith('theme-')).join(' ');
    holder.innerHTML = clone.innerHTML;
    document.body.append(holder);
    const range = document.createRange(); range.selectNodeContents(holder);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    sel.removeAllRanges(); holder.remove();
    if (!ok) {
      try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([clone.innerHTML], { type: 'text/html' }), 'text/plain': new Blob([content.innerText], { type: 'text/plain' }) })]); ok = true; } catch (e) { ok = false; }
    }
    MD.toast(ok ? 'Copied — paste it into Word, an email or a web editor' : 'Copying failed');
  };

  // ================================================================== dialogs
  MD.wordCountDialog = () => {
    const s = MD.stats();
    const sel = E.selectedText();
    const rows = [['Words', s.words], ['Characters (no spaces)', s.charsNoSpace], ['Characters (with spaces)', s.chars], ['Paragraphs', s.paragraphs], ['Lines', s.lines], ['Headings', s.headings]];
    if (s.slides) rows.push(['Slides', s.slides], ['Speaking time', '≈ ' + s.speakMin + ' min']);
    rows.push(['Reading time', '≈ ' + s.readMin + ' min']);
    if (sel) rows.unshift(['Selected words', (sel.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length]);
    MD.dialog({ title: 'Word count', width: 360, body: h('table.md-stats', rows.map(([k, v]) => h('tr', h('th', k), h('td', typeof v === 'number' ? v.toLocaleString() : v)))), buttons: [{ label: 'Close', value: true, primary: true }] });
  };
  MD.accessibilityDialog = () => {
    const text = E.get();
    const lines = text.split('\n');
    const issues = [];
    let inFence = false, lastLevel = 0, h1 = 0;
    lines.forEach((l, i) => {
      if (/^\s*(```|~~~)/.test(l)) { inFence = !inFence; return; }
      if (inFence) return;
      const hm = /^(#{1,6})\s+(.*)$/.exec(l);
      if (hm) {
        const lv = hm[1].length;
        if (lv === 1) h1++;
        if (lastLevel && lv > lastLevel + 1 && !/<!-- slide/.test(lines[i - 2] || '')) issues.push({ line: i, kind: 'Heading level skipped', msg: 'A level-' + lv + ' heading follows a level-' + lastLevel + ' heading. Screen readers use headings to navigate.' });
        if (!hm[2].trim()) issues.push({ line: i, kind: 'Empty heading', msg: 'Give the heading some text.' });
        lastLevel = lv;
      }
      for (const m of l.matchAll(/!\[([^\]]*)\]\(([^)]*)\)/g)) if (!m[1].trim()) issues.push({ line: i, kind: 'Missing alternative text', msg: 'Describe the picture between the brackets: ![a description](' + m[2] + ').' });
      for (const m of l.matchAll(/(?<!!)\[([^\]]*)\]\(([^)]*)\)/g)) {
        const t = m[1].trim().toLowerCase();
        if (!t) issues.push({ line: i, kind: 'Empty link text', msg: 'Links need text that says where they go.' });
        else if (['here', 'click here', 'link', 'this', 'more', 'read more'].includes(t)) issues.push({ line: i, kind: 'Unclear link text', msg: '“' + m[1] + '” doesn’t say where the link goes.' });
      }
      if (/<img\b(?![^>]*\balt=)/i.test(l)) issues.push({ line: i, kind: 'Missing alternative text', msg: 'Add alt="…" to the <img> tag.' });
    });
    if (!h1 && !E.frontMatter().title && !MD.isDeck()) issues.unshift({ line: 0, kind: 'No title', msg: 'Start the document with a # Title or set a title in its properties.' });
    const body = issues.length
      ? h('div.md-a11y', issues.map((x) => { const b = h('button.md-a11y-item', h('b', x.kind), h('span', x.msg), h('small', 'Line ' + (x.line + 1))); b.addEventListener('click', () => { document.querySelector('.md-modal-back')?.remove(); E.goToLine(x.line, true); }); return b; }))
      : h('div.md-a11y-ok', MD.icon('check', 28), h('p', 'No issues found. Nice work!'));
    MD.dialog({ title: 'Accessibility', width: 520, body, buttons: [{ label: 'Close', value: true, primary: true }] });
  };
  MD.shortcutsDialog = () => {
    const groups = {};
    for (const c of MD.commands.values()) if (c.key) { const g = c.id.split('.')[0]; (groups[g] = groups[g] || []).push(c); }
    const names = { file: 'File', edit: 'Editing', format: 'Formatting', insert: 'Insert', slides: 'Slides', review: 'Review', view: 'View', help: 'Help', design: 'Design', table: 'Table' };
    const body = h('div.md-shortcuts', Object.entries(groups).map(([g, list]) => h('section', h('h3', names[g] || g), h('table', list.map((c) => h('tr', h('td', c.label.replace(/…$/, '')), h('td', h('kbd', MD.keyLabel(c.key)))))))));
    body.append(h('section', h('h3', 'Slide show'), h('table', [['Next / previous', '→ ←  Space'], ['Speaker notes', 'N'], ['Black screen', 'B'], ['Go to slide', 'number, Enter'], ['End', 'Esc']].map(([a, b]) => h('tr', h('td', a), h('td', h('kbd', b)))))));
    MD.dialog({ title: 'Keyboard shortcuts', width: 760, body, buttons: [{ label: 'Close', value: true, primary: true }] });
  };
  MD.editProperties = () => MD.openBackstage('info');

  // ================================================================== native shell events
  let openQueue = Promise.resolve();
  window.__mdNative = {
    /** The window's close button: ask about unsaved changes, then let the shell quit. */
    async requestClose() {
      if (MD.presenting()) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      if (await MD.confirmDiscard()) { discardAutosave(); MD.native('quit', {}); }
    },
    /** Files dropped on the window or passed on the command line. */
    async dropped(paths) {
      const pics = paths.filter((p) => /\.(png|jpe?g|gif|svg|webp|avif|bmp|heic|heif|tiff?|mp4|webm|mkv|mov|avi|m4v|mp3|wav|ogg|m4a|flac)$/i.test(p));
      const mds = paths.filter((p) => /\.(md|markdown|mdown|mkd|txt|mdd|mds)$/i.test(p));
      const csvs = paths.filter((p) => /\.(csv|tsv)$/i.test(p));
      if (mds.length && !doc.open) { MD.openPath(mds[0]); return; }
      if (mds.length && !pics.length && !csvs.length) { MD.openPath(mds[0]); return; }
      if (!doc.open) await MD.newFromTemplate('blank');
      for (const p of pics) { const rel = await MD.relativeAsset(p, true); const alt = MD.basename(p).replace(/\.\w+$/, '').replace(/[-_]+/g, ' '); E.insertBlock('![' + alt + '](' + (/[\s()]/.test(rel) ? '<' + rel + '>' : rel) + ')'); }
      for (const p of csvs) E.insertBlock('@import "' + await MD.relativeAsset(p, false) + '"');
      for (const p of mds) if (pics.length || csvs.length) E.insert('[' + MD.basename(p) + '](' + await MD.relativeAsset(p, false) + ')');
    },
    /**
     * Files opened from Finder (double-click, Open With, the Dock icon). Each Markdown file gets
     * its own window: the first one this window when it has no document, the others new windows.
     * Finder may send a selection as several events; they are handled one after the other.
     */
    opened(paths) {
      openQueue = openQueue.then(async () => {
        const isMd = (p) => /\.(md|markdown|mdown|mkd|txt|mdd|mds)$/i.test(p);
        const mds = [...new Set(paths.filter(isMd))];
        const others = paths.filter((p) => !isMd(p));
        for (const p of mds) {
          if (doc.open && doc.path === p) continue; // already showing it
          if (!doc.open) await MD.openPath(p); else MD.native('new-window', { path: p });
        }
        if (others.length) await window.__mdNative.dropped(others);
      }).catch((e) => console.warn(e));
      return openQueue;
    },
    open(path) { MD.openPath(path); },
    template(id) { MD.newFromTemplate(id); },
    menu(cmd) { MD.run(cmd); },
  };
  // a browser tab (mdcraft-cli serve) also guards unsaved work
  addEventListener('beforeunload', (e) => { if (!MD.isNative() && doc.open && doc.dirty) { writeAutosave(); e.preventDefault(); e.returnValue = ''; } });

  // ================================================================== boot
  async function boot() {
    try { MD.app = await MD.api('/api/app'); } catch (e) { document.body.textContent = 'mdcraft could not reach its server: ' + e.message; return; }
    MD.app.sep = MD.app.separator || '/';
    if (!MD.app.prefs.ui) MD.app.prefs.ui = {};
    E.create($('md-editor'), { lineNumbers: !!MD.pref('lineNumbers'), wrap: !!MD.pref('wrap'), spellcheck: !!MD.pref('spellcheck'), closeBrackets: !!MD.pref('closeBrackets') });
    ['editorFont', 'ribbonCollapsed', 'split', 'appearance', 'darkPage', 'sync'].forEach(applyPref);
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyPref('appearance'));
    ML.setZoom(+MD.pref('zoom') || 1);
    main.dataset.view = MD.pref('view') || 'split';
    navTab = MD.pref('navTab') || 'outline';
    $('md-nav-tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.nav === navTab));
    if (MD.pref('nav')) $('md-nav').hidden = false;
    MD.renderRibbon();
    MDIcons.fill(document);
    document.body.classList.add('md-no-document');
    document.body.classList.remove('booting');
    updateTitle();
    const st = MD.app.startup || {};
    if (st.open) await MD.openPath(st.open);
    else if (st.copyOf) await MD.openCopy(st.copyOf);
    else if (st.template) await MD.newFromTemplate(st.template);
    else if (MD.pref('startup') === 'blank') await MD.newFromTemplate('blank');
    else if (MD.pref('startup') === 'last' && (MD.app.recent || []).find((r) => !r.missing)) await MD.openPath(MD.app.recent.find((r) => !r.missing).path);
    else MD.openBackstage('home');
    if (MD.isNative()) MD.native('ready', {});
    MD.booted = true;
    if (MD.agent) MD.agent.start();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
