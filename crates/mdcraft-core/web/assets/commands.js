/* mdcraft — commands. Everything the ribbon, the keyboard and command search do is a
 * command with an id (as in WordCraft): MD.run('format.bold'). */
(function () {
  'use strict';
  const MD = window.MD;
  const ML = window.ML;
  const E = MD.editor;
  const { h } = MD;
  const S = E.SEL;

  const commands = new Map();
  /** Registers a command. spec: {label, icon, key, run(args), checked(), enabled(), keywords, editing} */
  function C(id, spec) { spec.id = id; commands.set(id, spec); return spec; }
  MD.commands = commands;
  MD.command = (id) => commands.get(id);

  /** Runs a command by id. */
  MD.run = async (id, args) => {
    const c = commands.get(id);
    if (!c) { console.warn('unknown command', id); return; }
    if (c.enabled && !c.enabled()) return;
    if (c.editing) {
      if (MD.backstageOpen && MD.backstageOpen()) MD.closeBackstage();
      if (MD.view && MD.view() === 'read') MD.setView('split');
    }
    try { await c.run(args); } catch (e) { console.error(e); MD.toast(c.label + ': ' + (e.message || e), 6000); }
    MD.refreshRibbon && MD.refreshRibbon();
  };

  let fmt = new Set();
  MD.updateFormatState = () => { fmt = E.activeFormats(); };

  // ================================================================== content libraries
  MD.diagrams = [
    { id: 'flowchart', name: 'Flowchart', icon: 'diagram', lang: 'mermaid', code: 'flowchart LR\n    A[Start] --> B{Decision?}\n    B -- Yes --> C[Do the thing]\n    B -- No --> D[Skip it]\n    C --> E((Done))\n    D --> E' },
    { id: 'sequence', name: 'Sequence', icon: 'diagram', lang: 'mermaid', code: 'sequenceDiagram\n    autonumber\n    participant U as User\n    participant A as App\n    participant S as Server\n    U->>A: Click "Save"\n    A->>S: POST /documents\n    S-->>A: 201 Created\n    A-->>U: Saved ✓' },
    { id: 'class', name: 'Class', icon: 'diagram', lang: 'mermaid', code: 'classDiagram\n    class Document {\n      +String title\n      +String body\n      +save()\n    }\n    class Template {\n      +String id\n      +instantiate() Document\n    }\n    Template ..> Document : creates' },
    { id: 'state', name: 'State', icon: 'diagram', lang: 'mermaid', code: 'stateDiagram-v2\n    [*] --> Draft\n    Draft --> Review : submit\n    Review --> Draft : changes requested\n    Review --> Published : approve\n    Published --> [*]' },
    { id: 'er', name: 'Entity relationship', icon: 'diagram', lang: 'mermaid', code: 'erDiagram\n    CUSTOMER ||--o{ ORDER : places\n    ORDER ||--|{ LINE_ITEM : contains\n    PRODUCT ||--o{ LINE_ITEM : "ordered in"' },
    { id: 'gantt', name: 'Gantt (timeline)', icon: 'chart', lang: 'mermaid', code: 'gantt\n    title Project plan\n    dateFormat YYYY-MM-DD\n    section Discovery\n    Interviews        :a1, 2026-11-02, 10d\n    Synthesis         :a2, after a1, 5d\n    section Build\n    Prototype         :b1, after a2, 15d\n    Pilot             :b2, after b1, 10d' },
    { id: 'pie', name: 'Pie', icon: 'chart-pie', lang: 'mermaid', code: 'pie title Time spent\n    "Writing" : 45\n    "Editing" : 30\n    "Meetings" : 15\n    "Coffee" : 10' },
    { id: 'mindmap', name: 'Mind map', icon: 'diagram', lang: 'mermaid', code: 'mindmap\n  root((Product))\n    Users\n      Writers\n      Teams\n    Features\n      Editor\n      Templates\n      Slides\n    Platforms\n      macOS\n      Windows\n      Linux' },
    { id: 'timeline', name: 'Timeline', icon: 'chart-line', lang: 'mermaid', code: 'timeline\n    title Roadmap\n    Q1 : Research : Hiring\n    Q2 : Beta release\n    Q3 : General availability\n    Q4 : Enterprise features' },
    { id: 'journey', name: 'User journey', icon: 'diagram', lang: 'mermaid', code: 'journey\n    title Writing a report\n    section Draft\n      Pick a template: 5: Writer\n      Write the content: 3: Writer\n    section Share\n      Export to PDF: 4: Writer\n      Present to the team: 5: Writer, Team' },
    { id: 'quadrant', name: 'Quadrant', icon: 'diagram', lang: 'mermaid', code: 'quadrantChart\n    title Impact vs effort\n    x-axis Low effort --> High effort\n    y-axis Low impact --> High impact\n    quadrant-1 Plan carefully\n    quadrant-2 Quick wins\n    quadrant-3 Fill-ins\n    quadrant-4 Avoid\n    Templates: [0.3, 0.8]\n    Plugins: [0.75, 0.6]\n    Dark mode: [0.2, 0.35]' },
    { id: 'git', name: 'Git graph', icon: 'diagram', lang: 'mermaid', code: 'gitGraph\n    commit\n    branch feature\n    checkout feature\n    commit\n    commit\n    checkout main\n    merge feature\n    commit' },
    { id: 'graphviz', name: 'Graphviz (DOT)', icon: 'diagram', lang: 'dot', code: 'digraph G {\n    rankdir=LR;\n    node [shape=box, style=rounded];\n    Idea -> Draft -> Review -> Publish;\n    Review -> Draft [label="edits"];\n}' },
    { id: 'plantuml', name: 'PlantUML (needs Java)', icon: 'diagram', lang: 'plantuml', code: '@startuml\nactor Writer\nWriter -> mdcraft : open template\nmdcraft --> Writer : document\n@enduml' },
    { id: 'wavedrom', name: 'Timing (WaveDrom)', icon: 'chart-line', lang: 'wavedrom', code: '{ signal: [\n  { name: "clk",  wave: "p......" },\n  { name: "req",  wave: "0.1..0." },\n  { name: "ack",  wave: "0..1.0." }\n]}' },
  ];
  MD.charts = [
    { id: 'bar', name: 'Bar chart', icon: 'chart', code: '{\n  type: "bar",\n  data: {\n    labels: ["Q1", "Q2", "Q3", "Q4"],\n    datasets: [\n      { label: "2025", data: [12, 19, 15, 22] },\n      { label: "2026", data: [16, 23, 21, 30] }\n    ]\n  },\n  options: { plugins: { title: { display: true, text: "Revenue (k€)" } } }\n}' },
    { id: 'line', name: 'Line chart', icon: 'chart-line', code: '{\n  type: "line",\n  data: {\n    labels: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],\n    datasets: [{ label: "Active users", data: [120, 190, 260, 310, 420, 515], tension: 0.3, fill: true }]\n  },\n  options: { plugins: { title: { display: true, text: "Growth" } } }\n}' },
    { id: 'doughnut', name: 'Doughnut chart', icon: 'chart-pie', code: '{\n  type: "doughnut",\n  data: {\n    labels: ["Product", "Services", "Licences"],\n    datasets: [{ data: [55, 30, 15] }]\n  },\n  options: { plugins: { title: { display: true, text: "Revenue mix" } } }\n}' },
    { id: 'radar', name: 'Radar chart', icon: 'chart', code: '{\n  type: "radar",\n  data: {\n    labels: ["Speed", "Quality", "Cost", "Scope", "Risk"],\n    datasets: [{ label: "Plan A", data: [4, 5, 3, 4, 2] }, { label: "Plan B", data: [3, 4, 5, 3, 4] }]\n  }\n}' },
    { id: 'vega', name: 'Vega-Lite chart', icon: 'chart', lang: 'vega-lite', code: '{\n  "$schema": "https://vega.github.io/schema/vega-lite/v5.json",\n  "data": { "values": [\n    {"team": "North", "sales": 28}, {"team": "South", "sales": 55},\n    {"team": "East", "sales": 43}, {"team": "West", "sales": 91}\n  ]},\n  "mark": "bar",\n  "encoding": {\n    "x": {"field": "team", "type": "nominal"},\n    "y": {"field": "sales", "type": "quantitative"}\n  }\n}' },
    { id: 'csv', name: 'Chart from a CSV table', icon: 'csv', lang: 'csv {chart="bar" title="Units sold"}', code: 'Month,Units\nJan,120\nFeb,150\nMar,170\nApr,160' },
  ];
  MD.callouts = [
    { id: 'NOTE', name: 'Note', text: 'Useful information that readers should know.' },
    { id: 'TIP', name: 'Tip', text: 'A helpful suggestion for doing things better.' },
    { id: 'IMPORTANT', name: 'Important', text: 'Key information readers need to succeed.' },
    { id: 'WARNING', name: 'Warning', text: 'Urgent information that needs attention.' },
    { id: 'CAUTION', name: 'Caution', text: 'The risks or negative outcomes of an action.' },
  ];
  MD.codeLanguages = [['python', 'Python'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['rust', 'Rust'], ['bash', 'Shell (bash)'], ['json', 'JSON'], ['yaml', 'YAML'], ['sql', 'SQL'], ['html', 'HTML'], ['css', 'CSS'], ['go', 'Go'], ['java', 'Java'], ['csharp', 'C#'], ['cpp', 'C++'], ['text', 'Plain text']];
  MD.equations = [
    { name: 'Inline math', tex: null, inline: true },
    { name: 'Display equation', tex: S + 'E = mc^2' + S },
    { name: 'Quadratic formula', tex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}' },
    { name: 'Sum', tex: '\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}' },
    { name: 'Integral', tex: '\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}' },
    { name: 'Matrix', tex: 'A = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}' },
    { name: 'Aligned equations', tex: '\\begin{aligned}\nf(x) &= (x+1)^2 \\\\\n     &= x^2 + 2x + 1\n\\end{aligned}' },
    { name: 'Cases', tex: '|x| = \\begin{cases} x & x \\ge 0 \\\\ -x & x < 0 \\end{cases}' },
    { name: 'Chemical equation', tex: '\\ce{2H2 + O2 -> 2H2O}' },
  ];
  MD.slideLayouts = {
    title: { name: 'Title slide', icon: 'slide-title', cls: 'title', body: '# ' + S + 'Presentation title' + S + '\n\nSubtitle or tagline\n\n**' + '{{author}}' + '** · ' + '{{date}}' },
    content: { name: 'Title and content', icon: 'slide-layout', cls: '', body: '## ' + S + 'Slide title' + S + '\n\n- First point\n- Second point\n- Third point' },
    section: { name: 'Section header', icon: 'slide-section', cls: 'section', body: '# ' + S + 'Section title' + S + '\n\nWhat this part is about' },
    two: { name: 'Two content', icon: 'slide-two', cls: 'two-col', body: '## ' + S + 'Comparison' + S + '\n\n<div class="cols">\n<div>\n\n### Before\n\n- Point\n- Point\n\n</div>\n<div>\n\n### After\n\n- Point\n- Point\n\n</div>\n</div>' },
    agenda: { name: 'Agenda', icon: 'slide-agenda', cls: 'agenda', body: '## ' + S + 'Agenda' + S + '\n\n1. Where we are\n2. What we learned\n3. What comes next\n4. Questions' },
    quote: { name: 'Quote', icon: 'slide-quote', cls: 'quote', body: '> ' + S + 'A sentence worth remembering.' + S + '\n>\n> — Someone wise' },
    stat: { name: 'Big number', icon: 'slide-number', cls: 'stat', body: '# ' + S + '87%' + S + '\n\nof readers finish a one-page summary' },
    image: { name: 'Picture with caption', icon: 'slide-image', cls: 'image', body: '## ' + S + 'Title' + S + '\n\n![A description of the picture](images/picture.jpg "Caption")' },
    end: { name: 'Closing', icon: 'slide-end', cls: 'end', body: '# ' + S + 'Thank you' + S + '\n\nQuestions? · name@example.com' },
    blank: { name: 'Blank', icon: 'slide-layout', cls: 'blank', body: S + S },
  };
  MD.themes = [
    { id: 'office', name: 'Office', kind: 'document', colors: ['#1f3864', '#2e74b5', '#f2f2f2'], font: 'Source Sans 3' },
    { id: 'report', name: 'Report', kind: 'document', colors: ['#14324a', '#c0392b', '#f5f1e8'], font: 'Source Serif 4' },
    { id: 'classic', name: 'Classic', kind: 'document', colors: ['#111111', '#555555', '#ffffff'], font: 'Source Serif 4' },
    { id: 'modern', name: 'Modern', kind: 'document', colors: ['#0f766e', '#111827', '#ecfdf5'], font: 'Inter' },
    { id: 'letter', name: 'Letter', kind: 'document', colors: ['#2d3a4a', '#8a6d3b', '#fbfaf7'], font: 'Source Serif 4' },
    { id: 'newsletter', name: 'Newsletter', kind: 'document', colors: ['#7c2d12', '#ea580c', '#fff7ed'], font: 'Source Sans 3' },
    { id: 'github', name: 'GitHub', kind: 'document', colors: ['#1f2328', '#0969da', '#f6f8fa'], font: 'system-ui' },
    { id: 'paper', name: 'Paper', kind: 'deck', colors: ['#ffffff', '#1d4ed8', '#111827'], font: 'Inter' },
    { id: 'aurora', name: 'Aurora', kind: 'deck', colors: ['#120c2e', '#7c3aed', '#22d3ee'], font: 'Inter' },
    { id: 'midnight', name: 'Midnight', kind: 'deck', colors: ['#0b1220', '#38bdf8', '#e2e8f0'], font: 'Inter' },
    { id: 'sunrise', name: 'Sunrise', kind: 'deck', colors: ['#fff7ed', '#f97316', '#7c2d12'], font: 'Source Sans 3' },
    { id: 'corporate', name: 'Corporate', kind: 'deck', colors: ['#ffffff', '#1e3a8a', '#0ea5e9'], font: 'Source Sans 3' },
    { id: 'chalk', name: 'Chalkboard', kind: 'deck', colors: ['#1f3a2e', '#f1f5d8', '#facc15'], font: 'Source Serif 4' },
    { id: 'ocean', name: 'Ocean', kind: 'deck', colors: ['#063a4f', '#14b8a6', '#ecfeff'], font: 'Inter' },
  ];
  MD.emoji = ['smile', 'grin', 'wink', 'thinking', 'tada', 'rocket', 'fire', 'sparkles', 'star', 'heart', 'thumbsup', 'thumbsdown', 'clap', 'wave', 'eyes', 'bulb', 'memo', 'pushpin', 'calendar', 'chart_with_upwards_trend', 'chart_with_downwards_trend', 'bar_chart', 'warning', 'x', 'white_check_mark', 'heavy_check_mark', 'question', 'exclamation', 'lock', 'key', 'gear', 'wrench', 'hammer', 'package', 'zap', 'bug', 'books', 'book', 'link', 'email', 'phone', 'computer', 'globe_with_meridians', 'house', 'office', 'moneybag', 'dollar', 'euro', 'trophy', 'medal_sports', 'dart', 'hourglass', 'alarm_clock', 'coffee', 'pizza', 'sunny', 'cloud', 'umbrella', 'snowflake', 'seedling', 'evergreen_tree', 'earth_africa', 'airplane', 'car', 'red_circle', 'large_blue_circle', 'green_heart', 'arrow_right', 'arrow_up', 'arrow_down', '100'];
  MD.symbols = '© ® ™ § ¶ † ‡ • · … — – ± × ÷ ≈ ≠ ≤ ≥ ∞ → ← ↑ ↓ ⇒ ⇔ ✓ ✗ ★ ☆ € £ ¥ ¢ ° ‰ µ π Ω α β γ δ ε θ λ σ φ ω Σ Δ √ ∫ ∂ ∇ ∈ ∉ ⊂ ∪ ∩ ∀ ∃ ¼ ½ ¾ ² ³ « » „ “ ” ‘ ’'.split(' ');

  // ================================================================== file
  C('file.backstage', { label: 'File', icon: 'file', key: 'Alt+F', run: () => MD.openBackstage('home') });
  C('file.close-backstage', { label: 'Back to the document', icon: 'arrow-left', run: () => MD.closeBackstage() });
  C('file.new', { label: 'New…', icon: 'file-plus', key: 'Mod+N', keywords: 'template create', run: () => MD.openBackstage('new') });
  C('file.newBlank', { label: 'New blank document', icon: 'file-md', run: () => MD.newFromTemplate('blank') });
  C('file.newDeck', { label: 'New blank presentation', icon: 'file-slides', run: () => MD.newFromTemplate('blank-deck') });
  C('file.open', { label: 'Open…', icon: 'folder-open', key: 'Mod+O', run: () => MD.openDialog() });
  C('file.save', { label: 'Save', icon: 'save', key: 'Mod+S', run: () => MD.save() });
  C('file.saveAs', { label: 'Save As…', icon: 'save-as', key: 'Mod+Shift+S', run: () => MD.saveAs() });
  C('file.print', { label: 'Print…', icon: 'printer', key: 'Mod+P', keywords: 'pdf paper', run: () => ML.print() });
  C('file.exportHtml', { label: 'Export as web page (HTML)…', icon: 'web', keywords: 'html share publish', run: () => MD.exportHtml() });
  C('file.exportPdf', { label: 'Export as PDF…', icon: 'pdf', keywords: 'pdf print', run: () => MD.exportPdf() });
  C('file.copyRich', { label: 'Copy as formatted text', icon: 'clipboard-rich', keywords: 'clipboard word outlook email paste rich html', run: () => MD.copyRich() });
  C('file.close', { label: 'Close document', icon: 'x', run: () => MD.closeDocument() });
  C('file.newWindow', { label: 'New window', icon: 'window', key: 'Mod+Shift+N', run: () => MD.newWindow() });
  C('file.info', { label: 'Document properties', icon: 'info', keywords: 'title author metadata front matter', run: () => MD.openBackstage('info') });
  C('file.options', { label: 'Options', icon: 'settings', keywords: 'settings preferences', key: 'Mod+,', run: () => MD.openBackstage('options') });
  C('file.recover', { label: 'Recover unsaved documents', icon: 'recover', run: () => MD.openBackstage('home') });

  // ================================================================== edit
  const ed = { editing: true };
  C('edit.undo', { label: 'Undo', icon: 'undo', key: 'Mod+Z', run: () => { E.undo(); E.focus(); } });
  C('edit.redo', { label: 'Redo', icon: 'redo', key: MD.isMac ? 'Mod+Shift+Z' : 'Mod+Y', run: () => { E.redo(); E.focus(); } });
  C('edit.cut', { ...ed, label: 'Cut', icon: 'cut', run: async () => { const t = E.selectedText(); if (!t) return; await clip(t); E.insert(''); } });
  C('edit.copy', { ...ed, label: 'Copy', icon: 'copy', run: async () => { const t = E.selectedText(); if (t) { await clip(t); MD.toast('Copied'); } } });
  C('edit.paste', { ...ed, label: 'Paste', icon: 'paste', run: async () => {
    try { const t = await navigator.clipboard.readText(); E.insert(t); }
    catch (e) { MD.toast('Use ' + MD.keyLabel('Mod+V') + ' to paste (the clipboard is protected)'); E.focus(); }
  } });
  C('edit.selectAll', { ...ed, label: 'Select all', icon: 'select-all', run: () => E.selectAll() });
  C('edit.find', { ...ed, label: 'Find…', icon: 'find', key: 'Mod+F', run: () => E.openFind() });
  C('edit.replace', { ...ed, label: 'Replace…', icon: 'replace', key: MD.isMac ? 'Mod+Alt+F' : 'Mod+H', run: () => E.openReplace() });
  C('edit.goto', { ...ed, label: 'Go to line…', icon: 'arrow-left', key: 'Mod+G', run: async () => { const v = await MD.prompt('Go to line', 'Line number', String(E.cursorPos().line)); if (v && +v) E.goToLine(+v - 1); } });
  async function clip(t) { try { await navigator.clipboard.writeText(t); } catch (e) { document.execCommand('copy'); } }

  // ================================================================== format
  C('format.bold', { ...ed, label: 'Bold', icon: 'bold', key: 'Mod+B', keywords: 'strong', run: () => E.toggleWrap('**'), checked: () => fmt.has('bold') });
  C('format.italic', { ...ed, label: 'Italic', icon: 'italic', key: 'Mod+I', keywords: 'emphasis', run: () => E.toggleWrap('*'), checked: () => fmt.has('italic') });
  C('format.underline', { ...ed, label: 'Underline', icon: 'underline', key: 'Mod+U', run: () => E.toggleWrap('<u>', '</u>'), checked: () => fmt.has('underline') });
  C('format.strike', { ...ed, label: 'Strikethrough', icon: 'strike', key: 'Mod+Shift+X', run: () => E.toggleWrap('~~'), checked: () => fmt.has('strike') });
  C('format.code', { ...ed, label: 'Inline code', icon: 'code', key: 'Mod+E', keywords: 'monospace', run: () => E.toggleWrap('`', '`', 'code'), checked: () => fmt.has('code') });
  // Highlight, font colour, font and size: <span style="…"> / <div style="…"> (see E.applyStyle).
  // args.color from the colour picker ('none' removes); without args the button applies the
  // last colour picked, or removes the highlight the cursor is in.
  const styleNow = () => { try { return E.styleAt(); } catch (e) { return new Map(); } };
  MD.cssFontName = (f) => (/^[A-Za-z][A-Za-z -]*$/.test(f) ? f : "'" + f.replace(/'/g, '') + "'");
  MD.plainFontName = (v) => String(v || '').split(',')[0].trim().replace(/^["']|["']$/g, '');
  const colorCmd = (prop, pref, fallback) => (a) => {
    if (a && a.color !== undefined) {
      if (a.color !== 'none') MD.setPref(pref, a.color);
      E.applyStyle({ [prop]: a.color === 'none' ? null : a.color });
      return;
    }
    // ==marked== text (checked now, not from the ribbon's state, which follows the cursor a moment later)
    if (prop === 'background-color' && E.activeFormats().has('highlight')) { E.toggleWrap('==', '=='); return; }
    if (styleNow().has(prop)) E.applyStyle({ [prop]: null });
    else E.applyStyle({ [prop]: MD.pref(pref) || fallback });
  };
  C('format.highlight', { ...ed, label: 'Highlight', icon: 'highlight', key: 'Mod+Shift+H', keywords: 'mark marker yellow background colour color', run: colorCmd('background-color', 'highlightColor', 'yellow'), checked: () => fmt.has('highlight') || styleNow().has('background-color') });
  C('format.color', { ...ed, label: 'Font color', icon: 'font-color', key: 'Mod+Shift+C', keywords: 'text colour color red', run: colorCmd('color', 'fontColor', '#c00000') });
  C('format.fontFamily', { ...ed, label: 'Font', icon: 'font', keywords: 'typeface family arial', run: (a) => {
    const f = a && a.family != null ? String(a.family).trim() : '';
    if (f) MD.rememberFont(f);
    E.applyStyle({ 'font-family': f ? MD.cssFontName(f) : null }, { block: !!(a && a.block) });
  } });
  C('format.fontSize', { ...ed, label: 'Font size', icon: 'font-size', keywords: 'points pt bigger smaller', run: (a) => {
    let v = a && a.size != null ? String(a.size).trim() : '';
    if (/^\d+(\.\d+)?$/.test(v)) v += 'pt';
    if (v && !/^\d+(\.\d+)?(pt|px|em|rem|%)$/.test(v)) { MD.toast('Font size: a number such as 12 or 12pt'); return; }
    E.applyStyle({ 'font-size': v || null }, { block: !!(a && a.block) });
  } });
  const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
  MD.fontSizes = SIZES;
  const stepSize = (dir) => {
    const cur = parseFloat(styleNow().get('font-size')) || parseFloat(E.frontMatter().fontsize) || 12;
    const next = dir > 0 ? SIZES.find((s) => s > cur) || 96 : [...SIZES].reverse().find((s) => s < cur) || 6;
    MD.run('format.fontSize', { size: next + 'pt' });
  };
  C('format.grow', { ...ed, label: 'Increase font size', icon: 'font-grow', run: () => stepSize(1) });
  C('format.shrink', { ...ed, label: 'Decrease font size', icon: 'font-shrink', run: () => stepSize(-1) });
  /** Recently used fonts (first in the font list). */
  MD.rememberFont = (f) => { const r = (MD.pref('recentFonts') || []).filter((x) => x !== f); r.unshift(f); MD.setPref('recentFonts', r.slice(0, 8)); };
  /** The installed fonts ({family, mono, sans, serif, bundled}), from the server, once. */
  let fontsPromise = null;
  MD.fonts = () => (fontsPromise = fontsPromise || MD.api('/api/fonts').then((r) => r.fonts || []).catch(() => { fontsPromise = null; return []; }));
  C('format.sub', { ...ed, label: 'Subscript', icon: 'subscript', key: 'Mod+=', run: () => E.toggleWrap('~', '~', '2') });
  C('format.sup', { ...ed, label: 'Superscript', icon: 'superscript', key: 'Mod+Shift+=', run: () => E.toggleWrap('^', '^', '2') });
  C('format.clear', { ...ed, label: 'Clear formatting', icon: 'clear', key: 'Mod+Space', run: () => E.clearFormatting() });
  C('format.normal', { ...ed, label: 'Normal text', icon: 'pilcrow', key: 'Mod+Alt+0', run: () => E.setHeading(0), checked: () => E.currentHeading() === 0 });
  for (let i = 1; i <= 6; i++) C('format.h' + i, { ...ed, label: 'Heading ' + i, icon: 'heading', key: i <= 4 ? 'Mod+Alt+' + i : null, keywords: 'title style', run: () => E.setHeading(i), checked: () => E.currentHeading() === i });
  C('format.bullets', { ...ed, label: 'Bullets', icon: 'list-bullet', key: 'Mod+Shift+8', keywords: 'list unordered', run: () => E.toggleLines('bullet'), checked: () => fmt.has('bullet') });
  C('format.numbering', { ...ed, label: 'Numbering', icon: 'list-number', key: 'Mod+Shift+7', keywords: 'list ordered', run: () => E.toggleLines('number'), checked: () => fmt.has('number') });
  C('format.checklist', { ...ed, label: 'Checklist', icon: 'list-check', key: 'Mod+Shift+9', keywords: 'task todo', run: () => E.toggleLines('task'), checked: () => fmt.has('task') });
  C('format.quote', { ...ed, label: 'Quote', icon: 'quote', key: 'Mod+Shift+.', keywords: 'blockquote', run: () => E.toggleLines('quote'), checked: () => fmt.has('quote') });
  C('format.indent', { ...ed, label: 'Increase indent', icon: 'indent', key: 'Mod+]', run: () => { CM.indentMore(E.view); E.focus(); } });
  C('format.outdent', { ...ed, label: 'Decrease indent', icon: 'outdent', key: 'Mod+[', run: () => { CM.indentLess(E.view); E.focus(); } });

  // ================================================================== insert
  C('insert.table', { ...ed, label: 'Table', icon: 'table', keywords: 'grid rows columns', run: (a) => { const r = (a && a.rows) || 3, c = (a && a.cols) || 3; E.insertBlock(E.tableMarkdown(r, c)); } });
  C('insert.tableDialog', { ...ed, label: 'Insert table…', icon: 'table', run: async () => {
    const rows = h('input.md-input', { type: 'number', min: 2, max: 100, value: 4 });
    const cols = h('input.md-input', { type: 'number', min: 1, max: 20, value: 3 });
    const v = await MD.dialog({ title: 'Insert table', body: h('div.md-form-row', MD.field('Rows (with the header)', rows), MD.field('Columns', cols)), buttons: [{ label: 'Cancel', value: null }, { label: 'Insert', primary: true, value: () => ({ rows: +rows.value, cols: +cols.value }) }] });
    if (v) MD.run('insert.table', v);
  } });
  C('table.addRow', { ...ed, label: 'Add row', icon: 'plus', keywords: 'table', run: () => E.tableAddRow() });
  C('table.addCol', { ...ed, label: 'Add column', icon: 'plus', keywords: 'table', run: () => E.tableAddCol() });
  C('table.delRow', { ...ed, label: 'Delete row', icon: 'minus', keywords: 'table', run: () => E.tableDelRow() });
  C('table.format', { ...ed, label: 'Tidy table', icon: 'table', keywords: 'align pipes format', run: () => E.formatTable() });
  C('insert.csv', { ...ed, label: 'Table from CSV file…', icon: 'csv', keywords: 'spreadsheet import data excel', run: async () => {
    const p = await MD.pickFile({ title: 'Insert a CSV file', filter: 'data', extensions: ['csv', 'tsv'] });
    if (!p) return;
    const rel = await MD.relativeAsset(p, false);
    E.insertBlock('@import "' + rel + '" {caption="' + S + MD.basename(p).replace(/\.\w+$/, '') + S + '"}');
  } });
  C('insert.picture', { ...ed, label: 'Picture…', icon: 'picture', keywords: 'image photo figure', run: async () => {
    const p = await MD.pickFile({ title: 'Insert a picture', filter: 'image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif', 'bmp', 'heic', 'tif', 'tiff'] });
    if (!p) return;
    const rel = await MD.relativeAsset(p, true);
    const alt = MD.basename(p).replace(/\.\w+$/, '').replace(/[-_]+/g, ' ');
    E.insertBlock('![' + S + alt + S + '](' + encodePath(rel) + ' "' + alt + '")');
  } });
  C('insert.video', { ...ed, label: 'Video or audio…', icon: 'video', keywords: 'movie mp4 sound music youtube', run: async () => {
    const p = await MD.pickFile({ title: 'Insert a video or audio file', filter: 'image', extensions: ['mp4', 'webm', 'mkv', 'mov', 'avi', 'm4v', 'mp3', 'wav', 'ogg', 'm4a', 'flac'] });
    if (!p) return;
    const rel = await MD.relativeAsset(p, false);
    E.insertBlock('![' + S + MD.basename(p) + S + '](' + encodePath(rel) + '){width=640}');
  } });
  C('insert.online', { ...ed, label: 'Online video…', icon: 'video', keywords: 'youtube vimeo', run: async () => {
    const u = await MD.prompt('Online video', 'YouTube or Vimeo link', '', { placeholder: 'https://youtu.be/…' });
    if (u) E.insertBlock('![Video](' + u.trim() + ')');
  } });
  function encodePath(p) { return /[\s()]/.test(p) ? '<' + p + '>' : p; }
  C('insert.link', { ...ed, label: 'Link…', icon: 'link', key: 'Mod+K', keywords: 'hyperlink url', run: async () => {
    const sel = E.selectedText();
    const text = h('input.md-input', { value: /^https?:\/\//.test(sel) ? '' : sel, placeholder: 'Text to display' });
    const url = h('input.md-input', { value: /^https?:\/\//.test(sel) ? sel : '', placeholder: 'https://… or other-file.md or #heading', spellcheck: false });
    const browse = h('button.md-btn', { type: 'button' }, 'File…');
    browse.addEventListener('click', async () => { const p = await MD.pickFile({ title: 'Link to a file', filter: 'all' }); if (p) url.value = await MD.relativeAsset(p, false); });
    const heads = (ML.state.headings || []);
    const headSel = heads.length ? MD.select([['', 'Place in this document…'], ...heads.map((x) => ['#' + x.id, '  '.repeat(x.level - 1) + x.text])], '') : null;
    if (headSel) headSel.addEventListener('change', () => { if (headSel.value) { url.value = headSel.value; if (!text.value) text.value = headSel.selectedOptions[0].textContent.trim(); } });
    const v = await MD.dialog({ title: 'Insert link', width: 520, body: h('div', MD.field('Text', text), h('div.md-form-row', MD.field('Address', url), h('div.md-field-btn', browse)), headSel ? MD.field('Or a heading', headSel) : null), buttons: [{ label: 'Cancel', value: null }, { label: 'Insert', primary: true, value: () => ({ t: text.value, u: url.value.trim() }) }] });
    if (!v || !v.u) return;
    E.insert('[' + (v.t || v.u) + '](' + encodePath(v.u) + ')');
  } });
  C('insert.footnote', { ...ed, label: 'Footnote', icon: 'footnote', key: 'Mod+Alt+F', keywords: 'reference note citation', run: () => {
    const doc = E.get();
    let n = 1; while (doc.includes('[^' + n + ']')) n++;
    const pos = E.view.state.selection.main.to;
    const end = E.view.state.doc.length;
    const tail = (doc.endsWith('\n') ? '' : '\n') + '\n[^' + n + ']: ';
    E.view.dispatch({ changes: [{ from: pos, insert: '[^' + n + ']' }, { from: end, insert: tail + 'Footnote text.' }], selection: { anchor: end + ('[^' + n + ']').length + tail.length, head: end + ('[^' + n + ']').length + tail.length + 'Footnote text.'.length }, scrollIntoView: true });
    E.focus();
  } });
  C('insert.toc', { ...ed, label: 'Table of contents', icon: 'toc', keywords: 'contents toc index', run: () => E.insertBlock('## Contents\n\n[TOC]') });
  C('insert.pagebreak', { ...ed, label: 'Page break', icon: 'page-break', key: 'Mod+Enter', keywords: 'new page', run: () => {
    if (MD.isDeck()) MD.run('slides.new'); else E.insertBlock('<!-- pagebreak -->');
  } });
  C('insert.cover', { ...ed, label: 'Cover page', icon: 'cover', keywords: 'title page front', run: () => {
    const fm = E.frontMatter();
    const title = fm.title || 'Document title';
    const block = '<div class="cover">\n\n# ' + S + title + S + '\n\n' + (fm.subtitle || 'Subtitle') + '\n\n**' + (fm.author || MD.app.author || 'Author') + '**  \n' + (fm.date || new Date().toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })) + '\n\n</div>\n\n<!-- pagebreak -->';
    E.view.dispatch({ selection: { anchor: bodyStart() } });
    E.insertBlock(block);
  } });
  function bodyStart() { const m = /^---\r?\n[\s\S]*?\r?\n(---|\.\.\.)\r?\n?/.exec(E.get()); return m ? m[0].length : 0; }
  C('insert.code', { ...ed, label: 'Code block', icon: 'code-block', key: 'Mod+Alt+C', keywords: 'snippet program fence', run: (a) => E.insertBlock('```' + ((a && a.lang) || 'python') + (a && a.run ? ' {cmd=true}' : '') + '\n' + S + ((a && a.code) || (a && a.lang === 'text' ? 'text' : '# code')) + S + '\n```') });
  C('insert.mathInline', { ...ed, label: 'Inline equation', icon: 'sigma', key: 'Mod+Shift+M', keywords: 'math latex formula', run: () => { const s = E.selectedText(); E.insert('$' + S + (s || 'x^2') + S + '$'); } });
  C('insert.math', { ...ed, label: 'Equation', icon: 'math', keywords: 'math latex formula katex', run: (a) => E.insertBlock('$$\n' + ((a && a.tex) || S + 'E = mc^2' + S) + '\n$$') });
  C('insert.diagram', { ...ed, label: 'Diagram', icon: 'diagram', keywords: 'mermaid flowchart uml graph', run: (a) => { const d = MD.diagrams.find((x) => x.id === ((a && a.id) || 'flowchart')); E.insertBlock('```' + d.lang + '\n' + d.code + '\n```'); } });
  C('insert.chart', { ...ed, label: 'Chart', icon: 'chart', keywords: 'graph plot bar line pie chartjs', run: (a) => { const d = MD.charts.find((x) => x.id === ((a && a.id) || 'bar')); E.insertBlock('```' + (d.lang || 'chart') + '\n' + d.code + '\n```'); } });
  C('insert.callout', { ...ed, label: 'Callout', icon: 'callout', keywords: 'alert note tip warning admonition box', run: (a) => { const c = MD.callouts.find((x) => x.id === ((a && a.id) || 'NOTE')); const sel = E.selectedText(); E.insertBlock('> [!' + c.id + ']\n> ' + S + (sel || c.text) + S); } });
  C('insert.details', { ...ed, label: 'Collapsible section', icon: 'chevron-down', keywords: 'details summary spoiler fold', run: () => E.insertBlock('<details>\n<summary>' + S + 'Click to expand' + S + '</summary>\n\nHidden content.\n\n</details>') });
  C('insert.hr', { ...ed, label: 'Horizontal line', icon: 'hr', keywords: 'rule divider separator', run: () => E.insertBlock('---') });
  C('insert.date', { ...ed, label: 'Date & time…', icon: 'calendar', keywords: 'today now', run: async (a) => {
    const d = new Date();
    const fmts = [d.toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }), d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), d.toISOString().slice(0, 10), d.toLocaleDateString(), d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }), d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })];
    if (a && a.quick) { E.insert(fmts[0]); return; }
    MD.menu(a && a.anchor || document.querySelector('[data-cmd="insert.date"]') || { x: innerWidth / 2, y: 120 }, fmts.map((f) => ({ label: f, run: () => E.insert(f) })));
  } });
  C('insert.emoji', { ...ed, label: 'Emoji', icon: 'emoji', keywords: 'smiley icon', run: (a) => {
    const grid = h('div.md-emoji-grid');
    for (const e of MD.emoji) { const b = h('button.md-emoji', { title: ':' + e + ':' }, ':' + e + ':'); b.dataset.code = e; grid.append(b); }
    grid.addEventListener('click', (ev) => { const b = ev.target.closest('.md-emoji'); if (b) { MD.closeMenu(); E.insert(':' + b.dataset.code + ':'); } });
    MD.popup(a && a.anchor || document.querySelector('[data-cmd="insert.emoji"]') || { x: innerWidth / 2, y: 120 }, h('div', h('div.md-menu-header', 'Emoji (rendered from :shortcodes:)'), grid));
    renderEmojiPreview(grid);
  } });
  function renderEmojiPreview(grid) {
    // ask the renderer for the glyphs (comrak's shortcode table)
    MD.api('/api/emoji-preview?names=' + encodeURIComponent(MD.emoji.join(','))).catch(() => null).then((map) => { if (!map) return; grid.querySelectorAll('.md-emoji').forEach((b) => { if (map[b.dataset.code]) b.textContent = map[b.dataset.code]; }); });
  }
  C('insert.symbol', { ...ed, label: 'Symbol', icon: 'omega', keywords: 'character special copyright arrow greek', run: (a) => {
    const grid = h('div.md-symbol-grid');
    for (const s of MD.symbols) grid.append(h('button.md-symbol', { title: 'U+' + s.codePointAt(0).toString(16).toUpperCase().padStart(4, '0') }, s));
    grid.addEventListener('click', (ev) => { const b = ev.target.closest('.md-symbol'); if (b) { MD.closeMenu(); E.insert(b.textContent); } });
    MD.popup(a && a.anchor || document.querySelector('[data-cmd="insert.symbol"]') || { x: innerWidth / 2, y: 120 }, h('div', h('div.md-menu-header', 'Symbols'), grid));
  } });
  C('insert.molecule', { ...ed, label: '3D molecule', icon: 'molecule', keywords: 'chemistry protein pdb smiles', run: () => E.insertBlock('```molstar {pdb=1CRN height=360 title="Crambin" spin=true}\n```') });
  C('insert.smiles', { ...ed, label: 'Chemical structure', icon: 'molecule', keywords: 'chemistry smiles', run: () => E.insertBlock('```smiles\nCC(=O)OC1=CC=CC=C1C(=O)O aspirin\nCN1C=NC2=C1C(=O)N(C(=O)N2C)C caffeine\n```') });
  C('insert.import', { ...ed, label: 'Include a file…', icon: 'file-text', keywords: 'import include embed markdown code', run: async () => {
    const p = await MD.pickFile({ title: 'Include a file', filter: 'all' });
    if (!p) return;
    E.insertBlock('@import "' + await MD.relativeAsset(p, false) + '"');
  } });
  C('insert.properties', { ...ed, label: 'Properties (front matter)…', icon: 'front-matter', keywords: 'title author metadata yaml', run: () => MD.editProperties() });

  // ================================================================== design
  C('design.theme', { ...ed, label: 'Theme', icon: 'theme', keywords: 'style look colors fonts', run: (a) => {
    const id = a && a.id;
    if (!id) return;
    E.setFrontMatter({ theme: id === 'office' && !MD.isDeck() && !E.frontMatter().theme ? 'office' : id });
    MD.toast('Theme: ' + (MD.themes.find((x) => x.id === id) || {}).name);
  }, checked: (a) => a && MD.currentTheme() === a.id });
  // the document's fonts: mainfont, monofont and fontsize in the front matter (pandoc's names)
  const docFont = (key, label) => (a) => {
    if (!(a && a.value !== undefined)) { MD.selectTab('design'); setTimeout(() => document.querySelector('[data-fontbox="' + { mainfont: 'docMain', monofont: 'docMono', fontsize: 'docSize' }[key] + '"]')?.focus(), 50); return; }
    let v = String(a.value || '').trim();
    if (key === 'fontsize' && /^\d+(\.\d+)?$/.test(v)) v += 'pt';
    if (key === 'fontsize' && v && !/^\d+(\.\d+)?(pt|px)$/.test(v)) { MD.toast('Font size: a number such as 12 or 12pt'); return; }
    if (key === 'mainfont' && v) MD.rememberFont(v);
    E.setFrontMatter({ [key]: v || null });
    MD.toast(label + ': ' + (v || 'from the theme'));
  };
  C('design.mainfont', { ...ed, label: 'Document font', icon: 'font', keywords: 'mainfont body font typeface whole document', run: docFont('mainfont', 'Document font') });
  C('design.monofont', { ...ed, label: 'Document code font', icon: 'code', keywords: 'monofont monospace code font fixed width', run: docFont('monofont', 'Code font') });
  C('design.fontsize', { ...ed, label: 'Document font size', icon: 'font-size', keywords: 'fontsize text size points', run: docFont('fontsize', 'Font size') });
  C('design.paper', { ...ed, label: 'Paper size', icon: 'page-size', keywords: 'a4 letter page size print', run: (a) => E.setFrontMatter({ paper: a && a.id !== 'a4' ? a.id : null }) });
  C('design.orientation', { ...ed, label: 'Orientation', icon: 'orientation', keywords: 'portrait landscape print', run: (a) => E.setFrontMatter({ orientation: a && a.id === 'landscape' ? 'landscape' : null }) });
  C('design.margins', { ...ed, label: 'Margins', icon: 'margins', keywords: 'print page', run: (a) => E.setFrontMatter({ margins: a && a.id !== 'normal' ? a.id : null }) });
  C('design.watermark', { ...ed, label: 'Watermark…', icon: 'watermark', keywords: 'draft confidential', run: async (a) => {
    let v = a && a.text;
    if (v === undefined) v = await MD.prompt('Watermark', 'Text shown diagonally behind every page (empty = none)', E.frontMatter().watermark || 'DRAFT');
    if (v === null) return;
    E.setFrontMatter({ watermark: v.trim() || null });
  } });
  C('design.numbered', { ...ed, label: 'Numbered headings', icon: 'list-number', keywords: 'section numbers 1.1', run: () => { const on = !isOn(E.frontMatter().numbered); E.setFrontMatter({ numbered: on ? 'true' : null }); }, checked: () => isOn(E.frontMatter().numbered) });
  C('design.justify', { ...ed, label: 'Justify text', icon: 'pilcrow', keywords: 'align', run: () => { const on = !isOn(E.frontMatter().justify); E.setFrontMatter({ justify: on ? 'true' : null }); }, checked: () => isOn(E.frontMatter().justify) });
  function isOn(v) { return v === true || v === 'true' || v === 'yes'; }

  // ================================================================== slides
  C('slides.new', { ...ed, label: 'New slide', icon: 'slide-new', key: 'Mod+M', keywords: 'add page', run: (a) => { E.newSlide(a && a.layout || 'content'); fillAuthor(); } });
  function fillAuthor() {
    const doc = E.get();
    if (doc.includes('{{author}}') || doc.includes('{{date}}')) {
      const v = E.view.state;
      const changes = [];
      const re = /\{\{(author|date)\}\}/g;
      let m;
      while ((m = re.exec(doc))) changes.push({ from: m.index, to: m.index + m[0].length, insert: m[1] === 'author' ? (MD.app.author || 'Your name') : new Date().toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) });
      E.view.dispatch({ changes, selection: v.selection.map(v.changes(changes)) });
    }
  }
  C('slides.layout', { ...ed, label: 'Layout', icon: 'slide-layout', keywords: 'slide design', run: (a) => { if (a && a.layout !== undefined) E.setSlideClass(MD.slideLayouts[a.layout] ? MD.slideLayouts[a.layout].cls : a.layout); },
    checked: (a) => { if (!a || !MD.isDeck()) return false; const L = MD.slideLayouts[a.layout]; return !!L && MD.currentSlideClass() === L.cls; } });
  C('slides.duplicate', { ...ed, label: 'Duplicate slide', icon: 'copy', run: () => E.duplicateSlide() });
  C('slides.delete', { ...ed, label: 'Delete slide', icon: 'trash', run: () => E.deleteSlide() });
  C('slides.up', { ...ed, label: 'Move slide up', icon: 'chevron-up', key: 'Mod+Alt+Up', run: () => E.moveSlide(-1) });
  C('slides.down', { ...ed, label: 'Move slide down', icon: 'chevron-down', key: 'Mod+Alt+Down', run: () => E.moveSlide(1) });
  C('slides.notes', { ...ed, label: 'Speaker notes', icon: 'notes', keywords: 'presenter notes', run: () => E.addNotes() });
  C('slides.background', { ...ed, label: 'Background color…', icon: 'background', run: async (a) => {
    const colors = ['', '#ffffff', '#f8fafc', '#fef3c7', '#dcfce7', '#dbeafe', '#ede9fe', '#fce7f3', '#111827', '#0b1220', '#1e3a8a', '#065f46', '#7c2d12', '#581c87'];
    const grid = h('div.md-swatches');
    for (const c of colors) { const b = h('button.md-swatch', { title: c || 'Theme default', style: { background: c || 'linear-gradient(135deg,#fff 45%,#e11d48 47%,#e11d48 53%,#fff 55%)' } }); b.dataset.c = c; grid.append(b); }
    grid.addEventListener('click', (e) => { const b = e.target.closest('.md-swatch'); if (b) { MD.closeMenu(); E.setSlideAttr('data-background-color', b.dataset.c); } });
    MD.popup((a && a.anchor) || document.querySelector('[data-cmd="slides.background"]') || { x: innerWidth / 2, y: 120 }, h('div', h('div.md-menu-header', 'Slide background'), grid));
  } });
  C('slides.present', { label: 'From beginning', icon: 'present', key: 'F5', keywords: 'slideshow presentation fullscreen play', run: () => MD.present(1) });
  C('slides.presentCurrent', { label: 'From current slide', icon: 'present-current', key: 'Shift+F5', keywords: 'slideshow presentation', run: () => MD.present(E.currentSlide()) });
  C('slides.fromHeadings', { ...ed, label: 'Convert to slides', icon: 'slides-grid', keywords: 'outline headings deck powerpoint', run: async () => {
    if (MD.isDeck()) { MD.toast('This document already has slides'); return; }
    const ok = await MD.confirm('Convert to slides', 'Start a new slide at every level-2 heading (##) and switch to a slide theme? You can undo this.', 'Convert');
    if (!ok) return;
    const doc = E.view.state.doc;
    const changes = [];
    let inFence = false;
    let first = true;
    for (let i = 1; i <= doc.lines; i++) {
      const l = doc.line(i);
      if (/^\s*(```|~~~)/.test(l.text)) inFence = !inFence;
      if (inFence) continue;
      if (/^##\s/.test(l.text) || (/^#\s/.test(l.text) && !first)) {
        if (first && !/^#\s/.test(l.text)) { /* content before the first ## is slide 1 */ }
        changes.push({ from: l.from, insert: '<!-- slide -->\n\n' });
      }
      if (/^#{1,2}\s/.test(l.text)) first = false;
    }
    if (!changes.length) { MD.toast('No ## headings to split at'); return; }
    E.view.dispatch({ changes, userEvent: 'input' });
    const th = MD.themes.find((x) => x.id === MD.currentTheme());
    if (!th || th.kind !== 'deck') E.setFrontMatter({ theme: 'paper' });
    MD.toast('Converted into ' + (changes.length + 1) + ' slides');
  } });

  // ================================================================== review
  C('review.spelling', { label: 'Check spelling as you type', icon: 'spell', key: 'F7', keywords: 'spellcheck proofing', run: () => MD.setPref('spellcheck', !MD.pref('spellcheck')), checked: () => !!MD.pref('spellcheck') });
  C('review.wordcount', { label: 'Word count', icon: 'wordcount', key: 'Mod+Shift+G', keywords: 'statistics characters reading time', run: () => MD.wordCountDialog() });
  C('review.accessibility', { label: 'Check accessibility', icon: 'accessibility', keywords: 'a11y alt text headings', run: () => MD.accessibilityDialog() });
  C('review.outline', { label: 'Outline', icon: 'outline', keywords: 'headings structure navigation', run: () => MD.setNav(true, 'outline') });

  // ================================================================== view
  C('view.write', { label: 'Write', icon: 'view-write', keywords: 'editor only', run: () => MD.setView('write'), checked: () => MD.view() === 'write' });
  C('view.split', { label: 'Split', icon: 'view-split', keywords: 'editor preview side by side', run: () => MD.setView('split'), checked: () => MD.view() === 'split' });
  C('view.read', { label: 'Read', icon: 'view-read', keywords: 'preview only reading mode', run: () => MD.setView('read'), checked: () => MD.view() === 'read' });
  C('view.nav', { label: 'Navigation pane', icon: 'nav-pane', key: 'Mod+\\', keywords: 'outline sidebar headings slides thumbnails', run: () => MD.setNav(!MD.navOpen()), checked: () => MD.navOpen() });
  C('view.lineNumbers', { label: 'Line numbers', icon: 'line-numbers', run: () => MD.setPref('lineNumbers', !MD.pref('lineNumbers')), checked: () => !!MD.pref('lineNumbers') });
  C('view.wrap', { label: 'Word wrap', icon: 'wrap', key: 'Alt+Z', run: () => MD.setPref('wrap', !MD.pref('wrap')), checked: () => !!MD.pref('wrap') });
  C('view.sync', { label: 'Scroll with the cursor', icon: 'sync', keywords: 'sync follow', run: () => MD.setPref('sync', !MD.pref('sync')), checked: () => !!MD.pref('sync') });
  C('view.zoomIn', { label: 'Zoom in', icon: 'zoom-in', run: () => ML.setZoom(ML.state.zoom + 0.1) });
  C('view.zoomOut', { label: 'Zoom out', icon: 'zoom-out', run: () => ML.setZoom(ML.state.zoom - 0.1) });
  C('view.zoomReset', { label: '100%', icon: 'zoom-100', key: 'Mod+0', run: () => ML.setZoom(1) });
  C('view.pageWidth', { label: 'Page width', icon: 'page-width', keywords: 'fit zoom', run: () => MD.zoomToWidth() });
  C('view.light', { label: 'Light', icon: 'sun', keywords: 'theme appearance', run: () => MD.setPref('appearance', 'light'), checked: () => MD.pref('appearance') === 'light' });
  C('view.dark', { label: 'Dark', icon: 'moon', keywords: 'theme appearance night', run: () => MD.setPref('appearance', 'dark'), checked: () => MD.pref('appearance') === 'dark' });
  C('view.system', { label: 'Use system setting', icon: 'contrast', keywords: 'theme appearance auto', run: () => MD.setPref('appearance', 'system'), checked: () => !MD.pref('appearance') || MD.pref('appearance') === 'system' });
  C('view.darkPage', { label: 'Dark page', icon: 'moon', keywords: 'night mode preview page dark', run: () => MD.setPref('darkPage', !MD.pref('darkPage')), checked: () => !!MD.pref('darkPage') });
  C('view.ribbon', { label: 'Collapse the ribbon', icon: 'chevron-up', key: 'Mod+F1', run: () => MD.setPref('ribbonCollapsed', !MD.pref('ribbonCollapsed')), checked: () => !!MD.pref('ribbonCollapsed') });
  C('view.focus', { label: 'Focus', icon: 'focus', key: 'F11', keywords: 'distraction free zen fullscreen', run: () => MD.toggleFocus(), checked: () => document.body.classList.contains('md-focus') });
  C('view.refresh', { label: 'Refresh preview', icon: 'refresh', key: 'Mod+R', keywords: 'rerender reload diagrams', run: () => document.getElementById('ml-btn-refresh').click() });
  C('view.mathEngine', { label: 'Math: KaTeX / MathJax', icon: 'math-engine', keywords: 'latex katex mathjax', run: () => ML.toggleMathEngine && ML.toggleMathEngine() });
  C('view.runCode', { label: 'Run code chunks', icon: 'run', keywords: 'python execute script', run: () => { ML.post('/api/allow-scripts'); MD.toast('Code chunks run in this session (File › Options to always allow)'); } });

  // ================================================================== help
  C('help.search', { label: 'Search commands', icon: 'search', key: 'Alt+Q', keywords: 'tell me palette', run: () => { const s = document.getElementById('md-search'); s.focus(); s.select(); } });
  C('help.palette', { label: 'Command palette', icon: 'command', key: 'Mod+Shift+P', run: () => MD.run('help.search') });
  C('help.shortcuts', { label: 'Keyboard shortcuts', icon: 'keyboard', key: 'Mod+/', run: () => MD.shortcutsDialog() });
  C('help.about', { label: 'About MdCraft', icon: 'logo', run: () => MD.openBackstage('about') });
  C('help.markdown', { label: 'Markdown guide', icon: 'help', keywords: 'syntax help manual tour', run: () => MD.newFromTemplate('welcome') });

  // ================================================================== keyboard
  function keyOf(e) {
    const mod = MD.isMac ? e.metaKey : e.ctrlKey;
    let k = e.key;
    if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
    else if (e.code === 'Equal') k = '=';
    else if (e.code === 'Minus') k = '-';
    else if (e.code === 'Period') k = '.';
    else if (e.code === 'Comma') k = ',';
    else if (e.code === 'Backslash') k = '\\';
    else if (e.code === 'BracketLeft') k = '[';
    else if (e.code === 'BracketRight') k = ']';
    else if (e.code === 'Slash') k = '/';
    else if (e.code === 'Space') k = 'Space';
    else if (e.code && /^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
    else if (k === 'ArrowUp') k = 'Up'; else if (k === 'ArrowDown') k = 'Down';
    else if (k.length === 1) k = k.toUpperCase();
    return (mod ? 'Mod+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + k;
  }
  const byKey = new Map();
  MD.indexKeys = () => { byKey.clear(); for (const c of commands.values()) if (c.key) byKey.set(c.key.replace(/\+([a-z])$/, (m, x) => '+' + x.toUpperCase()), c.id); };
  MD.indexKeys();
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.isComposing) return;
    if (MD.dialogOpen() || (MD.presenting && MD.presenting())) return;
    const k = keyOf(e);
    if (k === 'Escape') { if (MD.backstageOpen && MD.backstageOpen()) { e.preventDefault(); MD.closeBackstage(); } else if (document.body.classList.contains('md-focus')) MD.toggleFocus(); return; }
    const id = byKey.get(k);
    if (!id) return;
    const c = commands.get(id);
    // plain typing keys never trigger commands; Mod/Alt/F-keys do
    if (!/Mod\+|Alt\+|^F\d|Shift\+F\d/.test(k)) return;
    if (MD.backstageOpen && MD.backstageOpen() && c.editing) return;
    // inside an input field, leave clipboard/undo/select keys alone
    const tag = (document.activeElement && document.activeElement.tagName) || '';
    if (/INPUT|TEXTAREA|SELECT/.test(tag) && /^Mod\+[ACVXZY]$/.test(k)) return;
    e.preventDefault(); e.stopPropagation();
    MD.run(id);
  }, true);
  MD.keyOf = keyOf;
})();
