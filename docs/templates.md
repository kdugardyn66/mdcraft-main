# Templates, themes and building blocks

mdcraft documents are ordinary Markdown. A few conventions give them the look of a Word document or a
PowerPoint deck; everything degrades gracefully in other Markdown viewers.

## Front matter

```yaml
---
title: Annual Performance Report 2026
author: Kris Dugardyn
date: 14 October 2026
theme: report          # see the theme lists below
paper: a4              # a4 · letter · a5 · legal
orientation: portrait  # portrait · landscape
margins: normal        # normal · narrow · wide
watermark: DRAFT       # diagonal text on every page
numbered: true         # 1. / 1.1 / 1.1.1 heading numbers
justify: true          # justified paragraphs
mainfont: Montserrat   # the document's font (instead of the theme's)
monofont: JetBrains Mono   # the font of code
fontsize: 12pt         # body text size (pt or px; slides keep their own sizes)
---
```

The **Design** tab, **File › Info** and **File › Print** edit these keys for you. Default
`mainfont`, `monofont` and `fontsize` for new documents are set in **File › Options ›
Document fonts**. A font that isn't installed falls back to a similar one.

## My templates

Your own templates are listed under **File › New › My templates**, apart from the standard
ones. They are Markdown files in the templates folder (`~/Library/Application Support/mdcraft/templates`
on macOS, `~/.config/mdcraft/templates` on Linux):

| Extension | Makes |
|---|---|
| `.mdd` | a document |
| `.mds` | a slide deck |

- **Create:** *New document template* or *New slide template* on the New page, or save any
  document as a template: **File › Save As**, File type **Markdown template** (MdCraft picks
  `.mdd` or `.mds` from the document). Templates are always saved in the templates folder,
  whatever folder the Save window shows; only the name you type is used.
- **Use:** click it on the New page (or on Home): a new, unsaved document. The placeholders
  below are filled in.
- **Edit:** the pencil on the card opens the template file itself; save it as usual.
- **Rename / delete:** the other buttons on the card. Deleting moves the file to the Trash.

Placeholders: `{{author}}`, `{{date}}` (2026-10-21), `{{date_long}}` (21 October 2026),
`{{month_year}}`, `{{year}}`, `{{next_year}}`, `{{quarter}}`.

## Fonts and colours for part of a document

The **Font** group on the Home tab (font, size, highlight, font colour) writes HTML with a
`style`, which Markdown keeps as it is: a `<span>` for words, a `<div>` (with blank lines, so
the Markdown inside still works) for whole paragraphs:

```markdown
Some <span style="background-color: yellow">highlighted</span> words.

<div style="font-family: Arial; font-size: 20pt; color: #333333; background-color: #f2f2f2; padding: 8px">

A full paragraph with its own font, size, colour and background.

</div>
```

## Document themes (Word-style)

| Theme | Look | Used by |
|---|---|---|
| `office` | Source Sans, blue headings, banded tables | blank, welcome, proposal, memo, minutes |
| `report` | serif body, navy & brick red, full-bleed cover, formal tables | report |
| `classic` | all serif, centred title, justified, booktabs tables | paper |
| `modern` | Inter, teal accent bars, rounded tables | résumé, specification |
| `letter` | serif, letterhead with a thin rule | letter |
| `newsletter` | masthead, orange accents, two-column stories | newsletter |
| `github` | MarkDown Live's original GitHub look | — |

## Slide themes (PowerPoint-style)

`paper` · `aurora` · `midnight` · `sunrise` · `corporate` · `chalk` · `ocean`

## Pages

| Markdown | Result |
|---|---|
| `<!-- pagebreak -->` (Ctrl+Enter) | a new page when printing; a labelled line on screen |
| `[TOC]` | table of contents from the headings |
| `<div class="cover">` … `</div>` | a cover page (title, subtitle, author, date) |

HTML blocks need a blank line after the opening tag and before the closing tag, so the Markdown
inside is still Markdown:

```markdown
<div class="cover">

# Project Proposal

Customer self-service portal

</div>
```

## Building blocks

| Class | What it makes |
|---|---|
| `kpis` | a list of big-number cards: `- **€48.2 M** revenue, +18 %` |
| `cols` | side-by-side columns: one `<div>` per column inside |
| `columns` | newspaper columns: text flows over two columns |
| `timeline` | a numbered list drawn as a horizontal timeline |
| `letterhead` | organisation name left, contact details right |
| `masthead` | a newsletter title band |
| `memo-head` | the To / From / Subject table of a memo |
| `cv-head`, `cv-role` | résumé header and job lines (modern theme) |
| `signature` | space for a signature under a letter |
| `badge` (`green`, `amber`, `red`) | status pills: `<span class="badge green">On track</span>` |
| `right`, `center`, `small`, `muted` | alignment and quieter text |

Callouts use GitHub's syntax: `> [!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]`, `[!CAUTION]`.

## Slides

A deck is a document with slide separators. The content before the first separator is a slide
too, unless it holds only the front matter.

```markdown
<!-- slide class="title" -->

# Presentation title

<!-- slide -->

## A content slide

- Point

Note: Speaker notes — everything after "Note:" until the next slide.
```

| Layout (`class="…"`) | Use |
|---|---|
| *(none)* | title and content |
| `title` | the opening slide |
| `section` | a section header in the theme's accent colour |
| `two-col` | heading plus `<div class="cols">` columns |
| `agenda` | a numbered list drawn as an agenda |
| `quote` | one big quotation |
| `stat` | one big number with a line of explanation |
| `image` | a picture with a caption |
| `end` | the closing slide |
| `blank`, `center`, `dense` | no padding · centred · smaller text |

`data-background-color="#123456"` on a separator sets that slide's background
(**Slides › Background**).

## Placeholders

`{{author}}` · `{{date}}` · `{{date_long}}` · `{{month_year}}` · `{{year}}` · `{{next_year}}` · `{{quarter}}`

They are filled in when a document is created from a template. Your name comes from
**File › Options › Your name**.

## Adding a template

1. Write `templates/documents/<id>.md` or `templates/slides/<id>.md`, starting with front matter
   that includes `theme:`.
2. Add a line to the catalog in `crates/mdcraft-templates/src/lib.rs`.
3. `cargo test -p mdcraft-templates` checks the front matter, the theme and the placeholders.
