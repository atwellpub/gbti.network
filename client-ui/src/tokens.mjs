// Brand design tokens for the shared web components (SOW-006 v2 / SOW-010 V3). Mirrors the V3 design system
// (src/styles/gbti-v3.css: green #1f9e5f, Hanken Grotesk body + Baloo Da 2 display, light + dark via a
// [data-theme] attribute on an ancestor). The values are baked LITERALLY here, not pulled from the host's
// :root, so the components look like GBTI whether or not the host page loaded gbti-v3.css (the npm CMS page,
// the extension onboarding tab, an inert hook on the public site). Shadow DOM isolates them so host styles cannot bleed.
//
// Theme: a component reads the ancestor's data-theme via :host-context([data-theme="dark"]) (the V3 header sets
// data-theme on <html>; the extension content script + new-tab set it on documentElement). On the V3 site this
// flips the palette with the page toggle; a host without data-theme stays light. The legacy token NAMES kept by
// the components (--bg/--panel/--brand/--brand-dark/--accent/--text/--fg/--muted/--line/--hover/--danger/--radius
// + the two fonts) are mapped onto V3 values so every component re-skins without per-component edits.

export const TOKENS = `
:host {
  --bg: #faf9f8; --panel: #ffffff;
  --brand: #1f9e5f; --brand-dark: #178a51; --accent: #0f6f40;
  --text: #24222a; --fg: #24222a; --muted: #57545e;
  --line: #e7e4e0; --hover: #f1f1f1; --danger: #c0392b;
  --radius: 12px;
  --glass-blur: none; /* SOW-070: flat (default) = no frost; the glass layout layer below sets a real backdrop blur */
  --font-body: "Hanken Grotesk", system-ui, -apple-system, sans-serif;
  --font-display: "Baloo Da 2", "Hanken Grotesk", system-ui, sans-serif;
  /* tooltips (mirrors src/styles/gbti-v3.css's own [data-tooltip] tokens) -- a dark bubble on the light surface */
  --tooltip-bg: #1c1a21; --tooltip-fg: #f5f4f2; --tooltip-border: rgba(255,255,255,.10);
}
:host-context([data-theme="dark"]) {
  --bg: #1c1a21; --panel: #2d2a34;
  --brand: #1f9e5f; --brand-dark: #46c089; --accent: #5fd49a;
  --text: #f3f2f0; --fg: #f3f2f0; --muted: rgba(243,242,240,.72);
  --line: rgba(255,255,255,.12); --hover: #34313c; --danger: #e06c6c;
  /* tooltip flips to a light bubble on dark surfaces, same inversion as the site's own CSS */
  --tooltip-bg: #f3f2f0; --tooltip-fg: #24222a; --tooltip-border: rgba(0,0,0,.12);
}
/* SOW-070: the GLASS layout skin (opt-in: data-layout="glass" on an ancestor). Re-points the surface tokens to
   translucent values + defines --glass-blur, so any surface class that reads backdrop-filter: var(--glass-blur)
   frosts; flat leaves --glass-blur: none (a no-op). Composes with data-theme (light + dark). Green + per-type accents
   are unchanged. Contrast: the panel alphas are kept >= .5 so --fg/--muted stay AA-legible over the ambient backdrop. */
:host-context([data-layout="glass"]) {
  --panel: rgba(255,255,255,calc(.55 * var(--glass-strength,1.7))); --line: rgba(255,255,255,calc(.66 * var(--glass-strength,1.7))); --hover: rgba(255,255,255,calc(.4 * var(--glass-strength,1.7)));
  --glass-blur: blur(20px) saturate(150%);
}
:host-context([data-layout="glass"][data-theme="dark"]) {
  --panel: rgba(18,26,21,calc(.55 * var(--glass-strength,1.7))); --line: rgba(255,255,255,calc(.1 * var(--glass-strength,1.7))); --hover: rgba(255,255,255,calc(.08 * var(--glass-strength,1.7)));
}
`;

// SOW-062 Phase 6: the content editor's own SOLID surface palette, ported verbatim from the hi-fi design
// (gbti-editor.css --s-* tokens). The editor is a solid document surface, DECOUPLED from glass mode -- it never
// reads --panel/--glass-blur, so the shell's ambient gradient can never bleed through it. Scoped to :host (not
// :root) so these tokens stay inside the editor components' shadow trees and do NOT leak to sibling components.
export const EDITOR_SURFACE = `
:host {
  --s-app:#f4f2ef; --s-surface:#ffffff; --s-surface-2:#f7f6f4; --s-surface-3:#efedea;
  --s-line:#e7e4e0; --s-line-2:#ddd9d4; --s-fg:#24222a; --s-fg-soft:#57545e; --s-fg-mute:#8a8792;
  --s-green:#1f9e5f; --s-green-fg:#0f6f40; --s-tint:#e9f6ef; --s-tint-2:#dcefe3; --s-canvas:#ffffff;
  --s-amber-fg:#8a5500; /* sow-184: a readable amber for TEXT (the Staged pill) -- the golden #d9a13c fails AA on a light tint */
  --s-shadow:0 1px 2px rgba(37,35,43,.06),0 1px 1px rgba(37,35,43,.04);
  --s-shadow-md:0 12px 30px rgba(37,35,43,.10),0 3px 8px rgba(37,35,43,.06);
  --s-pop:0 14px 40px rgba(37,35,43,.18),0 4px 10px rgba(37,35,43,.10);
  --s-sel:rgba(31,158,95,.16); --ink:#201d27;
}
:host-context([data-theme="dark"]) {
  --s-app:#18161d; --s-surface:#232029; --s-surface-2:#2a2731; --s-surface-3:#322f3a;
  --s-line:rgba(255,255,255,.085); --s-line-2:rgba(255,255,255,.16); --s-fg:#f3f2f0; --s-fg-soft:#bdbac4; --s-fg-mute:#847f8d;
  --s-green:#28b06d; --s-green-fg:#5fd49a; --s-tint:rgba(95,212,154,.13); --s-tint-2:rgba(95,212,154,.22); --s-canvas:#201d27;
  --s-amber-fg:#e6b45c; /* sow-184: light amber text for the Staged pill on the dark card tint */
  --s-shadow:none; --s-shadow-md:0 18px 40px rgba(0,0,0,.4); --s-pop:0 18px 50px rgba(0,0,0,.55),0 4px 12px rgba(0,0,0,.4);
  --s-sel:rgba(95,212,154,.22); --ink:#17151c;
}
`;

export const BASE_CSS = `
:host { display: block; color: var(--text); font: 15px/1.5 var(--font-body); box-sizing: border-box; }
*, *::before, *::after { box-sizing: border-box; }
h1, h2, h3 { font-family: var(--font-display); margin: 0 0 .5em; }
h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
a { color: var(--accent); }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px 20px; -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); }
label { display: block; font-size: 13px; color: var(--muted); margin: 10px 0 4px; }
input, select, textarea {
  width: 100%; padding: 9px 11px; background: var(--bg); border: 1px solid var(--line);
  border-radius: 8px; color: var(--text); font: inherit;
}
input:focus, select:focus, textarea:focus { outline: none; border-color: var(--brand); }
textarea { min-height: 120px; resize: vertical; font-family: ui-monospace, monospace; }
button {
  background: var(--brand); color: #08231a; border: 0; border-radius: 8px;
  padding: 9px 16px; font: inherit; font-weight: 600; cursor: pointer;
}
button:hover { background: var(--brand-dark); }
button.ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); }
button[disabled] { opacity: .5; cursor: default; }
.muted { color: var(--muted); }
.danger { color: var(--danger); }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.tag { display: inline-block; padding: 2px 8px; border-radius: 999px; background: var(--hover); font-size: 12px; color: var(--muted); }
.tag.ok { background: rgba(31,158,95,.14); color: var(--accent); }
.tag.bad { background: rgba(224,108,108,.16); color: var(--danger); }
ul.list { list-style: none; margin: 0; padding: 0; }
ul.list li { padding: 8px 0; border-bottom: 1px solid var(--line); }

/* Tooltips (mirrors src/styles/gbti-v3.css's [data-tooltip] block verbatim) -- a shadow root cannot see the
   page's global CSS, so any component wanting the site's hover-label treatment needs this rule INSIDE its own
   tree; defined once here (BASE_CSS is included via this.css() in every component) rather than per-component.
   Usage: add data-tooltip="..." to a focusable control AND keep an aria-label (data-tooltip is presentational,
   not announced to assistive tech). */
[data-tooltip] { position: relative; }
[data-tooltip]::after, [data-tooltip]::before {
  position: absolute; left: 50%; opacity: 0; pointer-events: none;
  transition: opacity .14s ease, transform .14s ease; z-index: 60;
}
[data-tooltip]::after {
  content: attr(data-tooltip); bottom: calc(100% + 8px); transform: translateX(-50%) translateY(4px);
  background: var(--tooltip-bg); color: var(--tooltip-fg); border: 1px solid var(--tooltip-border);
  font-family: var(--font-body); font-size: 12.5px; font-weight: 500; line-height: 1.3; letter-spacing: .1px;
  text-align: center; white-space: normal; width: max-content; max-width: 220px; padding: 5px 9px;
  border-radius: 6px; box-shadow: 0 12px 30px rgba(37,35,43,.10), 0 3px 8px rgba(37,35,43,.06);
}
[data-tooltip]::before {
  content: ""; bottom: calc(100% + 3px); transform: translateX(-50%) translateY(4px);
  border: 5px solid transparent; border-top-color: var(--tooltip-bg);
}
[data-tooltip]:hover::after, [data-tooltip]:focus-visible::after,
[data-tooltip]:hover::before, [data-tooltip]:focus-visible::before { opacity: 1; transform: translateX(-50%) translateY(0); }
[data-tooltip-pos="below"]::after { bottom: auto; top: calc(100% + 8px); }
[data-tooltip-pos="below"]::before { bottom: auto; top: calc(100% + 3px); border-top-color: transparent; border-bottom-color: var(--tooltip-bg); }
@media (hover: none) { [data-tooltip]::after, [data-tooltip]::before { display: none; } }
`;
