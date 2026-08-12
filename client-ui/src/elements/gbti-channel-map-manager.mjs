// <gbti-channel-map-manager> (SOW-087 + SOW-088): the superadmin Channels workspace, rebuilt onto the
// owner's "GBTI Admin Channels" mockup (.data/sow/1_progressing/cf-server/sow-088-assets/). Four anchored
// section cards behind a sticky subnav with scrollspy: the syndication PIPELINE (master switch, ready
// behavior, hold window, destination chips), per-CHANNEL syndication templates (branded destination tiles;
// the Reddit body only on the Reddit tile), NEWS auto-share, and the moderation WORD LISTS. Every write
// still lands as an audited house PR via the admin ops (CODEOWNERS + the SOW-005 gate are the real
// boundary) and goes live at the next reconcile KV-mirror sync. Inert in public (no injected client);
// host-agnostic; V3 tokens only, both themes (the mockup is dark-only). Lazy load on first render with a
// client (the SOW-070 upgrade race).
import { GbtiElement, define, esc } from '../base.mjs';
import { submitAck } from '../workspace-core.mjs';
import { DEFAULT_STUB_TEMPLATES, DEFAULT_CHANNEL_STUB_TEMPLATES, CHANNEL_CAPABILITY, channelCapability, AUTO_TYPES, AUTO_CHANNELS, MATRIX_CHANNELS, AUTO_MODES } from '../../../membership/syndication-config-core.mjs'; // SOW-088 stub defaults + SOW-125 capability/matrix
import './gbti-syndication-tracker.mjs'; // SOW-088: the Publishing Activity datatable nests inside this workspace

const AMBER = '#d8901a';

const CSS = `
  :host { display:block; }
  .busy { opacity:.55; pointer-events:none; }
  .muted { color:var(--muted); }
  .msg { font-size:13px; color:var(--accent); margin:0 0 12px; }

  /* sticky subnav + scrollspy */
  .subnav { position:sticky; top:0; z-index:5; display:flex; gap:4px; overflow-x:auto; margin:0 0 16px;
    background:var(--panel); border:1.5px solid var(--line); border-radius:7px; padding:2px 6px; }
  .subnav a { padding:11px 13px; font-size:13px; font-weight:600; color:var(--muted); border-bottom:2px solid transparent;
    white-space:nowrap; text-decoration:none; display:inline-flex; align-items:center; gap:7px; cursor:pointer; }
  .subnav a:hover { color:var(--fg); }
  .subnav a.on { color:var(--accent); border-bottom-color:var(--accent); }
  .subnav a svg { width:15px; height:15px; opacity:.85; }

  .intro { color:var(--muted); font-size:13.5px; margin:0 0 18px; max-width:660px; line-height:1.55; }
  .intro b { color:var(--fg); }

  /* section cards */
  section.card { background:var(--panel); border:1.5px solid var(--line); border-radius:7px; overflow:hidden;
    margin:0 0 20px; scroll-margin-top:64px; }
  .card-h { display:flex; align-items:center; gap:14px; padding:18px 22px; border-bottom:1.5px solid var(--line); }
  .card-h .hi { width:38px; height:38px; border-radius:7px; background:rgba(31,158,95,.12); border:1px solid rgba(31,158,95,.3);
    display:flex; align-items:center; justify-content:center; color:var(--accent); flex:none; }
  .card-h .hi svg { width:19px; height:19px; }
  .card-h h2 { font-family:var(--font-display, inherit); font-weight:700; font-size:17px; margin:0; }
  .card-h p { font-size:12.5px; color:var(--muted); margin:2px 0 0; }
  .card-h .sp { flex:1; }
  .card-b { padding:20px 22px; }
  .cardfoot { display:flex; align-items:center; justify-content:flex-end; gap:12px; padding:14px 22px;
    border-top:1.5px solid var(--line); background:var(--hover); }
  .cardfoot .fmsg { margin-right:auto; font-size:12.5px; color:var(--muted); }

  /* save pill */
  .pill { display:inline-flex; align-items:center; gap:7px; font-family:var(--font-mono, monospace); font-size:11px;
    padding:5px 11px; border-radius:999px; border:1.5px solid var(--line); color:var(--muted); white-space:nowrap; }
  .pill .dot { width:7px; height:7px; border-radius:50%; background:var(--muted); }
  .pill.dirty { color:${AMBER}; border-color:rgba(216,144,26,.5); background:rgba(216,144,26,.08); }
  .pill.dirty .dot { background:${AMBER}; }

  /* form primitives */
  .fgrid { display:grid; gap:16px 18px; grid-template-columns:repeat(3, 1fr); }
  .fgrid.c2 { grid-template-columns:repeat(2, 1fr); }
  .field { display:flex; flex-direction:column; gap:6px; min-width:0; }
  .field > label { font-family:var(--font-mono, monospace); font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:var(--muted); }
  .field .hint { font-size:12px; color:var(--muted); line-height:1.4; }
  .ctrl { width:100%; box-sizing:border-box; background:var(--bg); border:1.5px solid var(--line); border-radius:7px; color:var(--fg);
    font:inherit; font-size:13.5px; padding:10px 12px; outline:none; }
  .ctrl:focus { border-color:var(--brand); box-shadow:0 0 0 3px rgba(31,158,95,.18); }
  textarea.ctrl { resize:vertical; min-height:46px; font-family:var(--font-mono, monospace); font-size:12.5px; line-height:1.5; }
  .sfxwrap { position:relative; }
  .sfxwrap .sfx { position:absolute; right:12px; top:50%; transform:translateY(-50%); font-family:var(--font-mono, monospace); font-size:11.5px; color:var(--muted); pointer-events:none; }
  .sfxwrap input.ctrl { padding-right:74px; }

  .btn { display:inline-flex; align-items:center; justify-content:center; gap:7px; font:inherit; font-weight:600; font-size:13px;
    padding:8px 14px; border-radius:7px; border:1.5px solid transparent; cursor:pointer; white-space:nowrap; }
  .btn svg { width:14px; height:14px; }
  .btn-primary { background:var(--brand); color:#fff; }
  .btn-primary[disabled] { background:var(--hover); color:var(--muted); cursor:default; }
  .btn-ghost { background:transparent; color:var(--muted); border-color:var(--line); }
  .btn-ghost:hover { color:var(--fg); }

  /* destination chips */
  .chgroup { display:flex; flex-wrap:wrap; gap:10px; }
  .chan { display:inline-flex; align-items:center; gap:9px; padding:8px 13px; border-radius:7px; border:1.5px solid var(--line);
    background:var(--bg); cursor:pointer; user-select:none; font-size:13px; font-weight:600; color:var(--muted); }
  .chan .cbx { width:15px; height:15px; border-radius:4px; border:1.5px solid var(--muted); display:flex; align-items:center; justify-content:center; flex:none; }
  .chan .cbx svg { width:10px; height:10px; color:#fff; opacity:0; }
  .chan.on { border-color:var(--brand); background:rgba(31,158,95,.1); color:var(--fg); }
  .chan.on .cbx { background:var(--brand); border-color:var(--brand); }
  .chan.on .cbx svg { opacity:1; }
  .chan.soon { opacity:.5; cursor:default; }
  .chan .tag { font-family:var(--font-mono, monospace); font-size:10px; color:var(--muted); font-weight:500; }

  /* branded channel tiles */
  .chtiles { display:grid; grid-template-columns:repeat(auto-fill, minmax(106px, 1fr)); gap:10px; }
  .chtile { position:relative; display:flex; flex-direction:column; align-items:center; gap:5px; padding:15px 8px 12px;
    border-radius:7px; border:1.5px solid var(--line); background:var(--bg); cursor:pointer; text-align:center; font:inherit; }
  .chtile:hover:not(.soon) { border-color:var(--muted); }
  .chtile .ct-i { width:42px; height:42px; border-radius:7px; display:flex; align-items:center; justify-content:center; color:#fff; }
  .chtile .ct-i svg { width:24px; height:24px; }
  .chtile .ct-n { font-weight:700; font-size:13px; color:var(--fg); }
  .chtile .ct-s { font-family:var(--font-mono, monospace); font-size:9.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); }
  .chtile.on { border-color:var(--brand); background:rgba(31,158,95,.08); box-shadow:0 0 0 1px var(--brand) inset; }
  .chtile.on::after { content:''; position:absolute; top:7px; right:7px; width:15px; height:15px; border-radius:50%; background:var(--brand); }
  .chtile.on::before { content:''; position:absolute; top:11px; right:10.5px; width:7px; height:4px; border-left:2px solid #fff; border-bottom:2px solid #fff; transform:rotate(-45deg); z-index:1; }
  .chtile.soon { opacity:.55; cursor:default; }
  .br-discord { background:#5865F2; } .br-reddit { background:#FF4500; } .br-x { background:#000; } .br-devto { background:#0a0a0a; }
  .br-li { background:#0A66C2; } .br-bsky { background:#1185FE; }
  /* .br-hashnode is DORMANT (sow-217): the tile is gone, the brand colour is kept so a revival is a one-liner. */
  .br-substack { background:#FF6719; } .br-hashnode { background:#2962FF; } .br-dailydev { background:#CE3DF3; }

  /* template rows + variable chips */
  .varnote { font-size:12px; color:var(--muted); margin:14px 0 6px; }
  .varbar { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:6px; }
  .varchip { font-family:var(--font-mono, monospace); font-size:11px; color:var(--accent); background:rgba(31,158,95,.08);
    border:1px solid rgba(31,158,95,.3); border-radius:5px; padding:3px 8px; cursor:pointer; }
  .varchip:hover { background:rgba(31,158,95,.18); }
  .tmpl { display:grid; grid-template-columns:118px 1fr; gap:14px; align-items:start; padding:13px 0; border-top:1.5px solid var(--line); }
  .tmpl .tl { padding-top:10px; }
  .tmpl .tl .nm { font-weight:700; font-size:13px; color:var(--fg); }
  .tmpl .tl .df { font-family:var(--font-mono, monospace); font-size:10px; color:var(--muted); margin-top:3px; }

  /* toggle switch */
  .switch { position:relative; width:42px; height:24px; flex:none; }
  .switch input { position:absolute; opacity:0; width:100%; height:100%; margin:0; cursor:pointer; z-index:2; }
  .switch .track { position:absolute; inset:0; background:var(--hover); border:1.5px solid var(--line); border-radius:999px; transition:background .18s; }
  .switch input:checked ~ .track { background:var(--brand); border-color:var(--brand); }
  .switch .knob { position:absolute; top:4px; left:4px; width:16px; height:16px; border-radius:50%; background:#fff; transition:transform .18s; box-shadow:0 1px 3px rgba(0,0,0,.3); }
  .switch input:checked ~ .knob { transform:translateX(18px); }
  .togline { display:flex; align-items:center; gap:12px; margin-bottom:16px; }
  .togline .tl-t { font-weight:600; font-size:13.5px; color:var(--fg); }
  .togline .tl-s { font-size:12px; color:var(--muted); }

  /* word lists */
  .termtabs { display:flex; gap:8px; margin-bottom:14px; }
  .termtab { padding:7px 13px; border-radius:7px; border:1.5px solid var(--line); background:var(--bg); color:var(--muted);
    font:inherit; font-size:12.5px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:8px; }
  .termtab .ct { font-family:var(--font-mono, monospace); font-size:11px; background:var(--hover); padding:1px 7px; border-radius:999px; }
  .termtab.on { border-color:var(--brand); color:var(--fg); background:rgba(31,158,95,.08); }
  .termtab.on .ct { background:var(--brand); color:#fff; }
  .searchwrap { position:relative; margin-bottom:12px; }
  .searchwrap svg { position:absolute; left:11px; top:50%; transform:translateY(-50%); width:14px; height:14px; color:var(--muted); }
  .searchwrap input { padding-left:32px; }
  .chips { display:flex; flex-wrap:wrap; gap:8px; min-height:20px; }
  .term { display:inline-flex; align-items:center; gap:7px; padding:5px 7px 5px 11px; border-radius:7px; background:var(--bg);
    border:1.5px solid var(--line); font-size:12.5px; color:var(--fg); }
  .term.hidden { display:none; }
  .term .x { width:18px; height:18px; border-radius:4px; display:flex; align-items:center; justify-content:center; cursor:pointer;
    color:var(--muted); border:0; background:transparent; padding:0; }
  .term .x:hover { color:var(--danger, #e06c6c); }
  .term .x svg { width:10px; height:10px; }
  .addrow { display:flex; gap:10px; margin-top:14px; }
  .addrow input { flex:1; }
  .note-inline { font-size:12.5px; color:var(--muted); line-height:1.5; margin-top:14px; padding-top:14px; border-top:1.5px solid var(--line); }
  .note-inline b { color:var(--fg); }

  /* SOW-125: auto-share matrix + per-channel delays */
  .mtx-scroll { overflow-x:auto; border:1.5px solid var(--line); border-radius:7px; }
  table.matrix { border-collapse:collapse; width:100%; font-size:12px; }
  table.matrix th, table.matrix td { border-bottom:1px solid var(--line); border-right:1px solid var(--line); padding:7px 9px; text-align:center; white-space:nowrap; }
  table.matrix tr:last-child td { border-bottom:0; }
  table.matrix th:last-child, table.matrix td:last-child { border-right:0; }
  table.matrix thead th { font-family:var(--font-mono, monospace); font-size:10px; letter-spacing:.04em; text-transform:uppercase; color:var(--muted); font-weight:600; background:var(--hover); }
  table.matrix th.rowh, table.matrix td.rowh { text-align:left; }
  table.matrix td.rowh { font-weight:600; color:var(--fg); background:var(--hover); }
  table.matrix select { width:100%; min-width:76px; box-sizing:border-box; background:var(--bg); border:1.5px solid var(--line); border-radius:6px; color:var(--fg); font:inherit; font-size:12px; padding:5px 6px; outline:none; }
  table.matrix select:focus { border-color:var(--brand); box-shadow:0 0 0 3px rgba(31,158,95,.18); }
  table.matrix select:disabled { opacity:.5; cursor:default; }
  .chandelays { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:12px 14px; }

  @media (max-width:760px){ .fgrid, .fgrid.c2 { grid-template-columns:1fr; } .tmpl { grid-template-columns:1fr; } }
`;

const ICONS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <g id="c-kanban"><rect x="4" y="4" width="4.6" height="16" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="9.7" y="4" width="4.6" height="11" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="15.4" y="4" width="4.6" height="7.5" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.6"/></g>
  <g id="c-pipe"><path d="M4 7h16M4 12h10M4 17h13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></g>
  <g id="c-tmpl"><rect x="4" y="4" width="16" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 9h8M8 13h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></g>
  <g id="c-share"><circle cx="6" cy="12" r="2.4" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="18" cy="6" r="2.4" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="18" cy="18" r="2.4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 11l8-4M8 13l8 4" stroke="currentColor" stroke-width="1.7"/></g>
  <g id="c-shield"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></g>
  <g id="c-check"><path d="M4 12l5 5L20 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></g>
  <g id="c-search"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20.5 20.5l-4.2-4.2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></g>
  <g id="c-x"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></g>
  <g id="c-plus"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></g>
  <g id="cb-discord"><path fill="currentColor" d="M19.6 5.6A16 16 0 0 0 15.6 4.4l-.2.4a12 12 0 0 1 3.5 1.8 13.4 13.4 0 0 0-11.8 0A12 12 0 0 1 10.6 4.8l-.3-.4A16 16 0 0 0 6.4 5.6C3.9 9.3 3.2 12.9 3.5 16.4a16.1 16.1 0 0 0 4.9 2.5l.4-.6c-.6-.2-1.2-.5-1.8-.9l.4-.3a11.5 11.5 0 0 0 9.8 0l.4.3c-.6.4-1.2.7-1.8.9l.4.6a16 16 0 0 0 4.9-2.5c.4-4-.7-7.6-3.4-10.8zM9.4 14.3c-1 0-1.7-.9-1.7-1.9s.8-1.9 1.7-1.9 1.8.9 1.7 1.9-.8 1.9-1.7 1.9zm5.2 0c-1 0-1.7-.9-1.7-1.9s.8-1.9 1.7-1.9 1.8.9 1.7 1.9-.7 1.9-1.7 1.9z"/></g>
  <g id="cb-reddit"><path fill="currentColor" d="M22 12.3c0-1.2-1-2.2-2.2-2.2-.6 0-1.1.2-1.5.6a10.6 10.6 0 0 0-5.4-1.7l.9-4.1 2.9.6a1.6 1.6 0 1 0 .2-1l-3.3-.7c-.2 0-.4.1-.4.3l-1 4.6a10.7 10.7 0 0 0-5.5 1.7 2.2 2.2 0 1 0-2.4 3.6 4 4 0 0 0 0 .6c0 3.1 3.6 5.6 8 5.6s8-2.5 8-5.6a4 4 0 0 0 0-.6c.7-.4 1.2-1.1 1.2-2zM7 13.9a1.6 1.6 0 1 1 3.2 0 1.6 1.6 0 0 1-3.2 0zm8.9 4.2c-1.1 1.1-3.3 1.2-3.9 1.2-.6 0-2.8-.1-3.9-1.2a.4.4 0 0 1 .6-.6c.7.7 2.2.9 3.3.9s2.6-.2 3.3-.9a.4.4 0 1 1 .6.6zm-.3-2.5a1.6 1.6 0 1 1 0-3.2 1.6 1.6 0 0 1 0 3.2z"/></g>
  <g id="cb-devto"><path fill="currentColor" d="M7.2 9.2c-.3-.2-.6-.3-.9-.3H5v6.3h1.3c.3 0 .6-.1.9-.3.3-.2.4-.5.4-.9v-3.9c0-.4-.1-.7-.4-.9zM3.5 7.4h2.9c.8 0 1.5.3 2 .8s.8 1.2.8 2v3.7c0 .8-.3 1.5-.8 2s-1.2.8-2 .8H3.5V7.4zm8.4 1.5v2.1h2.5v1.5h-2.5v2.1h2.9v1.5h-3.4c-.3 0-.6-.1-.8-.3-.2-.2-.3-.5-.3-.8V9c0-.3.1-.6.3-.8.2-.2.5-.3.8-.3h3.4v1.5h-2.9zm6.9 7.7c-.4 0-.8-.1-1.1-.4-.3-.3-.5-.6-.6-1L15.6 8h1.9l1.2 5.3L19.9 8h1.9l-1.6 7.2c-.1.4-.3.7-.6 1-.3.3-.7.4-1.1.4z"/></g>
  <g id="cb-x"><path fill="currentColor" d="M17.5 4h2.9l-6.3 7.2L21.5 20h-5.8l-4.5-5.9L5.9 20H3l6.7-7.7L2.8 4h5.9l4.1 5.4L17.5 4zm-1 14.3h1.6L8.1 5.6H6.3l10.2 12.7z"/></g>
  <g id="cb-linkedin"><path fill="currentColor" d="M6.1 8.6H2.9V20h3.2V8.6zM4.5 3.5a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8zM20.9 20h-3.2v-5.6c0-1.3 0-3-1.9-3s-2.1 1.4-2.1 2.9V20H10.5V8.6h3v1.6h.1c.4-.8 1.5-1.6 3-1.6 3.2 0 3.8 2.1 3.8 4.9V20z"/></g>
  <g id="cb-bsky"><path fill="currentColor" d="M12 10.8C10.9 8.6 8 5.2 5.3 4 3.4 3.1 2 3.6 2 5.8c0 2.2 1.2 7.2 1.9 8.2.7 1 2 .9 3.3.7-2.2.4-2.6 1.9-1.5 3.4C7.8 21 9.7 17.9 10.2 16.7c.3-.8.5-1.4.6-1.6.1.2.3.8.6 1.6.5 1.2 2.4 4.3 4.5 1.4 1.1-1.5.7-3-1.5-3.4 1.3.2 2.6.3 3.3-.7.7-1 1.9-6 1.9-8.2 0-2.2-1.4-2.7-3.3-1.8-2.7 1.2-5.6 4.6-6.7 6.8z"/></g>
  <g id="cb-substack"><path fill="currentColor" d="M22.539 8.242H1.46V5.406h21.08v2.836zM1.46 10.812V24L12 18.11 22.539 24V10.812H1.46zM22.539 0H1.46v2.836h21.08V0z"/></g>
  <!-- cb-hashnode: DORMANT (sow-217), kept inert for a revival; no tile references it today. -->
  <g id="cb-hashnode"><path fill="currentColor" d="M22.351 8.019l-6.37-6.37a5.63 5.63 0 0 0-7.962 0l-6.37 6.37a5.63 5.63 0 0 0 0 7.962l6.37 6.37a5.63 5.63 0 0 0 7.962 0l6.37-6.37a5.63 5.63 0 0 0 0-7.962zM12 15.953a3.953 3.953 0 1 1 0-7.906 3.953 3.953 0 0 1 0 7.906z"/></g>
  <g id="cb-dailydev"><path fill="currentColor" d="M18.29 5.706a1.405 1.405 0 0 0-1.987 0L4.716 17.296l1.324-2.65-2.65-2.649 3.312-3.311 2.65 2.65 1.986-1.988-3.642-3.642a1.405 1.405 0 0 0-1.987 0L.411 11.004a1.404 1.404 0 0 0 0 1.987l4.305 4.304.993.993a1.405 1.405 0 0 0 1.987 0L19.285 6.7l-.993-.994Zm-.332 3.647 2.65 2.65-4.306 4.305a1.404 1.404 0 1 0 1.986 1.986l5.299-5.298a1.404 1.404 0 0 0 0-1.987l-4.305-4.304-1.324 2.648Z"/></g>
</defs></svg>`;

// The template-editing destinations (SOW-088). SOW-125: `active` (editable) + the sub-label are DERIVED from
// the single capability source, not hardcoded flags, so an `auto` channel (Mastodon, Bluesky) is editable
// without a stale "building" tag. Substack is MANUAL, not "building" (no public write API and no prefill
// intent, so no adapter is buildable and none is planned); LinkedIn is still `building`. Honest limits + the
// manual SOP: .data/ops/channel-ops/substack.md.
// capOf: Substack has no config flag, so it is a static `manual` tile; every other tile reads the shared map.
const capOf = (id) => (id === 'substack' ? 'manual' : channelCapability(id));
// A tile is editable when its adapter posts automatically (`auto`) OR it is X (manual-assist, but its template
// still renders the Social Queue text). Substack (manual, no adapter/prefill) and LinkedIn (building) stay off.
// A channel's templates are editable when it actually delivers: any AUTO channel, and any MANUAL-assist channel
// (x, linkedin, dailydev) whose per-type text drives the Social Queue task. Only 'building' tiles
// (an unknown/placeholder channel like Substack) stay disabled.
const isTileActive = (id) => capOf(id) === 'auto' || capOf(id) === 'manual';
const TILE_CHANNELS = [
  { id: 'discord', name: 'Discord', sub: 'Featured', icon: 'cb-discord', cls: 'br-discord' },
  { id: 'discord-category', name: 'Discord', sub: 'Category', icon: 'cb-discord', cls: 'br-discord' },
  { id: 'reddit', name: 'Reddit', sub: 'Subreddit', icon: 'cb-reddit', cls: 'br-reddit' },
  { id: 'devto', name: 'dev.to', sub: 'Org blog', icon: 'cb-devto', cls: 'br-devto' },
  { id: 'dailydev', name: 'daily.dev', sub: 'Manual', icon: 'cb-dailydev', cls: 'br-dailydev' }, // SOW-135
  { id: 'x', name: 'X', sub: 'Manual', icon: 'cb-x', cls: 'br-x' },
  { id: 'linkedin', name: 'LinkedIn', sub: 'Manual', icon: 'cb-linkedin', cls: 'br-li' },
  { id: 'bluesky', name: 'Bluesky', sub: '', icon: 'cb-bsky', cls: 'br-bsky' },
  { id: 'substack', name: 'Substack', sub: 'Manual only', icon: 'cb-substack', cls: 'br-substack',
    note: 'Substack has no public write API, so posts are cross-posted by hand. This card will never toggle on as built.' },
].map((c) => ({ ...c, active: isTileActive(c.id) }));

// SOW-125: labels for the auto-share matrix (content types down the rows, deliverable channels across the top)
// and the per-channel delay inputs.
const MATRIX_TYPE_LABEL = { share: 'Share', post: 'Article', product: 'Product', prompt: 'Prompt' };
const MATRIX_CHAN_LABEL = { discord: 'Discord', 'discord-category': 'Discord cat', reddit: 'Reddit', devto: 'dev.to', dailydev: 'daily.dev', bluesky: 'Bluesky', x: 'X', linkedin: 'LinkedIn' };
const AUTO_MODE_LABEL = { off: 'Off', on: 'On-Automatic', 'on-manual': 'On-Manual', popular: 'Popular' };
const TMPL_TYPES = [
  { key: 'share', nm: 'Share', df: 'reshare line' },
  { key: 'post', nm: 'Post', df: 'article' },
  { key: 'product', nm: 'Product', df: 'product' },
  { key: 'prompt', nm: 'Prompt', df: 'prompt' },
];
const VARS = ['{memberdiscord}', '{member-discord-username}', '{fullName}', '{author}', '{title}', '{url}', '{category}', '{content-type}', '{author-note}', '{author-note-italic}', '{member-url}', '{short-description}',
  // Hashtag tokens (category + free-form tags as #Hashtags) and the per-channel member handle tokens (each
  // resolves the member's own handle for that channel, falling back to their name): documented + insertable.
  '{category-hashtag}', '{tags-hashtags}', '{hashtags}', '{member-x-handle}', '{member-bluesky-handle}', '{member-reddit-handle}'];
// SOW-131: the DESTINATIONS checkbox chips (PIPE_CHIPS) were removed. Channel enablement is matrix-derived, so
// the auto-share matrix is the single control; the channel's readiness (secrets) is still checked at drain time.

// SOW-132: the sub-sections are TABS (only the active one renders). Each maps to one card builder. The active tab
// is deep-linked in the URL hash as `sub=<id>` (coexisting with the admin page's `tab=syndication`) + mirrored to
// localStorage, so a reload, a shared link, or a post-save reload lands on the same section.
const SYND_TABS = [
  { id: 'activity', nm: 'Publishing Activity', ic: 'c-kanban', build: 'activity' },
  { id: 'pipeline', nm: 'Pipeline', ic: 'c-pipe', build: 'pipeline' },
  { id: 'templates', nm: 'Templates', ic: 'c-tmpl', build: 'templates' },
  { id: 'news', nm: 'News auto-share', ic: 'c-share', build: 'news' },
  { id: 'content', nm: 'Content auto-share', ic: 'c-share', build: 'content' },
  { id: 'words', nm: 'Word lists', ic: 'c-shield', build: 'words' },
];
const SYND_TAB_IDS = SYND_TABS.map((t) => t.id);
const SYND_SUB_KEY = 'gbti-synd-sub';
// The template keys a channel's working copy tracks (the four content types + the Reddit/dev.to sub-templates).
const TMPL_KEYS = ['share', 'post', 'product', 'prompt', 'reddit-body', 'reddit-comment', 'devto-intro', 'devto-body', 'devto-footer', 'devto-stub']; // SOW-138: *-body = the public crosspost body

class GbtiChannelMapManager extends GbtiElement {
  connectedCallback() { super.connectedCallback?.(); }

  // SOW-132: the EFFECTIVE template value for a (channel, key): a channel override, else the shared map, else the
  // built-in default. Extracted from load() so _saveTemplates can recompute a field after an optimistic write.
  _effPub(ch, k) { return this._channelTemplates?.[ch]?.[k] ?? this._templates?.[k] ?? ''; }
  _effStub(ch, k) {
    return this._channelTemplatesStub?.[ch]?.[k]
      ?? this._stubTemplates?.[k]
      ?? DEFAULT_CHANNEL_STUB_TEMPLATES[ch]?.[k]
      ?? DEFAULT_STUB_TEMPLATES[k]
      ?? this._effPub(ch, k);
  }

  // SOW-132: read the deep-linked sub-tab from the URL hash (`sub=<id>`, alongside the admin `tab=syndication`),
  // else localStorage, else the first tab. Write it back with history.replaceState so it does NOT fire hashchange
  // (which would make admin.mjs re-mount the syndication group).
  _readSubTab() {
    try {
      const m = /(?:^|[#&])sub=([a-z-]+)/.exec(typeof location !== 'undefined' ? location.hash || '' : '');
      if (m && SYND_TAB_IDS.includes(m[1])) return m[1];
      const stored = localStorage.getItem(SYND_SUB_KEY);
      if (stored && SYND_TAB_IDS.includes(stored)) return stored;
    } catch { /* storage/URL blocked */ }
    return 'activity';
  }
  _writeSubTab(id) {
    try { localStorage.setItem(SYND_SUB_KEY, id); } catch { /* ignore */ }
    try {
      const parts = (location.hash || '').replace(/^#/, '').split('&').filter((p) => p && !/^sub=/.test(p));
      parts.push(`sub=${id}`);
      history.replaceState(null, '', `${location.pathname}${location.search}#${parts.join('&')}`);
    } catch { /* ignore */ }
  }

  async load() {
    if (!this.client) { this.render(); return; }
    try {
      const [channels, flags, templates, engagement, pipeline, contentEng] = await Promise.all([
        this.client.contentChannelPool(),
        this.client.moderationFlagPool(),
        this.client.syndicationTemplatePool(),
        this.client.newsEngagementSettings ? this.client.newsEngagementSettings() : null,
        this.client.syndicationSettings ? this.client.syndicationSettings().catch(() => null) : null,
        this.client.contentEngagementSettings ? this.client.contentEngagementSettings().catch(() => null) : null,
      ]);
      this._mapCount = (channels?.channels || []).length;
      this._lists = flags?.lists || {};
      this._templates = templates?.templates || {};
      this._channelTemplates = templates?.channelTemplates || {};
      this._stubTemplates = templates?.stubTemplates || {};
      this._channelTemplatesStub = templates?.channelTemplatesStub || {};
      this._engagement = engagement?.settings || null;
      this._tiers = engagement?.tiers || ['paid', 'paid-trial', 'signed-in'];
      this._contentEng = contentEng?.settings || null; // SOW-126: the `popular`-engine tunables
      this._contentTiers = contentEng?.tiers || ['paid', 'paid-trial', 'signed-in'];
      this._contentSignals = contentEng?.signals || ['opens', 'favorites', 'upvotes', 'comments'];
      this._pipeline = pipeline?.settings || null;
      // Working copies (dirty state survives re-renders; a save/reload resets them).
      // Fields show the EFFECTIVE template (channel override -> shared map, which already folds in the
      // built-in defaults) as their VALUE (owner-directed: real values, not placeholders). The baseline
      // map makes dirty = differs-from-loaded, so an untouched inherited value is never saved as an
      // override; clearing a field saves '' (deletes the override, falls back).
      // SOW-088 Proposal A: TWO working sets per channel, keyed `pub:` / `stub:`. Fields show the
      // EFFECTIVE value for that visibility (the stub chain mirrors templateFor: channel stub -> shared
      // stub -> the built-in stub defaults -> the public effective value).
      this._work = {};
      this._base = {};
      for (const ch of TILE_CHANNELS.filter((c) => c.active).map((c) => c.id)) {
        for (const vis of ['pub', 'stub']) {
          const key = `${vis}:${ch}`;
          this._work[key] = {}; this._base[key] = {};
          for (const k of TMPL_KEYS) {
            const eff = vis === 'stub' ? this._effStub(ch, k) : this._effPub(ch, k);
            this._work[key][k] = eff; this._base[key][k] = eff;
          }
        }
      }
      this._tmplVis = this._tmplVis || 'pub';
      this._tmplDirty = new Set();
      this._pipeDirty = false;
      this._engDirty = false;
      this._contentEngDirty = false;
      // SOW-132: preserve the editing state across a (re)load. NOTE: _work is keyed `pub:<ch>` so the validity
      // check must use that key (the old `this._work[this._curCh]` was always undefined -> reset to discord).
      this._curCh = this._curCh && this._work[`pub:${this._curCh}`] ? this._curCh : 'discord';
      this._termTab = this._termTab || Object.keys(this._lists)[0] || 'political';
      this._activeTab = SYND_TAB_IDS.includes(this._activeTab) ? this._activeTab : this._readSubTab();
      this._loaded = true;
    } catch {
      this._loaded = false;
      this._msg = 'Could not load the channel settings.';
    }
    this._loading = false;
    this.render();
  }

  // ---- section builders ----

  _pill(dirty) {
    return `<span class="pill${dirty ? ' dirty' : ''}" data-pillbox><span class="dot"></span>${dirty ? 'Unsaved changes' : 'Saved'}</span>`;
  }

  // SOW-088: the Publishing Activity datatable (the former standalone Syndication tab). The nested tracker
  // reads the shared client registry, so composition needs no wiring here.
  _activityCard() {
    return `<section class="card" id="sec-activity" data-sec>
      <div class="card-h"><span class="hi"><svg viewBox="0 0 24 24"><use href="#c-kanban"/></svg></span>
        <div><h2>Publishing Activity</h2><p>The cross-posting queue and its delivery status, filterable by state, type, and trigger.</p></div></div>
      <div class="card-b"><gbti-syndication-tracker></gbti-syndication-tracker></div>
    </section>`;
  }

  _pipelineCard() {
    const p = this._pipeline;
    if (!p) return '';
    const ready = p.requireApproval ? 'hold' : (Number(p.holdMinutes) > 0 ? 'auto' : 'now');
    // SOW-131: the DESTINATIONS checkboxes were removed. Channel enablement is now matrix-derived (a channel is
    // on iff the auto-share matrix routes any type to it), so the matrix below is the single source of truth.
    // Cell modes: Off | On-Automatic (adapter posts after the hold) | On-Manual (a superadmin Social Queue task
    // for review; the queue's Post now sends it) | Popular (engagement-gated, engine TBD). A MANUAL-capability
    // channel (X, LinkedIn) cannot post automatically, so its select never offers On-Automatic. The per-channel
    // delay row stays auto-only (a queued manual task has no schedule).
    const cell = (type, ch) => {
      const val = p.autoMatrix?.[type]?.[ch] ?? 'off';
      const modes = AUTO_MODES.filter((m) => !(m === 'on' && channelCapability(ch) === 'manual'));
      const opts = modes.map((m) => `<option value="${esc(m)}"${m === val ? ' selected' : ''}>${esc(AUTO_MODE_LABEL[m] || m)}</option>`).join('');
      return `<td><select data-matrix-cell data-mtype="${esc(type)}" data-mchan="${esc(ch)}">${opts}</select></td>`;
    };
    // A manual-capability channel (X, LinkedIn) gets a header title clarifying it cannot post automatically.
    const chTitle = (ch) => (channelCapability(ch) === 'manual' ? ` title="${esc((MATRIX_CHAN_LABEL[ch] || ch) + ' cannot post automatically; On-Manual queues a Social Queue task a superadmin posts by hand.')}"` : '');
    const matrixHead = `<tr><th class="rowh">Content type</th>${MATRIX_CHANNELS.map((ch) => `<th${chTitle(ch)}>${esc(MATRIX_CHAN_LABEL[ch] || ch)}</th>`).join('')}</tr>`;
    const matrixRows = AUTO_TYPES.map((type) => `<tr><td class="rowh">${esc(MATRIX_TYPE_LABEL[type] || type)}</td>${MATRIX_CHANNELS.map((ch) => cell(type, ch)).join('')}</tr>`).join('');
    // SOW-125: per-channel delay overrides. Auto channels only (X has no schedule, it is a manual task). Blank
    // means the override is unset, so the global hold window applies (shown as the placeholder). Zero is kept.
    const delays = AUTO_CHANNELS.map((ch) => {
      const dv = p.channelHoldMinutes?.[ch];
      const dval = (dv === undefined || dv === null) ? '' : String(dv);
      return `<div class="field"><label>${esc(MATRIX_CHAN_LABEL[ch] || ch)}</label>
        <input class="ctrl" type="number" min="0" max="1440" data-chan-hold="${esc(ch)}" value="${esc(dval)}" placeholder="${esc(String(p.holdMinutes))}" /></div>`;
    }).join('');
    return `<section class="card" id="sec-pipeline" data-sec>
      <div class="card-h"><span class="hi"><svg viewBox="0 0 24 24"><use href="#c-pipe"/></svg></span>
        <div><h2>Syndication pipeline</h2><p>Changes go live on the next mirror sync. Flagged items always need approval.</p></div>
        <span class="sp"></span>${this._pill(false)}</div>
      <div class="card-b">
        <div class="fgrid">
          <div class="field"><label>Syndication</label>
            <select class="ctrl" data-pipe-enabled>
              <option value="true"${p.enabled ? ' selected' : ''}>On</option>
              <option value="false"${p.enabled ? '' : ' selected'}>Off</option>
            </select>
            <span class="hint">Master switch for pushing member work out.</span></div>
          <div class="field"><label>When a post is ready</label>
            <select class="ctrl" data-pipe-ready>
              <option value="auto"${ready === 'auto' ? ' selected' : ''}>Auto-post after the hold</option>
              <option value="hold"${ready === 'hold' ? ' selected' : ''}>Hold for manual approval</option>
              <option value="now"${ready === 'now' ? ' selected' : ''}>Post immediately</option>
            </select>
            <span class="hint">What happens after the hold window passes.</span></div>
          <div class="field"><label>Hold window</label>
            <div class="sfxwrap"><input class="ctrl" type="number" min="0" max="1440" value="${esc(String(p.holdMinutes))}" data-pipe-hold /><span class="sfx">minutes</span></div>
            <span class="hint">The cancel window before an item auto-posts.</span></div>
        </div>
        <div class="field" style="margin-top:20px"><label>Auto-share by content type</label>
          <div class="mtx-scroll"><table class="matrix"><thead>${matrixHead}</thead><tbody>${matrixRows}</tbody></table></div>
          <span class="hint">On-Manual sends a channel's posts to the Social Queue for superadmin review before anything goes out. X and LinkedIn cannot post automatically, so On-Manual is their only deliverable mode.</span>
          <span class="hint">Popular posts only after enough members engage with the item.</span></div>
        <div class="field" style="margin-top:20px"><label>Per-channel delay (minutes)</label>
          <div class="chandelays">${delays}</div>
          <span class="hint">Blank uses the hold window above. A channel posts this many minutes after publish (or after approval).</span></div>
      </div>
      <div class="cardfoot"><span class="fmsg" data-fmsg></span>
        <button class="btn btn-ghost" type="button" data-discard="pipe">Discard</button>
        <button class="btn btn-primary" type="button" data-save-pipe disabled><svg viewBox="0 0 24 24"><use href="#c-check"/></svg> Save changes</button></div>
    </section>`;
  }

  _templatesCard() {
    const cur = this._curCh;
    const tiles = TILE_CHANNELS.map((c) => `<button class="chtile${c.id === cur ? ' on' : ''}${c.active ? '' : ' soon'}" type="button" data-tile="${esc(c.id)}"${c.active ? '' : ' aria-disabled="true"'}${c.note ? ` title="${esc(c.note)}"` : ''}>
        <span class="ct-i ${esc(c.cls)}"><svg viewBox="0 0 24 24"><use href="#${esc(c.icon)}"/></svg></span>
        <span class="ct-n">${esc(c.name)}</span><span class="ct-s">${esc(c.sub)}</span></button>`).join('');
    // SOW-138: {body} (the full article) + SOW-140: {member-devto-handle} (the dev.to byline mention) are offered
    // on dev.to only, which is now the ONLY full-body channel (sow-217 retired Hashnode, the other one).
    const chipVars = cur === 'devto' ? [...VARS, '{body}', '{member-devto-handle}'] : VARS;
    const chips = chipVars.map((v) => `<button class="varchip" type="button" data-var="${esc(v)}">${esc(v)}</button>`).join('');
    const vis = this._tmplVis || 'pub';
    const work = this._work?.[`${vis}:${cur}`] || {};
    // The `· custom` marker reflects a stored override IN THE ACTIVE visibility map.
    const custom = (k) => ((vis === 'stub' ? this._channelTemplatesStub?.[cur]?.[k] : this._channelTemplates?.[cur]?.[k]) ? ' · custom' : '');
    // SOW-137: dev.to cross-posts the FULL article body, so the per-type short templates
    // (share/post/product/prompt) do NOT drive its post (the title is the item title; the body is byline + the
    // body + CTA footer). Hide those rows for dev.to and show a note. SOW-138: the body itself is editable below
    // (Public tab = Byline / Body / CTA footer). sow-217: Hashnode was the other full-body channel, now retired.
    const FULL_BODY = new Set(['devto']);
    const rows = (FULL_BODY.has(cur)
      ? `<p style="margin:2px 0 12px;color:var(--muted);font-size:12px;line-height:1.5">dev.to cross-posts the full article body, so there are no per-type message templates here. Below: the byline is prepended and the CTA footer appended, and the ${vis === 'stub' ? 'stub body is the members-only teaser' : 'Body wraps the article ({body} = the full article verbatim)'}.</p>`
      : TMPL_TYPES.map((t) => `<div class="tmpl">
        <div class="tl"><div class="nm">${esc(t.nm)}</div><div class="df">${esc(t.df + custom(t.key))}</div></div>
        <textarea class="ctrl" maxlength="500" rows="3" data-tk="${esc(t.key)}">${esc(work[t.key] || '')}</textarea></div>`).join(''))
      + (cur === 'reddit'
        ? `<div class="tmpl"><div class="tl"><div class="nm">Reddit body</div><div class="df">${esc('the description under the title' + custom('reddit-body'))}</div></div>
            <textarea class="ctrl" maxlength="500" rows="3" data-tk="reddit-body">${esc(work['reddit-body'] || '')}</textarea></div>
          <div class="tmpl"><div class="tl"><div class="nm">First comment</div><div class="df">${esc('the brand account\'s first comment' + custom('reddit-comment'))}</div></div>
            <textarea class="ctrl" maxlength="500" rows="4" data-tk="reddit-comment">${esc(work['reddit-comment'] || '')}</textarea></div>`
        : '')
      + (cur === 'devto'
        ? `<div class="tmpl"><div class="tl"><div class="nm">Byline</div><div class="df">${esc('prepended to the crosspost' + custom('devto-intro'))}</div></div>
            <textarea class="ctrl" maxlength="500" rows="3" data-tk="devto-intro">${esc(work['devto-intro'] || '')}</textarea></div>
          ${vis === 'stub'
            ? `<div class="tmpl"><div class="tl"><div class="nm">Stub body</div><div class="df">${esc('the members-only teaser middle' + custom('devto-stub'))}</div></div>
            <textarea class="ctrl" maxlength="500" rows="3" data-tk="devto-stub">${esc(work['devto-stub'] || '')}</textarea></div>`
            : `<div class="tmpl"><div class="tl"><div class="nm">Body</div><div class="df">${esc('the public post body; {body} = the full article verbatim' + custom('devto-body'))}</div></div>
            <textarea class="ctrl" maxlength="4000" rows="4" data-tk="devto-body">${esc(work['devto-body'] || '')}</textarea></div>`}
          <div class="tmpl"><div class="tl"><div class="nm">CTA footer</div><div class="df">${esc('appended to every dev.to post' + custom('devto-footer'))}</div></div>
            <textarea class="ctrl" maxlength="500" rows="4" data-tk="devto-footer">${esc(work['devto-footer'] || '')}</textarea></div>`
        : '');
    return `<section class="card" id="sec-templates" data-sec>
      <div class="card-h"><span class="hi"><svg viewBox="0 0 24 24"><use href="#c-tmpl"/></svg></span>
        <div><h2>Syndication templates</h2><p>Configured per destination channel. Blank falls back to the shared template, then the built-in.</p></div>
        <span class="sp"></span>${this._pill(this._tmplDirty?.size > 0)}</div>
      <div class="card-b">
        <div class="field" style="margin-bottom:16px"><label>Editing templates for</label>
          <div class="chtiles">${tiles}</div></div>
        <div class="field" style="margin-bottom:14px"><label>Visibility set</label>
          <div class="termtabs" style="margin-bottom:0">
            <button class="termtab${vis === 'pub' ? ' on' : ''}" type="button" data-vis="pub">Public</button>
            <button class="termtab${vis === 'stub' ? ' on' : ''}" type="button" data-vis="stub">Members stub</button>
          </div>
          <span class="hint">${vis === 'stub' ? 'These templates render for MEMBERS-ONLY items on this channel (the teaser framing).' : 'These templates render for public items on this channel.'}</span></div>
        <p class="varnote">Click a variable to insert it into the focused field. Write a token in CAPS to uppercase its value ({CONTENT-TYPE}).</p>
        <div class="varbar">${chips}</div>
        <div data-tmplfields>${rows}</div>
      </div>
      <div class="cardfoot"><span class="fmsg" data-fmsg></span>
        <button class="btn btn-ghost" type="button" data-discard="tmpl">Discard</button>
        <button class="btn btn-primary" type="button" data-save-tmpl disabled><svg viewBox="0 0 24 24"><use href="#c-check"/></svg> Save all templates</button></div>
    </section>`;
  }

  _autoshareCard() {
    const e = this._engagement;
    if (!e) return '';
    const tierLabel = { paid: 'Paid members only', 'paid-trial': 'Trial + paid', 'signed-in': 'Any signed-in member' };
    const tierOpts = (this._tiers || []).map((t) => `<option value="${esc(t)}"${e.tier === t ? ' selected' : ''}>${esc(tierLabel[t] || t)}</option>`).join('');
    return `<section class="card" id="sec-autoshare" data-sec>
      <div class="card-h"><span class="hi"><svg viewBox="0 0 24 24"><use href="#c-share"/></svg></span>
        <div><h2>News auto-share</h2><p>Posts a news item to its mapped category channel once engagement crosses a threshold.</p></div>
        <span class="sp"></span>${this._pill(false)}</div>
      <div class="card-b">
        <div class="togline">
          <label class="switch"><input type="checkbox" data-eng-enabled${e.enabled ? ' checked' : ''} /><span class="track"></span><span class="knob"></span></label>
          <div><div class="tl-t">Auto-share is ${e.enabled ? 'on' : 'off'}</div><div class="tl-s">Applies after the next reconcile mirror sync.</div></div>
        </div>
        <div class="fgrid">
          <div class="field"><label>Member threshold</label>
            <div class="sfxwrap"><input class="ctrl" type="number" min="1" max="1000" value="${esc(String(e.open_threshold))}" data-eng-threshold /><span class="sfx">members</span></div>
            <span class="hint">Distinct members who must open the item. Banned accounts never count.</span></div>
          <div class="field"><label>Counts which members</label>
            <select class="ctrl" data-eng-tier>${tierOpts}</select>
            <span class="hint">Membership tier that qualifies toward the threshold.</span></div>
          <div class="field"><label>A single comment</label>
            <select class="ctrl" data-eng-comment>
              <option value="true"${e.comment_autopost ? ' selected' : ''}>Posts the item immediately</option>
              <option value="false"${e.comment_autopost ? '' : ' selected'}>Does not post on its own</option>
            </select>
            <span class="hint">A comment is deliberate engagement.</span></div>
        </div>
      </div>
      <div class="cardfoot"><span class="fmsg" data-fmsg></span>
        <button class="btn btn-ghost" type="button" data-discard="eng">Discard</button>
        <button class="btn btn-primary" type="button" data-save-eng disabled><svg viewBox="0 0 24 24"><use href="#c-check"/></svg> Save changes</button></div>
    </section>`;
  }

  // SOW-126: the content engagement auto-share card (the `popular` matrix engine). Mirrors _autoshareCard: an
  // Enable select, a distinct-member threshold, the counting tier, and the row of engagement signals that count.
  _contentEngagementCard() {
    const e = this._contentEng;
    if (!e) return '';
    const tierLabel = { paid: 'Paid members only', 'paid-trial': 'Trial + paid', 'signed-in': 'Any signed-in member' };
    const tierOpts = (this._contentTiers || []).map((t) => `<option value="${esc(t)}"${e.tier === t ? ' selected' : ''}>${esc(tierLabel[t] || t)}</option>`).join('');
    const signalLabel = { opens: 'Opens', favorites: 'Favorites', upvotes: 'Upvotes', comments: 'Comments' };
    const signals = e.signals || {};
    const sigChips = (this._contentSignals || ['opens', 'favorites', 'upvotes', 'comments']).map((s) =>
      `<span class="chan${signals[s] ? ' on' : ''}" data-ceng-signal="${esc(s)}" role="checkbox" aria-checked="${signals[s] ? 'true' : 'false'}" tabindex="0"><span class="cbx"><svg viewBox="0 0 24 24"><use href="#c-check"/></svg></span>${esc(signalLabel[s] || s)}</span>`).join('');
    return `<section class="card" id="sec-content-autoshare" data-sec>
      <div class="card-h"><span class="hi"><svg viewBox="0 0 24 24"><use href="#c-share"/></svg></span>
        <div><h2>Content engagement auto-share</h2><p>Promotes a member content item to auto-share on its Popular channels once enough members engage.</p></div>
        <span class="sp"></span>${this._pill(false)}</div>
      <div class="card-b">
        <div class="fgrid">
          <div class="field"><label>Auto-share</label>
            <select class="ctrl" data-ceng-enabled>
              <option value="true"${e.enabled ? ' selected' : ''}>On</option>
              <option value="false"${e.enabled ? '' : ' selected'}>Off</option>
            </select>
            <span class="hint">Master switch for the Popular promotion engine. Applies after the next reconcile mirror sync.</span></div>
          <div class="field"><label>Member threshold</label>
            <div class="sfxwrap"><input class="ctrl" type="number" min="1" max="1000" value="${esc(String(e.threshold))}" data-ceng-threshold /><span class="sfx">members</span></div>
            <span class="hint">Distinct members who must engage. Banned accounts never count.</span></div>
          <div class="field"><label>Counts which members</label>
            <select class="ctrl" data-ceng-tier>${tierOpts}</select>
            <span class="hint">Membership tier that qualifies toward the threshold.</span></div>
        </div>
        <div class="field" style="margin-top:18px"><label>Signals that count</label>
          <div class="chgroup">${sigChips}</div>
          <span class="hint">When enough distinct members engage with a member content item, the reconcile promotes it to auto-share on its Popular channels. Opens counts a member opening the expanded reader view.</span></div>
      </div>
      <div class="cardfoot"><span class="fmsg" data-fmsg></span>
        <button class="btn btn-ghost" type="button" data-discard="ceng">Discard</button>
        <button class="btn btn-primary" type="button" data-save-ceng disabled><svg viewBox="0 0 24 24"><use href="#c-check"/></svg> Save changes</button></div>
    </section>`;
  }

  _wordlistsCard() {
    const names = Object.keys(this._lists || {});
    if (!names.length) return '';
    const cur = names.includes(this._termTab) ? this._termTab : names[0];
    const tabs = names.map((n) => `<button class="termtab${n === cur ? ' on' : ''}" type="button" data-tt="${esc(n)}">${esc(n[0].toUpperCase() + n.slice(1))} terms <span class="ct">${(this._lists[n] || []).length}</span></button>`).join('');
    const q = (this._termFilter || '').toLowerCase();
    const chips = (this._lists[cur] || []).map((w) => `<span class="term${q && !w.toLowerCase().includes(q) ? ' hidden' : ''}"><span>${esc(w)}</span><button class="x" type="button" data-term-remove data-list="${esc(cur)}" data-term="${esc(w)}" aria-label="Remove ${esc(w)}"><svg viewBox="0 0 24 24"><use href="#c-x"/></svg></button></span>`).join('');
    return `<section class="card" id="sec-words" data-sec>
      <div class="card-h"><span class="hi"><svg viewBox="0 0 24 24"><use href="#c-shield"/></svg></span>
        <div><h2>Moderation word lists</h2><p>A title or blurb that hits one of these holds the item for approval.</p></div></div>
      <div class="card-b">
        <div class="termtabs">${tabs}</div>
        <div class="searchwrap"><svg viewBox="0 0 24 24"><use href="#c-search"/></svg><input class="ctrl" data-term-filter placeholder="Filter ${esc(cur)} terms" value="${esc(this._termFilter || '')}" /></div>
        <div class="chips">${chips || '<span class="muted">No terms yet.</span>'}</div>
        <div class="addrow">
          <input class="ctrl" maxlength="64" data-term-input placeholder="Add a ${esc(cur)} term or phrase, then press Enter" />
          <button class="btn btn-primary" type="button" data-term-add><svg viewBox="0 0 24 24"><use href="#c-plus"/></svg> Add</button>
        </div>
        <p class="note-inline">Matching is case-insensitive on the posted title and blurb. Held items appear in <b>Syndication</b> for a human decision. Adds and removals apply immediately as audited house PRs.</p>
      </div>
    </section>`;
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client (superadmin) to manage the channels.</p>`); return; }
    if (!this._loaded) {
      if (!this._loading) { this._loading = true; this.load(); }
      this.set(this.css(CSS) + (this._msg ? `<p class="msg">${esc(this._msg)}</p>` : `<p class="muted">Loading the channel settings...</p>`));
      return;
    }
    // SOW-132: tabs — render ONLY the active section, so switching tabs shows one section at a time and a
    // save-triggered reload stays put (no scroll jump). The nested <gbti-syndication-tracker> mounts only on
    // Activity.
    const active = SYND_TAB_IDS.includes(this._activeTab) ? this._activeTab : 'activity';
    const tabs = SYND_TABS.map((t) => `<a data-tab="${t.id}" role="tab"${t.id === active ? ' class="on" aria-selected="true"' : ' aria-selected="false"'}><svg viewBox="0 0 24 24"><use href="#${t.ic}"/></svg>${esc(t.nm)}</a>`).join('');
    const builders = {
      activity: () => this._activityCard(), pipeline: () => this._pipelineCard(), templates: () => this._templatesCard(),
      news: () => this._autoshareCard(), content: () => this._contentEngagementCard(), words: () => this._wordlistsCard(),
    };
    const section = (builders[active] || builders.activity)();
    this.set(this.css(CSS) + ICONS + `<div class="${this._busy ? 'busy' : ''}">
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      <nav class="subnav" data-subnav role="tablist">${tabs}</nav>
      <p class="intro">Publishing activity, syndication templates, news auto-share, and moderation word lists. The category-to-channel map lives in <b>Categories</b> — ${this._mapCount ?? 0} categories mapped.</p>
      ${section}
    </div>`);
    this._wire();
  }

  // ---- wiring ----

  _markDirty(secId, on = true) {
    const sec = this.$(`#${secId}`);
    if (!sec) return;
    const pill = sec.querySelector('[data-pillbox]');
    if (pill) { pill.className = `pill${on ? ' dirty' : ''}`; pill.innerHTML = `<span class="dot"></span>${on ? 'Unsaved changes' : 'Saved'}`; }
    const save = sec.querySelector('[data-save-pipe],[data-save-tmpl],[data-save-eng],[data-save-ceng]');
    if (save) save.disabled = !on;
    const m = sec.querySelector('[data-fmsg]');
    if (m && on) m.textContent = '';
  }

  _wire() {
    // SOW-132: tabs — clicking a tab switches the active section, deep-links it (sub=<id> via replaceState so the
    // admin group is not re-mounted), and re-renders. Only the active section is in the DOM.
    this.$$('[data-tab]').forEach((a) => a.addEventListener('click', () => {
      const id = a.dataset.tab;
      if (!SYND_TAB_IDS.includes(id) || id === this._activeTab) return;
      this._activeTab = id;
      this._writeSubTab(id);
      this.render();
    }));

    // Pipeline: any control edit arms the card.
    ['[data-pipe-enabled]', '[data-pipe-ready]', '[data-pipe-hold]'].forEach((sel) => {
      const el = this.$(sel);
      if (el) { el.addEventListener('change', () => { this._pipeDirty = true; this._markDirty('sec-pipeline'); }); el.addEventListener('input', () => { this._pipeDirty = true; this._markDirty('sec-pipeline'); }); }
    });
    // SOW-131: the DESTINATIONS checkboxes were removed; the matrix is the single source of truth.
    // SOW-125: the auto-share matrix selects + per-channel delay inputs arm the same pipeline card (many
    // elements, so $$ not the single-element $ list above).
    this.$$('[data-matrix-cell], [data-chan-hold]').forEach((el) => {
      el.addEventListener('change', () => { this._pipeDirty = true; this._markDirty('sec-pipeline'); });
      el.addEventListener('input', () => { this._pipeDirty = true; this._markDirty('sec-pipeline'); });
    });
    this.on('[data-save-pipe]', 'click', () => this._savePipeline());

    // Templates: tile switching keeps per-channel working copies; fields arm the card.
    this.$$('[data-tile]').forEach((t) => t.addEventListener('click', () => {
      const id = t.dataset.tile;
      if (!this._work[`pub:${id}`] || id === this._curCh) return;
      this._captureTmpl();
      this._curCh = id;
      this._renderKeepingScroll();
      if (this._tmplDirty.size) this._markDirty('sec-templates');
    }));
    this.$$('[data-vis]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.vis === this._tmplVis) return;
      this._captureTmpl();
      this._tmplVis = b.dataset.vis;
      this._renderKeepingScroll();
      if (this._tmplDirty.size) this._markDirty('sec-templates');
    }));
    this.$$('[data-tk]').forEach((f) => {
      f.addEventListener('focusin', () => { this._lastField = f; });
      f.addEventListener('input', () => {
        const wk = `${this._tmplVis}:${this._curCh}`;
        this._work[wk][f.dataset.tk] = f.value;
        const key = `${wk}:${f.dataset.tk}`;
        if (f.value === (this._base[wk]?.[f.dataset.tk] ?? '')) this._tmplDirty.delete(key);
        else this._tmplDirty.add(key);
        this._markDirty('sec-templates', this._tmplDirty.size > 0);
      });
    });
    this.$$('[data-var]').forEach((v) => v.addEventListener('click', () => {
      const f = this._lastField || this.$('[data-tk]');
      if (!f) return;
      const s = f.selectionStart ?? f.value.length;
      f.value = f.value.slice(0, s) + v.dataset.var + f.value.slice(f.selectionEnd ?? s);
      f.dispatchEvent(new Event('input'));
      f.focus();
    }));
    this.on('[data-save-tmpl]', 'click', () => this._saveTemplates());

    // Auto-share.
    ['[data-eng-enabled]', '[data-eng-threshold]', '[data-eng-tier]', '[data-eng-comment]'].forEach((sel) => {
      const el = this.$(sel);
      if (el) { el.addEventListener('change', () => { this._engDirty = true; this._markDirty('sec-autoshare'); }); el.addEventListener('input', () => { this._engDirty = true; this._markDirty('sec-autoshare'); }); }
    });
    this.on('[data-save-eng]', 'click', () => {
      const enabled = this.$('[data-eng-enabled]')?.checked === true;
      const openThreshold = Number(this.$('[data-eng-threshold]')?.value || 0);
      const tier = this.$('[data-eng-tier]')?.value || 'paid';
      const commentAutopost = this.$('[data-eng-comment]')?.value === 'true';
      if (!Number.isInteger(openThreshold) || openThreshold < 1) { this._msg = 'The member threshold must be a whole number of 1 or more.'; this.render(); return; }
      this._saveOptimistic(
        () => this.client.setNewsEngagement({ enabled, openThreshold, tier, commentAutopost }),
        () => { this._engDirty = false; if (this._engagement) { this._engagement.enabled = enabled; this._engagement.open_threshold = openThreshold; this._engagement.tier = tier; this._engagement.comment_autopost = commentAutopost; } },
      );
    });

    // SOW-126: Content auto-share. The Enable/threshold/tier controls + the signal chips arm the card.
    ['[data-ceng-enabled]', '[data-ceng-threshold]', '[data-ceng-tier]'].forEach((sel) => {
      const el = this.$(sel);
      if (el) { el.addEventListener('change', () => { this._contentEngDirty = true; this._markDirty('sec-content-autoshare'); }); el.addEventListener('input', () => { this._contentEngDirty = true; this._markDirty('sec-content-autoshare'); }); }
    });
    this.$$('[data-ceng-signal]').forEach((ch) => {
      const flip = () => { ch.classList.toggle('on'); ch.setAttribute('aria-checked', ch.classList.contains('on') ? 'true' : 'false'); this._contentEngDirty = true; this._markDirty('sec-content-autoshare'); };
      ch.addEventListener('click', flip);
      ch.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
    });
    this.on('[data-save-ceng]', 'click', () => this._saveContentEngagement());

    // Discard = reload the committed values.
    this.$$('[data-discard]').forEach((b) => b.addEventListener('click', () => { this._loaded = false; this._msg = ''; this.render(); }));

    // Word lists: tabs, filter (client-side), add + remove (immediate audited ops, as before).
    this.$$('[data-tt]').forEach((t) => t.addEventListener('click', () => { this._termTab = t.dataset.tt; this._termFilter = ''; this.render(); }));
    const filter = this.$('[data-term-filter]');
    if (filter) filter.addEventListener('input', () => {
      this._termFilter = filter.value;
      const q = filter.value.trim().toLowerCase();
      this.$$('.term').forEach((el) => {
        const w = el.querySelector('span')?.textContent || '';
        el.classList.toggle('hidden', Boolean(q) && !w.toLowerCase().includes(q));
      });
    });
    const addTerm = () => {
      const input = this.$('[data-term-input]');
      const term = (input?.value || '').trim();
      if (!term) { this._msg = 'Enter a term first.'; this.render(); return; }
      this._run(() => this.client.addModerationFlagTerm({ list: this._termTab, term }));
    };
    this.on('[data-term-add]', 'click', addTerm);
    const input = this.$('[data-term-input]');
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addTerm(); } });
    this.$$('[data-term-remove]').forEach((b) => b.addEventListener('click', () =>
      this._run(() => this.client.removeModerationFlagTerm({ list: b.dataset.list, term: b.dataset.term }))));
  }

  /** Re-render without the viewport drifting: a tile/visibility switch replaces the whole shadow tree
   *  (which re-creates the nested Publishing Activity), so pin the scroll position across it. */
  _renderKeepingScroll() {
    const y = window.scrollY;
    this.render();
    window.scrollTo({ top: y });
  }

  _captureTmpl() {
    const wk = `${this._tmplVis}:${this._curCh}`;
    this.$$('[data-tk]').forEach((f) => { if (this._work[wk]) this._work[wk][f.dataset.tk] = f.value; });
  }

  async _savePipeline() {
    // SOW-131: no more DESTINATIONS checkboxes; the matrix drives channel enablement, so `channels` is not sent.
    const ready = this.$('[data-pipe-ready]')?.value || 'auto';
    let holdMinutes = Number(this.$('[data-pipe-hold]')?.value ?? 60);
    if (!Number.isFinite(holdMinutes) || holdMinutes < 0) holdMinutes = 60;
    if (ready === 'now') holdMinutes = 0;
    // SOW-125: the auto-share matrix, sent as the full { type: { channel: mode } } over EVERY matrix channel
    // (X/LinkedIn included; their selects offer off | on-manual | popular, never On-Automatic, and the edit
    // layer rejects `on` for them). The edit layer writes only cells that differ from the effective value.
    // Per-channel delays: an empty input sends '' to clear the override.
    const autoMatrix = {};
    this.$$('[data-matrix-cell]').forEach((sel) => {
      const type = sel.dataset.mtype; const ch = sel.dataset.mchan;
      if (!type || !ch) return;
      (autoMatrix[type] ??= {})[ch] = sel.value;
    });
    const channelHoldMinutes = {};
    this.$$('[data-chan-hold]').forEach((inp) => { channelHoldMinutes[inp.dataset.chanHold] = inp.value === '' ? '' : Number(inp.value); });
    const enabled = this.$('[data-pipe-enabled]')?.value === 'true';
    const requireApproval = ready === 'hold';
    // SOW-132: optimistic — reflect the SAVED matrix + settings so they stay visible (a git reload reads the
    // pre-merge file and reverts the matrix to the stored defaults).
    this._saveOptimistic(
      () => this.client.setSyndicationSettings({ enabled, requireApproval, holdMinutes, autoMatrix, channelHoldMinutes }),
      () => {
        this._pipeDirty = false;
        if (this._pipeline) {
          this._pipeline.enabled = enabled;
          this._pipeline.requireApproval = requireApproval;
          this._pipeline.holdMinutes = holdMinutes;
          this._pipeline.autoMatrix = autoMatrix;
          this._pipeline.channelHoldMinutes = { ...channelHoldMinutes };
        }
      },
    );
  }

  // SOW-126: read the content-engagement card back and save it (mirrors the news _save-eng handler).
  _saveContentEngagement() {
    const enabled = this.$('[data-ceng-enabled]')?.value === 'true';
    const threshold = Number(this.$('[data-ceng-threshold]')?.value || 0);
    const tier = this.$('[data-ceng-tier]')?.value || 'signed-in';
    const signals = {};
    this.$$('[data-ceng-signal]').forEach((ch) => { signals[ch.dataset.cengSignal] = ch.classList.contains('on'); });
    if (!Number.isInteger(threshold) || threshold < 1) { this._msg = 'The member threshold must be a whole number of 1 or more.'; this.render(); return; }
    this._saveOptimistic(
      () => this.client.setContentEngagementSettings({ enabled, threshold, tier, signals }),
      () => { this._contentEngDirty = false; if (this._contentEng) { this._contentEng.enabled = enabled; this._contentEng.threshold = threshold; this._contentEng.tier = tier; this._contentEng.signals = { ...signals }; } },
    );
  }

  async _saveTemplates() {
    this._captureTmpl();
    const dirty = [...this._tmplDirty];
    if (!dirty.length) return;
    this._busy = true; this._msg = ''; this.render();
    // ONE batch op -> ONE house PR (per-field PRs raced each other on the same file; hit live 2026-07-12).
    const edits = dirty.map((key) => {
      const [vis, channel, type] = key.split(':');
      return { type, template: (this._work[`${vis}:${channel}`]?.[type] || '').trim(), channel, stub: vis === 'stub' };
    });
    let err = null; let r = null;
    try { r = await this.client.setSyndicationTemplates({ edits }); }
    catch (e) { err = e?.message || 'Could not save the templates.'; }
    this._busy = false;
    if (err) { this._msg = err; this.render(); return; }
    // SOW-132: reflect the saved values OPTIMISTICALLY, and DO NOT reload from git. The save opens a superadmin
    // auto-merge PR; a full reload (readYaml) reads the file BEFORE the merge lands, which flashed the OLD value
    // and made the edit look lost. Instead bake each saved edit into the local override maps + the working
    // baseline, recompute the effective field value, and clear dirty. The stays-put render keeps the current tab,
    // channel, and visibility. git + the mirror catch up in the background.
    for (const e of edits) {
      const map = e.stub ? (this._channelTemplatesStub ??= {}) : (this._channelTemplates ??= {});
      if (e.template) { (map[e.channel] ??= {})[e.type] = e.template; }
      else if (map[e.channel]) { delete map[e.channel][e.type]; if (!Object.keys(map[e.channel]).length) delete map[e.channel]; }
      const wk = `${e.stub ? 'stub' : 'pub'}:${e.channel}`;
      const eff = e.stub ? this._effStub(e.channel, e.type) : this._effPub(e.channel, e.type);
      if (this._work[wk]) this._work[wk][e.type] = eff;
      if (this._base[wk]) this._base[wk][e.type] = eff;
    }
    this._tmplDirty = new Set();
    this._msg = (r && !r.noop)
      ? `${r.count ?? edits.length} template${(r.count ?? edits.length) === 1 ? '' : 's'} saved${r.prNumber ? `; ${submitAck({ prNumber: r.prNumber, autoMerge: false })}` : ''}`
      : 'No changes.';
    this.render();
  }

  _ackMsg(r) {
    return r?.noop ? 'No change (already in that state).'
      : (r?.prNumber ? submitAck({ prNumber: r.prNumber, autoMerge: false }) : 'Done.');
  }

  // SOW-132: save a settings card WITHOUT a git reload. On success `apply(r)` reflects the saved values into the
  // local state so they stay visible; a full reload (readYaml) reads the file BEFORE the superadmin auto-merge PR
  // lands and reverts the just-edited values to the stored defaults (the matrix "reset to zero on save" report).
  // git + the mirror catch up in the background.
  async _saveOptimistic(fn, apply) {
    this._busy = true; this._msg = ''; this.render();
    let r = null;
    try { r = await fn(); }
    catch (e) { this._busy = false; this._msg = e?.message || 'That edit failed.'; this.render(); return; }
    this._busy = false;
    try { apply(r); } catch { /* leave the state as-is */ }
    this._msg = this._ackMsg(r);
    this.render();
  }

  // Used by the immediate word-list add/remove ops, which DO want the fresh list read back.
  async _run(fn) {
    this._busy = true; this._msg = ''; this.render();
    try { this._msg = this._ackMsg(await fn()); }
    catch (e) { this._msg = e?.message || 'That edit failed.'; }
    this._busy = false;
    this._loaded = false;
    this.render();
  }

  disconnectedCallback() {
    if (this._spy) window.removeEventListener('scroll', this._spy);
    super.disconnectedCallback?.();
  }
}

define('gbti-channel-map-manager', GbtiChannelMapManager);
export { GbtiChannelMapManager };
