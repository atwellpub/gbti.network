---
title: Ryker
slug: ryker
status: draft
visibility: public
shortDescription: >-
  Inline editing for HTML and Markdown. Export your corrections as agent-ready instructions a model
  can learn from.
categories:
  - devops
  - frameworks
  - chrome-extensions
tags:
  - chrome-extension
  - html
  - markdown
  - inline-editing
  - agent-workflow
  - npx
platforms:
  - Chrome
  - Node.js
pricing: free
version: 0.2.1
icon: ./images/ryker-icon-128x128.webp
iconLarge: ./images/ryker-icon-256x256.webp
featuredImage: ./images/ryker-featured.webp
banner: ./images/ryker-banner.webp
gallery:
  - ./images/ryker-shot-1.webp
  - ./images/ryker-shot-2.webp
  - ./images/ryker-shot-3.webp
  - ./images/ryker-shot-4.webp
  - ./images/ryker-shot-5.webp
links:
  - type: download
    url: https://www.npmjs.com/package/@gbti/ryker
    label: Install the drop-in from npm
    primary: true
  - type: repository
    url: https://github.com/gbti-network/ryker
  - type: documentation
    url: https://github.com/gbti-network/ryker/blob/main/privacy.md
    label: Privacy policy
  - type: support
    url: https://github.com/gbti-network/ryker/issues
    label: Report a bug
type: product
author: atwellpub
---

## Ryker

Ryker is a Chrome extension for editing a document in place and recording every
change you make as a prompt-ready change request. A model can draft a report in
seconds. What it cannot do is know that the third section should have come
first, or that a summary buries its own conclusion. Those corrections are
structural and they are yours, and the usual place to make them is back in the
prompt, describing a document you are looking at but cannot touch.

## Why inline

HTML has become a useful format for delivering rich content when working with
large language models: complete reports, tables, figures, layouts and styled
documents, in a form that renders immediately in a browser. Markdown has
likewise become a common format for structured content.

Both are easy for a model to generate and awkward to edit at the source.
Markdown means switching between source and preview. HTML source separates the
author from the rendered document the reader will actually see. Inline editing
lets you work against the rendered result instead, and Ryker keeps a record of
what you changed while you do it.

## Two ways to use it

**As a Chrome extension.** Click the toolbar button on any HTML page to edit
that document in place. Or open the Ryker workspace and load a Markdown or HTML
file from your own disk. On a tab Chrome will not let it touch, a new tab or a
`chrome://` page, the button opens the workspace instead of failing.

**As a drop-in.** Add Ryker to an HTML document with npx and it travels with the
file. A reader or reviewer can then edit the page and produce a change request
without installing anything.

```bash
npx --yes @gbti/ryker insert ./report.html
```

## Features

- Inline visual editing for HTML and Markdown
- Export content changes as a machine-readable prompt
- An outline built from the document's real heading structure
- Move or delete whole sections from that outline, recorded as moves rather than
  as character diffs
- Revision history tracked per document
- Markdown with nested lists, tables and code fences, returned as the file it came from
- Save the edited document back over the file you opened, or as a new file beside it

## Install into an HTML document

```bash
npx --yes @gbti/ryker insert ./report.html
```

Preview first with `--dry-run`. The installer creates a recoverable
`report.html.ryker-backup`, copies the dependency-free browser bundle beside the
document, and adds one identifiable managed block before `</body>`.

```bash
npx --yes @gbti/ryker doctor ./report.html
npx --yes @gbti/ryker sync ./report.html
npx --yes @gbti/ryker remove ./report.html
```

`insert` writes Ryker into the document. `doctor` checks an existing install and
writes nothing: it verifies the managed block is present and correctly placed,
and that the bundle matches this version of the package. `sync` updates an
existing install. `remove` deletes the managed block from that document and
retains the browser bundle, because other documents in the same folder may share
it.

Ryker requires Node.js 20 or newer for installation. The resulting HTML and
classic browser script work offline and from `file://` without Node.js.

## Privacy

Ryker keeps its editing history in your own browser and sends nothing anywhere:
no server, no account, no sync, no telemetry. The page cannot read it. You can
export the record whenever you like and clear it per document.

The extension asks for no standing access to your browsing. It has no host
permissions, registers no content scripts, and injects nothing until you click
its button. The permission it uses, `activeTab`, grants access to one tab for one
gesture and expires with it.

## License

Ryker is source-available under the custom license included with the package.
Internal-team use, internal commercial use and inclusion with client
deliverables are permitted. Ryker, its forks and its derivatives may not be
sold or shipped or featured as part of a commercial product or software as a
service offering without prior written permission from GETHSEMANE LLC. The
license and copyright notice must remain intact.

## Credits

- Wing icon by [prasong tadoungsorn](https://thenounproject.com/creator/layersky/) from
  [Noun Project](https://thenounproject.com/icon/wing-1382909/), licensed
  [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
- HTML5 icon by Stephen Hutchings from Typicons, licensed
  [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
