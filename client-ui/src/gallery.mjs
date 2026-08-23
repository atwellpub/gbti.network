// Pure gallery-row helpers (sow-268 Phase 1), shared by the content editor. No DOM: the component reads the
// rows out of the shadow DOM and passes them through these, so the parse + serialize contract is unit-tested
// in node without a browser.
//
// Why this exists: `gallery` is a `kind: 'json'` field, and the editor used to render it through the generic
// json control. An ARRAY value is comma-joined for display (gbti-content-editor.mjs, the `v` expression), so
// the textarea showed `./images/a.webp, ./images/b.webp`, and gather()'s coerceValue('json', ...) then
// JSON.parse'd that string and threw. Every product with screenshots was unsaveable, and Preview (whose
// gather() sits outside a try) was a dead button. The fix mirrors the links[] structured rows: a hidden json
// input holds JSON.stringify(the serialized value), and these helpers are the parse/serialize either side.
//
// The serialize side MUST round-trip the ten existing products byte-for-byte: they all use bare path strings,
// so an uncaptioned row serializes back to a bare string, NOT { src, caption: '' }, or opening and saving a
// product would churn its own frontmatter. This mirrors normalizeGallery (src/lib/product-page.mjs), which
// reads a bare string or a { src, caption } object in any mix.

/**
 * Read a stored gallery value into editable rows.
 * Accepts an array (of bare path strings and/or { src, caption } objects) or a JSON string of the same.
 * @returns {{ src: string, caption: string }[]}
 */
export function galleryRowsFromValue(value) {
  let arr = [];
  if (Array.isArray(value)) arr = value;
  else if (typeof value === 'string' && value.trim()) {
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) arr = parsed; } catch { arr = []; }
  }
  const rows = [];
  for (const entry of arr) {
    if (!entry) continue;
    if (typeof entry === 'string') { rows.push({ src: entry, caption: '' }); continue; }
    if (typeof entry === 'object' && entry.src) {
      rows.push({ src: String(entry.src), caption: typeof entry.caption === 'string' ? entry.caption : '' });
    }
  }
  return rows;
}

/**
 * Rebuild the stored gallery value from editable rows. A row with no `src` is dropped (an empty row is not a
 * screenshot, matching _serializeLinks). An uncaptioned row serializes to a bare string so it does not churn
 * existing frontmatter; a captioned row serializes to { src, caption }.
 * @param {{ src?: string, caption?: string }[]} rows
 * @returns {(string | { src: string, caption: string })[]}
 */
export function galleryValueFromRows(rows) {
  const out = [];
  for (const row of rows ?? []) {
    const src = String((row && row.src) || '').trim();
    if (!src) continue;
    const caption = String((row && row.caption) || '').trim();
    out.push(caption ? { src, caption } : src);
  }
  return out;
}
