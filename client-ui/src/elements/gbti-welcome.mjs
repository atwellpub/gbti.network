// <gbti-welcome> (SOW-029): the post-setup welcome view, mounted by the extension when the onboarding wizard's
// ready button ("Complete Integration") fires gbti:onboarding-start. Styled per the owner's Claude Design
// handoff (2026-07-20, "Welcome Flow.dc.html"): a two-pane modal panel with a left rail stepper (numbered
// circles, clickable), a per-step heading + progress bar, a scrollable content pane, and a Back/Skip/Continue
// footer, in the handoff's dark + light palettes. It walks the member through five to-dos:
//   Discord (connect + role), Follow the channels (the GBTI properties grid), Your socials (staged handles),
//   Follow members (the directory grid), Follow topics (the shared picker) -> a done state with stats.
// Host-agnostic: it consumes only the injected client + a public fetch of /members-index.json, so it runs in
// the extension now and the npm CMS later. Emits gbti:welcome-done when the member finishes.
import { GbtiElement, define, esc } from '../base.mjs';
import { phaseLabel, shuffle, excludeSelf, paginate, resumeStep } from '../welcome-core.mjs';
import { DISCORD_LINK_URL } from '../discord.mjs';
import { socialIcon, SOCIAL_KEYS, SOCIAL_LABELS } from '../social-icons.mjs';
import { recallProfileSocials } from '../profile-fields.mjs'; // SOW-129 QA: recall saved profile socials into the welcome step
import './gbti-topic-picker.mjs'; // SOW-054: the followed-topics step control

const SITE = 'https://gbti.network';
const PAGE_SIZE = 12;
const DISCORD_DONE_KEY = 'gbti-welcome-discord-joined';
const CHAN_FOLLOWED_KEY = 'gbti-welcome-chan-followed'; // channels the member opened Follow on (local, best-effort)

// The five steps (order is the single source of truth). `key` matches the historical step names; `label` +
// `sub` feed the rail; `heading` feeds the main pane per the design handoff.
const STEPS = [
  { key: 'discord', label: 'Discord', sub: 'Join the community', heading: 'Connect Discord' },
  { key: 'subreddit', label: 'Follow', sub: 'Network channels', heading: 'Follow the channels' },
  { key: 'socials', label: 'Socials', sub: 'Your handles', heading: 'Add your socials' },
  { key: 'follow', label: 'Members', sub: 'People to follow', heading: 'Follow members' },
  { key: 'topics', label: 'Topics', sub: 'Tune your feed', heading: 'Follow topics' },
];
const DONE_HEADING = 'You are all set';

// GBTI's own channels (mirrors src/lib/social.ts, the site footer; the extension cannot import site TS).
// Rendered as a card grid per the design handoff; Follow opens the channel and marks the card followed.
const GBTI_CHANNELS = [
  ['reddit', 'Reddit', 'https://www.reddit.com/r/GBTI_network', 'Member articles, products, and prompts syndicate to our community subreddit. Open it and hit Join.', 'r/GBTI_network'],
  ['x', 'X', 'https://x.com/gbti_network', 'Syndicated member work and network updates, as they publish.', '@gbti_network'],
  ['bluesky', 'Bluesky', 'https://bsky.app/profile/gbti.bsky.social', 'The same syndicated stream on Bluesky.', '@gbti.bsky.social'],
  ['youtube', 'YouTube', 'https://www.youtube.com/@gbti_network', 'Video sessions and walkthroughs from the network.', '@gbti_network'],
  ['github', 'GitHub', 'https://github.com/gbti-network', 'The public content repo and our open source work.', 'gbti-network'],
  ['devto', 'Dev.to', 'https://dev.to/gbti', 'Member articles crossposted to the GBTI organization on DEV.', '@gbti'],
  ['hashnode', 'Hashnode', 'https://gbti.hashnode.dev/', 'Member articles crossposted to the GBTI publication on Hashnode.', 'gbti.hashnode.dev'],
  ['dailydev', 'daily.dev', 'https://daily.dev/squads/gbti_network/', 'Follow the GBTI squad inside your daily.dev feed.', 'GBTI squad'],
  ['linkedin', 'LinkedIn', 'https://www.linkedin.com/company/gbti-network/posts', 'Network updates and member work on LinkedIn.', 'GBTI Network'],
];

// The socials step: raw handles stage here until the profile page's editor consumes them into profile.md
// (mergeStagedLinks in profile-fields.mjs), so the ONE save runs through the real publish pipeline.
const SOCIALS_STAGE_KEY = 'gbti-welcome-socials';
// Shown by default: the syndication-mentioned platforms first (X / Bluesky / Mastodon get automatic handle
// mentions today), then the common presence links. GitHub is implicit (they signed in with it) and Discord
// connects in step 1, so neither is collected here.
const SOCIAL_STARTERS = ['x', 'bluesky', 'linkedin', 'youtube', 'website']; // sow-159: mastodon retired
const SOCIAL_HIDDEN = new Set(['github', 'discord']);

// The member-card avatar fallback palette (the design handoff's initials discs).
const AV_COLORS = ['#1f9e5f', '#c98a2b', '#5a8ad6', '#9b6fd0', '#d0715f', '#3fa88a', '#c85b8e'];
const avColor = (name) => { let h = 0; for (const c of String(name || '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; };

const lc = (s) => String(s || '').toLowerCase();
const check = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="var(--brand)"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const discordIco = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="currentColor"><path d="M19.3 5.4A17 17 0 0 0 15.1 4l-.3.5c1.4.4 2 .8 2.8 1.3a11 11 0 0 0-8.9 0c.8-.5 1.5-.9 2.8-1.3L11.2 4A17 17 0 0 0 7 5.4C4.3 9.3 3.6 13.1 3.9 16.8a16 16 0 0 0 4.8 2.4l.6-1c-.5-.2-1-.5-1.6-.9l.4-.3a11 11 0 0 0 9.6 0l.4.3c-.5.4-1 .7-1.6.9l.6 1a16 16 0 0 0 4.8-2.4c.4-4.3-.6-8-2.6-11.4zM9.6 14.5c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8zm4.8 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8z"/></svg>`;
// SOW-048: the GitHub mark for the forced-sign-in (login splash) mode.
const githubIco = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49l-.01-1.7c-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.34 9.34 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9l-.01 2.81c0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/></svg>`;

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg);
    /* The design handoff's dark palette (the extension default). */
    --wf-surface:#232029; --wf-panel:#2a2731; --wf-panel2:#302c37; --wf-raise:#35313d;
    --wf-line:rgba(255,255,255,.085); --wf-line2:rgba(255,255,255,.16);
    --wf-fg:#f3f2f0; --wf-soft:#bdbac4; --wf-mute:#847f8d; --wf-faint:#5c5865;
    --wf-green:#1f9e5f; --wf-greenfg:#5fd49a; --wf-greendim:rgba(31,158,95,.16);
  }
  :host-context([data-theme="light"]) {
    --wf-surface:#efece6; --wf-panel:#ffffff; --wf-panel2:#f6f3ee; --wf-raise:#ece7df;
    --wf-line:rgba(30,24,38,.10); --wf-line2:rgba(30,24,38,.18);
    --wf-fg:#241f2c; --wf-soft:#4f4a58; --wf-mute:#837e8c; --wf-faint:#a9a4b0;
    --wf-green:#1f9e5f; --wf-greenfg:#157a48; --wf-greendim:rgba(31,158,95,.12);
  }
  @keyframes wf-in { from { opacity:0; transform:translateY(14px) scale(.985); } to { opacity:1; transform:none; } }
  @keyframes wf-fade { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }

  /* THE PANEL: a two-pane modal (rail + main) on the 7px house radius. */
  .wf { display:flex; width:100%; max-width:1080px; margin:0 auto; height:min(72vh, 640px); min-height:480px;
    background:var(--wf-surface); border:1px solid var(--wf-line); border-radius:7px; overflow:hidden;
    box-shadow:0 50px 130px -30px rgba(0,0,0,.6), 0 0 0 1px rgba(0,0,0,.25);
    animation:wf-in .34s cubic-bezier(.2,.8,.2,1) both; color:var(--wf-fg); }
  .rail { width:264px; flex:none; background:var(--wf-panel); border-right:1.5px solid var(--wf-line);
    padding:26px 20px; display:flex; flex-direction:column; box-sizing:border-box; }
  .brand { display:inline-flex; align-items:center; gap:9px; }
  .brand .mark { width:30px; height:30px; border-radius:7px; background:var(--wf-green); color:#fff;
    display:flex; align-items:center; justify-content:center; font-family:var(--font-display); font-weight:700; font-size:14px; }
  .brand b { font-family:var(--font-display); font-size:15px; font-weight:600; color:var(--wf-fg); line-height:1; }
  .railhead { font-family:var(--font-mono); font-size:10.5px; font-weight:600; letter-spacing:.14em;
    text-transform:uppercase; color:var(--wf-mute); margin:22px 0 12px; }
  .rsteps { display:flex; flex-direction:column; gap:2px; flex:1; min-height:0; }
  .rstep { display:flex; align-items:center; gap:12px; padding:10px 11px; border-radius:7px;
    border:1.5px solid transparent; background:none; cursor:pointer; width:100%; font:inherit; text-align:left; transition:.12s; }
  .rstep.active { border-color:var(--wf-line); background:var(--wf-panel2); }
  .rstep .circ { width:26px; height:26px; flex:none; border-radius:50%; display:flex; align-items:center;
    justify-content:center; font-family:var(--font-mono); font-weight:600; font-size:11px;
    background:var(--wf-raise); color:var(--wf-faint); box-sizing:border-box; }
  .rstep.done .circ { background:var(--wf-green); color:#fff; }
  .rstep.active .circ { background:var(--wf-greendim); color:var(--wf-greenfg); border:1.5px solid var(--wf-green); }
  .rstep .rl { display:flex; flex-direction:column; line-height:1.2; min-width:0; }
  .rstep .rl b { font-size:13.5px; font-weight:600; color:var(--wf-soft); }
  .rstep.done .rl b, .rstep.active .rl b { color:var(--wf-fg); }
  .rstep .rl span { font-size:11px; color:var(--wf-mute); }
  .themebtn { display:inline-flex; align-items:center; justify-content:center; gap:8px; font:inherit; font-weight:600;
    font-size:12px; color:var(--wf-soft); background:var(--wf-panel2); border:1.5px solid var(--wf-line);
    border-radius:7px; padding:9px 13px; cursor:pointer; margin-top:16px; }
  .themebtn:hover { color:var(--wf-fg); border-color:var(--wf-line2); }

  .main { flex:1; min-width:0; display:flex; flex-direction:column; }
  .top { padding:24px 34px 0; }
  .eyebrow { font-family:var(--font-mono); font-size:10.5px; font-weight:600; letter-spacing:.16em;
    text-transform:uppercase; color:var(--wf-greenfg); display:flex; align-items:center; gap:10px; }
  .couponline { margin:2px 0 10px; font-size:12.5px; line-height:1.5; color:var(--muted); }
  .phasepill { font-family:var(--font-body); font-size:10px; font-weight:700; letter-spacing:.05em;
    color:var(--wf-mute); background:var(--wf-panel2); border:1px solid var(--wf-line); border-radius:999px; padding:2px 9px; }
  .heads { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-top:5px; }
  .heads h2 { font-family:var(--font-display); font-size:25px; font-weight:600; letter-spacing:-.01em; margin:0; color:var(--wf-fg); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-transform:none; }
  .stepmono { font-family:var(--font-mono); font-size:11px; font-weight:600; letter-spacing:.1em; color:var(--wf-mute); white-space:nowrap; }
  .bar { height:4px; background:var(--wf-panel2); border-radius:99px; overflow:hidden; margin-top:15px; }
  .bar i { display:block; height:100%; background:var(--wf-green); border-radius:99px; transition:width .3s; }
  .content { flex:1; min-height:0; overflow-y:auto; padding:22px 34px; }
  .stepin { animation:wf-fade .3s ease both; }
  .foot { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:16px 34px;
    border-top:1.5px solid var(--wf-line); background:var(--wf-surface); }
  .footr { display:flex; align-items:center; gap:10px; }
  .gbtn { font:inherit; font-weight:600; font-size:13px; color:var(--wf-soft); background:var(--wf-raise);
    border:1.5px solid var(--wf-line); border-radius:7px; padding:11px 18px; cursor:pointer; }
  .gbtn:hover { color:var(--wf-fg); border-color:var(--wf-line2); }
  .gbtn.off { color:var(--wf-faint); background:none; border-color:transparent; cursor:default; opacity:.5; }
  .skipbtn { font:inherit; font-weight:600; font-size:13px; color:var(--wf-mute); background:none; border:none; cursor:pointer; padding:10px 8px; }
  .skipbtn:hover { color:var(--wf-soft); }
  .pbtn { font:inherit; font-weight:600; font-size:13.5px; color:#fff; background:var(--wf-green);
    border:1.5px solid transparent; border-radius:7px; padding:11px 24px; cursor:pointer; }
  .pbtn:hover { filter:brightness(1.07); }
  .pbtn[disabled] { opacity:.55; cursor:default; }

  /* Step content shared. */
  .intro { font-size:14px; line-height:1.6; color:var(--wf-soft); max-width:64ch; margin:0 0 16px; }
  .ico-tile { flex:none; border-radius:7px; background:var(--wf-raise); border:1.5px solid var(--wf-line);
    display:flex; align-items:center; justify-content:center; color:var(--wf-fg); box-sizing:border-box; }
  .callout { display:flex; gap:9px; font-size:12.5px; line-height:1.5; color:var(--wf-mute);
    background:var(--wf-panel2); border:1.5px solid var(--wf-line); border-radius:7px; padding:11px 13px; margin-top:16px; }
  .callout .gl { color:var(--wf-faint); flex:none; }
  .sbtn { font:inherit; font-weight:600; font-size:12.5px; color:#fff; background:var(--wf-green);
    border:1.5px solid transparent; border-radius:7px; padding:7px 15px; cursor:pointer; flex:none; transition:.12s; }
  .sbtn.on { color:var(--wf-soft); background:var(--wf-raise); border-color:var(--wf-line); }

  /* Discord step. */
  .dhead { display:flex; align-items:center; gap:13px; margin-bottom:16px; }
  .dhead .ico-tile { width:46px; height:46px; }
  .dhead h3 { font-family:var(--font-display); font-size:20px; font-weight:600; margin:0; line-height:1.1; color:var(--wf-fg); }
  .dhead p { font-size:12.5px; color:var(--wf-mute); margin:2px 0 0; }
  .dbtn { display:inline-flex; align-items:center; gap:8px; font:inherit; font-weight:600; font-size:13.5px;
    color:#fff; background:var(--wf-green); border:1.5px solid transparent; border-radius:7px; padding:11px 18px; cursor:pointer; }
  .dbtn.on, .dbtn[disabled] { color:var(--wf-soft); background:var(--wf-raise); border-color:var(--wf-line); cursor:default; }

  /* Channels grid. */
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(238px, 1fr)); gap:12px; }
  .pcard { display:flex; flex-direction:column; gap:11px; padding:14px; background:var(--wf-panel2);
    border:1.5px solid var(--wf-line); border-radius:7px; box-sizing:border-box; }
  .pcard .ph { display:flex; align-items:center; gap:10px; min-width:0; }
  .pcard .ico-tile { width:34px; height:34px; }
  .pcard .pn { min-width:0; }
  .pcard .pn b { display:block; font-size:14px; font-weight:600; color:var(--wf-fg); line-height:1.1; }
  .pcard .pn span { display:block; font-family:var(--font-mono); font-size:11.5px; color:var(--wf-mute);
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pcard .pd { font-size:12.5px; line-height:1.5; color:var(--wf-soft); flex:1; }
  .pcard .sbtn { align-self:flex-start; }

  /* Socials step. */
  .srow { display:flex; align-items:center; gap:11px; margin:0 0 10px; max-width:560px; }
  .srow .ico-tile { width:40px; height:40px; }
  .srow input { flex:1; min-width:0; font:inherit; font-size:14px; color:var(--wf-fg); background:var(--wf-panel2);
    border:1.5px solid var(--wf-line); border-radius:7px; padding:10px 13px; outline:none; box-sizing:border-box; }
  .srow input:focus { border-color:var(--wf-green); }
  .addmore { align-self:flex-start; font:inherit; font-weight:600; font-size:12.5px; color:var(--wf-greenfg);
    background:none; border:none; cursor:pointer; padding:2px 0; }
  .pkrow { display:flex; flex-wrap:wrap; gap:7px; margin-top:10px; }
  .pk { display:inline-flex; align-items:center; gap:6px; font:inherit; font-size:12.5px; font-weight:600;
    color:var(--wf-soft); background:var(--wf-panel2); border:1.5px solid var(--wf-line); border-radius:999px; padding:6px 11px; cursor:pointer; }
  .pk:hover { color:var(--wf-fg); border-color:var(--wf-green); }

  /* Members grid. */
  .mtop { display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
  .mtop .intro { margin:0; max-width:54ch; }
  .mcount { font-family:var(--font-mono); font-size:11px; color:var(--wf-mute); white-space:nowrap; }
  .mgrid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:10px; }
  .mcard { display:flex; align-items:center; gap:12px; padding:11px 13px; background:var(--wf-panel2);
    border:1.5px solid var(--wf-line); border-radius:7px; box-sizing:border-box; }
  .mav { width:36px; height:36px; flex:none; border-radius:50%; color:#fff; display:grid; place-items:center;
    font-weight:700; font-size:13px; overflow:hidden; position:relative; }
  .mav img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .mi { flex:1; min-width:0; }
  .mi b { display:block; font-size:13.5px; font-weight:600; color:var(--wf-fg); line-height:1.15; }
  .mi span { display:block; color:var(--wf-mute); font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pager { display:flex; align-items:center; justify-content:space-between; margin-top:13px; }
  .pager button { font:inherit; font-weight:600; font-size:12.5px; color:var(--wf-soft); background:var(--wf-raise);
    border:1.5px solid var(--wf-line); border-radius:7px; padding:7px 14px; cursor:pointer; }
  .pager button[disabled] { opacity:.4; cursor:default; }
  .pager .pg { font-family:var(--font-mono); font-size:11px; color:var(--wf-mute); }
  .note { color:var(--wf-mute); font-size:12.5px; line-height:1.5; margin:0; }

  /* Done state. */
  .donewrap { display:flex; flex-direction:column; align-items:center; text-align:center; gap:14px; padding:24px 12px; }
  .donecheck { width:56px; height:56px; border-radius:50%; background:var(--wf-greendim); color:var(--wf-greenfg);
    display:flex; align-items:center; justify-content:center; font-size:26px; }
  .donewrap h3 { font-family:var(--font-display); font-size:22px; font-weight:600; margin:0; color:var(--wf-fg); }
  .donewrap p { margin:0; font-size:14px; line-height:1.6; color:var(--wf-soft); max-width:44ch; }
  .stats { display:flex; gap:22px; margin-top:4px; }
  .stat { text-align:center; }
  .stat b { display:block; font-family:var(--font-mono); font-weight:700; font-size:20px; color:var(--wf-greenfg); }
  .stat span { display:block; font-family:var(--font-mono); font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--wf-mute); }

  /* Small screens: the rail collapses to a horizontal step strip. */
  @media (max-width: 860px) {
    .wf { flex-direction:column; height:auto; min-height:0; max-height:none; }
    .rail { width:100%; flex-direction:row; align-items:center; gap:10px; padding:12px 14px; border-right:0; border-bottom:1.5px solid var(--wf-line); }
    .brand b, .railhead, .themebtn { display:none; }
    .rsteps { flex-direction:row; overflow-x:auto; gap:4px; }
    .rstep { padding:7px 9px; }
    .rstep .rl span { display:none; }
    .top, .content, .foot { padding-left:18px; padding-right:18px; }
    .content { max-height:60vh; }
  }

  /* SOW-048: the forced-sign-in (login splash) mode + the loading state (token-styled, not the modal). */
  .splashwrap { max-width:680px; margin:0 auto; padding:32px 28px; }
  .head { text-align:center; margin-bottom:22px; }
  .head .ic { display:inline-grid; place-items:center; }
  .head h2 { font-family:var(--font-display); font-size:24px; margin:8px 0 6px; }
  .head p { color:var(--muted); margin:0 auto; max-width:46ch; line-height:1.5; }
  .card { border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin:0 0 14px; background:var(--panel); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); }
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; border:0; border-radius:9px;
    background:var(--brand); color:#fff; text-decoration:none; font:inherit; font-weight:700; font-size:14px; padding:10px 16px; cursor:pointer; }
  .btn:hover { background:var(--brand-dark); color:#fff; }
  .btn.ghost { background:transparent; color:var(--fg-soft); border:1.5px solid var(--line); }
  .btn.ghost:hover { background:var(--hover); color:var(--fg); border-color:var(--line-2); }
  .btn.signin { width:100%; box-sizing:border-box; padding:13px; font-size:15px; }
  .splashwrap .note { color:var(--muted); }
  .splashwrap .note a { color:var(--accent); }
  .codebox { text-align:center; }
  .codebox .sub { color:var(--muted); font-size:13.5px; margin:0 0 8px; }
  .codeval { display:flex; align-items:center; justify-content:center; gap:10px; margin:8px 0 14px; flex-wrap:wrap; }
  .codeval code { font-family:var(--font-mono, monospace); font-size:22px; font-weight:700; letter-spacing:.14em; background:var(--hover); border:1px solid var(--line); border-radius:8px; padding:8px 14px; }
  .codeval .btn { padding:8px 13px; font-size:13px; }
  .loading { color:var(--muted); text-align:center; padding:30px 0; }
`;

class GbtiWelcome extends GbtiElement {
  connectedCallback() {
    super.connectedCallback?.();
    this._page = 1;
    this._step = 0;
    this._done = false;
    this.load();
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    this._stopDiscordPoll();
  }

  // SOW: after the member opens the Discord OAuth tab, poll /discord/link/status (always fresh, fail-closed) until
  // it reports linked, then mark the step done and auto-advance. Bounded (~3 min) so a bailed-out link never spins
  // forever; the step's Continue button stays available as a manual advance the whole time.
  _startDiscordPoll() {
    if (this._discordWaiting) return;
    this._discordWaiting = true;
    this._discordPollUntil = Date.now() + 180000;
    this.render();
    const tick = async () => {
      if (!this._discordWaiting) return; // stopped (manual nav / disconnect)
      let linked = false;
      try { linked = Boolean((await this.client?.discordLinkStatus?.())?.linked); } catch { linked = false; }
      if (!this._discordWaiting || !this.isConnected) return; // a stop() DURING the await must win: no re-arm, no stale mutation
      if (linked) { this._onDiscordLinked(); return; }
      if (Date.now() > this._discordPollUntil) { this._discordWaiting = false; this.render(); return; } // timed out
      this._discordPollTimer = setTimeout(tick, 2500);
    };
    this._discordPollTimer = setTimeout(tick, 2500);
  }

  _onDiscordLinked() {
    this._stopDiscordPoll();
    this._discordJoined = true;
    try { localStorage.setItem(DISCORD_DONE_KEY, '1'); } catch { /* storage blocked */ }
    // Auto-advance off the Discord step to the next to-do.
    if (STEPS[this._step]?.key === 'discord' && this._step < STEPS.length - 1) this._step++;
    this.render();
  }

  _stopDiscordPoll() {
    this._discordWaiting = false;
    if (this._discordPollTimer) { clearTimeout(this._discordPollTimer); this._discordPollTimer = null; }
  }

  async load() {
    // SOW-048: in auth-gate mode this element doubles as the extension's LOGIN SPLASH. Phase + own identity + the
    // authenticated flag all come from the one status read.
    this._authGate = this.hasAttribute('auth-gate');
    let s = null;
    try {
      s = await this.client?.status?.();
      this._membership = s?.membership ?? 'unknown';
      this._couponUntil = s?.couponUntil ?? null; // SOW-119 QA: a live coupon grant reframes the paid banner
      this._own = lc(s?.identity?.username || s?.identity?.login);
    } catch {
      this._membership = 'unknown';
      this._couponUntil = null;
      this._own = '';
    }
    this._authenticated = Boolean(s?.authenticated && (s?.identity?.login || s?.identity?.username));
    // Signed-out + auth-gate: show ONLY the sign-in splash; skip every member fetch (they 403 / are pointless).
    if (this._authGate && !this._authenticated) { this._loaded = true; this.render(); return; }
    // The randomized members list (shuffled ONCE so paging does not churn). Fail gracefully if the site is not
    // deployed yet (the JSON 404s) — show a friendly notice, never crash.
    try {
      const res = await fetch(`${SITE}/members-index.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      this._members = excludeSelf(shuffle(Array.isArray(data?.members) ? data.members : []), this._own);
    } catch {
      this._members = null; // could not load
    }
    // Pre-mark already-followed members. SOW-060: following is a free-tier perk, so this succeeds for any signed-in
    // member; a throw means the read was unavailable (or a banned/unknown account) -> follows = null.
    try {
      const r = await this.client?.getFollows?.();
      const list = Array.isArray(r) ? r : (r?.following ?? []);
      this._follows = new Set(list.map((e) => lc(e?.username)).filter(Boolean));
    } catch {
      this._follows = null; // unavailable -> the follow card shows a retry, not an upgrade notice
    }
    // The done-state stats seed (best-effort): the current followed-topics count.
    try {
      const p = await this.client?.getPrefs?.();
      this._topicsCount = Array.isArray(p?.categories) ? p.categories.length : 0;
    } catch { this._topicsCount = 0; }
    try { this._discordJoined = localStorage.getItem(DISCORD_DONE_KEY) === '1'; } catch { this._discordJoined = false; }
    try {
      const raw = JSON.parse(localStorage.getItem(CHAN_FOLLOWED_KEY) || '[]');
      this._chanFollowed = new Set(Array.isArray(raw) ? raw : []);
    } catch { this._chanFollowed = new Set(); }
    // The socials step's staged draft (survives a mid-flow abandon; consumed by the profile editor).
    try {
      const raw = JSON.parse(localStorage.getItem(SOCIALS_STAGE_KEY) || 'null');
      this._socialDraft = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch { this._socialDraft = {}; }
    // SOW-129 QA (2026-07-20): RECALL the member's SAVED profile socials so a welcome RESET does not clear them.
    // The staged draft (an in-flight edit) always wins; the saved profile fills the rest. Time-boxed + fail-open:
    // a brand-new member with no profile, a slow read, or any error leaves the fields blank and the welcome
    // proceeds. The read matches the profile editor's path (listContent -> getContentItem, frontmatter.links).
    try {
      await Promise.race([
        (async () => {
          const list = await this.client?.listContent?.({ type: 'profile' });
          const path = (list?.items || [])[0]?.path;
          if (!path) return;
          const full = await this.client?.getContentItem?.({ path });
          this._socialDraft = { ...recallProfileSocials(full?.frontmatter?.links, SOCIAL_KEYS), ...this._socialDraft };
        })().catch(() => {}),
        new Promise((r) => setTimeout(r, 6000)),
      ]);
    } catch { /* keep the staged draft (possibly empty) */ }
    this._loaded = true;
    // sow-207 QA: RESUME where the member actually is, rather than reopening at step 1 every time. Computed
    // here because this is the point where every signal has landed. Guarded by _resumed so a second load()
    // (the setClient fan-out can re-run it) never yanks a member out of the step they are reading.
    if (!this._resumed) {
      this._resumed = true;
      this._step = resumeStep(this._stepDone(), STEPS.length);
    }
    this.render();
  }

  /**
   * Per-step "already done", in STEPS order. Each flag reads REAL state rather than a remembered click, so
   * work done outside this wizard counts (see resumeStep).
   *
   * Every unknown resolves to NOT done. `_follows` is null when the read failed and `_topicsCount` is 0 when
   * prefs were unreadable, and in both cases showing the step again is the harmless direction: the member
   * sees a step they may not need, instead of being skipped past one they do.
   */
  _stepDone() {
    const socials = this._socialDraft && Object.values(this._socialDraft).some((v) => String(v ?? '').trim());
    return [
      Boolean(this._discordJoined),          // discord  — the link landed (localStorage, set by the poll)
      (this._chanFollowed?.size ?? 0) > 0,   // subreddit — at least one network channel followed
      Boolean(socials),                      // socials   — a staged or already-saved handle
      (this._follows?.size ?? 0) > 0,        // follow    — following at least one member
      (this._topicsCount ?? 0) > 0,          // topics    — at least one topic in the stored prefs
    ];
  }

  // SOW-048: feed the device-flow user code into the splash (host calls this from the gbti:welcome-signin handler).
  setCode(userCode, verificationUri) {
    this._code = userCode || null;
    if (verificationUri) this._verifyUri = verificationUri;
    this.render();
  }

  // SOW-048: the login splash (signed-out, auth-gate mode). Sign in with GitHub via the device flow; once the host
  // hands back a user code we show it + the github.com/login/device link. Authentication, not payment — a new
  // visitor with a GitHub account can sign in and lands in the normal (membership-gated) app afterward.
  _renderSignedOut() {
    const code = this._code;
    const verify = this._verifyUri || 'https://github.com/login/device';
    const action = code
      ? `<div class="codebox">
           <p class="sub">Enter this code at GitHub to finish signing in:</p>
           <div class="codeval"><code>${esc(code)}</code><button class="btn ghost" data-copy type="button">Copy</button></div>
           <a class="btn" href="${esc(verify)}" target="_blank" rel="noopener">Open github.com/login/device</a>
           <p class="note" style="margin-top:12px">Waiting for you to authorize&hellip;</p>
         </div>`
      : `<button class="btn signin" data-auth-signin type="button">${githubIco} Sign in with GitHub</button>`;
    // SOW: when the host gates BECAUSE the prior session's token expired (not a fresh sign-in), say so, so the
    // member understands why they are back at the splash instead of in their hub.
    const expired = this.hasAttribute('expired')
      ? `<p class="note" style="margin:0 0 12px; color:var(--accent)">Your session expired. Please sign in again to pick up where you left off.</p>`
      : '';
    this.set(this.css(CSS) + `<div class="splashwrap">
      <div class="head">
        <span class="ic">${check}</span>
        <h2>Sign in to GBTI Network</h2>
        <p>The developer co-op. Sign in with your GitHub account to publish articles, products, and prompts, follow members, read the members-only news, and join the community.</p>
      </div>
      <div class="card">
        ${expired}${action}
        <p class="note" style="margin-top:14px">New here? <a href="${SITE}/membership/" target="_blank" rel="noopener">Become a member</a> &mdash; the trial is free.</p>
      </div></div>`);
    this.on('[data-auth-signin]', 'click', () => this.emit('gbti:welcome-signin'));
    this.on('[data-copy]', 'click', () => { try { navigator.clipboard?.writeText(code); } catch { /* clipboard blocked */ } });
  }

  _goto(i) {
    this._stopDiscordPoll();
    this._done = false;
    this._step = Math.min(Math.max(i, 0), STEPS.length - 1);
    this.render();
  }

  _next() {
    this._stopDiscordPoll();
    if (this._step >= STEPS.length - 1) this._done = true;
    else this._step++;
    this.render();
  }

  _back() {
    this._stopDiscordPoll();
    if (this._done) this._done = false;
    else if (this._step > 0) this._step--;
    this.render();
  }

  _railHtml() {
    // sow-207 QA: the rail was PURELY positional (`_step > i`), which resume makes visibly wrong. A member who
    // skipped socials but followed members and picked topics now resumes ON socials, and a positional rail would
    // then show Members and Topics as still to-do, re-asking for work already finished. Mixing in the real
    // per-step flags keeps a check meaning "this is done" rather than "you walked past this".
    const done = this._stepDone();
    const rows = STEPS.map((s, i) => {
      const isDone = this._done || this._step > i || Boolean(done[i]);
      const isActive = !this._done && this._step === i;
      const cls = `rstep${isDone ? ' done' : ''}${isActive ? ' active' : ''}`;
      const mark = isDone ? '&#10003;' : String(i + 1);
      return `<button class="${cls}" data-goto="${i}" type="button">
        <span class="circ">${mark}</span>
        <span class="rl"><b>${esc(s.label)}</b><span>${esc(s.sub)}</span></span>
      </button>`;
    }).join('');
    const dark = (typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme')) !== 'light';
    return `<aside class="rail">
      <span class="brand"><span class="mark">G</span><b>GBTI Network</b></span>
      <span class="railhead">Get set up</span>
      <div class="rsteps">${rows}</div>
      <button class="themebtn" data-theme-flip type="button">${dark ? '&#9728; Light mode' : '&#9790; Dark mode'}</button>
    </aside>`;
  }

  render() {
    if (!this._loaded) { this.set(this.css(CSS) + `<div class="splashwrap"><p class="loading">Setting up your welcome...</p></div>`); return; }
    if (this._authGate && !this._authenticated) { this._renderSignedOut(); return; } // SOW-048 login splash
    const ph = phaseLabel(this._membership, { couponUntil: this._couponUntil });
    const phase = ph.phase === 'coupon' ? 'Free membership period' : ph.phase === 'paid' ? 'Paid membership' : ph.phase === 'trial' ? 'Trial phase' : '';
    this._step = Math.min(Math.max(this._step, 0), STEPS.length - 1);
    const step = STEPS[this._step].key;
    const heading = this._done ? DONE_HEADING : STEPS[this._step].heading;
    const stepText = this._done ? 'COMPLETE' : `STEP ${this._step + 1} OF ${STEPS.length}`;
    const progress = this._done ? 100 : Math.round((this._step / STEPS.length) * 100 + 12);
    const card = this._done ? this._doneCard()
      : step === 'discord' ? this._discordCard()
        : step === 'subreddit' ? this._channelsCard()
          : step === 'socials' ? this._socialsCard()
            : step === 'topics' ? this._topicsCard()
              : this._membersCard();
    const isLast = this._step >= STEPS.length - 1;
    const backOff = this._step === 0 && !this._done;
    const showSkip = !this._done && this._step >= 1 && this._step <= 3;
    const footR = this._done
      ? `<button class="gbtn" data-review type="button">Review steps</button>
         <button class="pbtn" data-done type="button">Go to your profile</button>`
      : `${showSkip ? `<button class="skipbtn" data-step-next type="button">Skip</button>` : ''}
         <button class="pbtn" data-step-next type="button">${isLast ? 'I am all set' : 'Continue &rarr;'}</button>`;
    this.set(this.css(CSS) + `<div class="wf">
      ${this._railHtml()}
      <div class="main">
        <div class="top">
          <div class="eyebrow">Welcome${phase ? `<span class="phasepill">${esc(phase)}</span>` : ''}</div>
          <div class="heads"><h2>${esc(heading)}</h2><span class="stepmono">${esc(stepText)}</span></div>
          ${ph.phase === 'coupon' ? `<p class="couponline">${esc(ph.body)}</p>` : ''}
          <div class="bar"><i style="width:${progress}%"></i></div>
        </div>
        <div class="content"><div class="stepin">${card}</div></div>
        <div class="foot">
          <button class="gbtn${backOff ? ' off' : ''}" data-step-back type="button" ${backOff ? 'disabled' : ''}>&larr; Back</button>
          <div class="footr">${footR}</div>
        </div>
      </div>
    </div>`);

    // Navigation: the rail jumps anywhere (every step is skippable); the footer walks linearly.
    this.$$('[data-goto]').forEach((b) => b.addEventListener('click', () => this._goto(Number(b.dataset.goto))));
    this.$$('[data-step-next]').forEach((b) => b.addEventListener('click', () => this._next()));
    this.on('[data-step-back]', 'click', () => this._back());
    this.on('[data-review]', 'click', () => this._goto(0));
    this.on('[data-done]', 'click', () => this.emit('gbti:welcome-done'));
    // The rail theme flip mirrors the shell's toggle (persisted key + the documentElement stamp).
    this.on('[data-theme-flip]', 'click', () => {
      const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('gbti-theme', next); } catch { /* private mode */ }
      this.render();
    });

    if (this._done) return;
    if (step === 'discord') {
      // SOW: "Connect Discord account" opens the token-bound OAuth link in a new tab (joins the guild, assigns the
      // role, links discord_user_id, then redirects the member INTO Discord). We then poll /discord/link/status and
      // auto-advance to the next step the moment the link lands, so there is nothing else to click.
      this.on('[data-discord-connect]', 'click', async () => {
        let url = DISCORD_LINK_URL;
        try { const r = await this.client?.discordLinkUrl?.(); if (r && r.url) url = r.url; } catch { /* fall back to the static link */ }
        window.open(url, '_blank', 'noopener');
        this._startDiscordPoll();
      });
    } else if (step === 'subreddit') {
      // A channel card's Follow opens the property in a new tab and marks the card followed (local memory,
      // best-effort: none of these platforms report a follow back to us).
      this.$$('[data-chan-open]').forEach((b) => b.addEventListener('click', () => {
        const key = b.dataset.chanOpen;
        const chan = GBTI_CHANNELS.find(([k]) => k === key);
        if (!chan) return;
        window.open(chan[2], '_blank', 'noopener');
        this._chanFollowed.add(key);
        try { localStorage.setItem(CHAN_FOLLOWED_KEY, JSON.stringify([...this._chanFollowed])); } catch { /* private mode */ }
        this.render();
      }));
    } else if (step === 'socials') {
      // Persist on input, no re-render (a re-render would steal focus mid-typing). Empty clears the key.
      this.$$('[data-social-key]').forEach((inp) => inp.addEventListener('input', () => {
        const k = inp.dataset.socialKey;
        if (inp.value.trim()) this._socialDraft[k] = inp.value; else delete this._socialDraft[k];
        try { localStorage.setItem(SOCIALS_STAGE_KEY, JSON.stringify(this._socialDraft)); } catch { /* private mode */ }
      }));
      this.on('[data-social-more]', 'click', () => { this._socialsMore = !this._socialsMore; this.render(); });
      this.$$('[data-social-add]').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.socialAdd;
        if (!(k in this._socialDraft)) this._socialDraft[k] = '';
        this._socialsMore = false;
        this.render();
        this.$(`[data-social-key="${k}"]`)?.focus();
      }));
    } else if (step === 'topics') {
      // Track the picked count for the done-state stats (the picker self-persists via setPrefs).
      this.$('gbti-topic-picker')?.addEventListener('topics-change', (e) => {
        this._topicsCount = Array.isArray(e.detail?.topics) ? e.detail.topics.length : this._topicsCount;
      });
    } else {
      // Follow toggles + paging (the pager's Back/More is within the list, distinct from the step Back).
      this.$$('[data-follow]').forEach((b) => b.addEventListener('click', () => this._toggleFollow(b.getAttribute('data-follow'))));
      this.on('[data-prev]', 'click', () => { this._page--; this.render(); });
      this.on('[data-next]', 'click', () => { this._page++; this.render(); });
      // Avatar fallback: drop a broken image so the letter disc shows through.
      this.$$('.mav img').forEach((img) => img.addEventListener('error', () => img.remove(), { once: true }));
    }
  }

  _discordCard() {
    const joined = this._discordJoined;
    const btn = joined
      ? `<button class="dbtn on" type="button" disabled>&#10003; Discord connected</button>`
      : this._discordWaiting
        ? `<button class="dbtn" data-discord-connect type="button" disabled>Waiting for Discord&hellip;</button>`
        : `<button class="dbtn" data-discord-connect type="button">Connect Discord account</button>`;
    const callout = joined
      ? `<div class="callout"><span class="gl">&#8250;</span><span>Your Discord is connected and you have the member role in the server.</span></div>`
      : `<div class="callout"><span class="gl">&#8250;</span><span>A new tab opens for Discord sign-in. When you finish, you land in the server and this step continues automatically.</span></div>`;
    return `
      <div class="dhead">
        <span class="ico-tile">${discordIco}</span>
        <div><h3>Connect Discord</h3><p>The heartbeat of the co-op</p></div>
      </div>
      <p class="intro" style="max-width:58ch">Announcements and agile discussions frequently occur here, and it is the best place to network in real time with network members. Connect Discord to join the server and claim your member role.</p>
      ${btn}
      ${callout}`;
  }

  // The Follow GBTI channels grid (the design handoff's platform cards). Follow opens the channel in a new
  // tab and flips the card to a followed state (local memory).
  _channelsCard() {
    const cards = GBTI_CHANNELS.map(([k, label, , blurb, handle]) => {
      const on = this._chanFollowed?.has(k);
      return `<div class="pcard">
        <div class="ph">
          <span class="ico-tile">${socialIcon(k, 19)}</span>
          <div class="pn"><b>${esc(label)}</b><span>${esc(handle)}</span></div>
        </div>
        <div class="pd">${esc(blurb)}</div>
        <button class="sbtn${on ? ' on' : ''}" data-chan-open="${esc(k)}" type="button">${on ? '&#10003; Following' : 'Follow'}</button>
      </div>`;
    }).join('');
    return `
      <p class="intro">Please follow the network's channels to help member content travel. We syndicate everyone's articles, prompts, and products through these, including yours. Following these channels will help build the network's reach.</p>
      <div class="grid">${cards}</div>`;
  }

  // The socials step: collect the member's handles across the platform set. Raw values stage locally
  // (SOCIALS_STAGE_KEY) and the profile editor consumes them into profile.md on the profile page, so the
  // one real save happens through the normal publish pipeline. Fully skippable.
  _socialsCard() {
    const draft = this._socialDraft || {};
    const visible = [...new Set([...SOCIAL_STARTERS, ...Object.keys(draft)])]
      .filter((k) => SOCIAL_KEYS.includes(k) && !SOCIAL_HIDDEN.has(k));
    const rows = visible.map((k) => `<div class="srow">
      <span class="ico-tile" aria-hidden="true">${socialIcon(k, 19)}</span>
      <input type="text" data-social-key="${esc(k)}" value="${esc(draft[k] || '')}"
        placeholder="${esc(SOCIAL_LABELS[k] || k)}: @handle or full URL" aria-label="${esc(SOCIAL_LABELS[k] || k)}" />
    </div>`).join('');
    const rest = SOCIAL_KEYS.filter((k) => !visible.includes(k) && !SOCIAL_HIDDEN.has(k));
    const picker = this._socialsMore && rest.length
      ? `<div class="pkrow">${rest.map((k) => `<button type="button" class="pk" data-social-add="${esc(k)}">${socialIcon(k, 14)}${esc(SOCIAL_LABELS[k] || k)}</button>`).join('')}</div>`
      : '';
    const more = rest.length ? `<button type="button" class="addmore" data-social-more>${this._socialsMore ? 'Close' : '+ More platforms'}</button>` : '';
    return `
      <p class="intro">Tell us where else you publish. When your work syndicates to a GBTI channel, the handle you list is mentioned automatically, pointing readers back to you. You review and save these on your profile at the end.</p>
      ${rows}
      ${more}
      ${picker}`;
  }

  // SOW-054: the Topics step. The shared <gbti-topic-picker> fetches the vocabulary + the member's current
  // selection and self-persists each toggle via setPrefs; the step is skippable (an empty selection = the feed
  // and news show everything, the current default).
  _topicsCard() {
    return `
      <p class="intro">We have started you off with a few popular topics. Add the others you care about, or remove any you do not. Your activity feed and news default to them, and you can change this any time in Settings.</p>
      <gbti-topic-picker seed-defaults></gbti-topic-picker>`;
  }

  _membersCard() {
    const intro = `<p class="intro">Following a member alerts you when they publish new articles, prompts, and products in your feed.</p>`;
    // SOW-060: following is a FREE perk for any signed-in member, so there is no paywall state here. A null follow
    // list means a transient read failure (or a stale/missing KV overrides mirror for a since-banned account), not
    // a membership gate, so show a retry, never an upgrade prompt.
    if (this._follows === null) {
      return `${intro}<p class="note">We could not load your follow list right now. This is a temporary problem on our side. Try again shortly, or follow members any time from a member profile.</p>`;
    }
    if (!this._members) {
      return `${intro}<p class="note">We could not load the member directory right now. You can follow members any time from a member profile.</p>`;
    }
    if (this._members.length === 0) {
      return `${intro}<p class="note">No members to show yet. Check back as the co-op grows.</p>`;
    }
    const { page, pages, items } = paginate(this._members, this._page, PAGE_SIZE);
    this._page = page; // clamp
    const cards = items.map((m) => this._memberCard(m)).join('');
    const pager = pages > 1
      ? `<div class="pager"><button data-prev type="button" ${page <= 1 ? 'disabled' : ''}>Back</button>
         <span class="pg">Page ${page} of ${pages}</span>
         <button data-next type="button" ${page >= pages ? 'disabled' : ''}>More</button></div>`
      : '';
    const count = this._follows?.size ?? 0;
    return `
      <div class="mtop">${intro}<span class="mcount">${count} following</span></div>
      <div class="mgrid">${cards}</div>
      ${pager}`;
  }

  _memberCard(m) {
    const u = lc(m.username);
    const followed = this._follows.has(u);
    const name = m.displayName || m.username || '?';
    const initial = esc(String(name).trim().charAt(0).toUpperCase());
    const av = `<span class="mav" style="background:${avColor(name)}">${initial}${m.avatar ? `<img src="${esc(m.avatar)}" alt="" />` : ''}</span>`;
    const sub = m.headline ? `<span>${esc(m.headline)}</span>` : '';
    return `<div class="mcard">
      ${av}
      <span class="mi"><b>${esc(name)}</b>${sub}</span>
      <button class="sbtn${followed ? ' on' : ''}" data-follow="${esc(u)}" type="button">${followed ? '&#10003; Following' : 'Follow'}</button>
    </div>`;
  }

  _doneCard() {
    const follows = this._follows?.size ?? 0;
    const topics = this._topicsCount ?? 0;
    return `<div class="donewrap">
      <span class="donecheck">&#10003;</span>
      <h3>${esc(DONE_HEADING)}</h3>
      <p>Welcome to the co-op. Your channels are followed, your handles are saved, and your feed is tuned. Time to publish.</p>
      <div class="stats">
        <div class="stat"><b>${follows}</b><span>Following</span></div>
        <div class="stat"><b>${topics}</b><span>Topics</span></div>
      </div>
    </div>`;
  }

  /**
   * Repaint ONLY what a follow toggle changes: each Follow button's state and the "N following" count.
   *
   * This exists because `render()` calls `this.set(...)`, which replaces the whole component's markup. Using
   * it for a follow toggle tore down and rebuilt the entire wizard TWICE per click (once optimistically, once
   * on the network response), which read as the panel flashing and reloading under the cursor, and threw away
   * scroll position mid-list. <gbti-topic-picker> already learned this and re-renders its chips in place for
   * the same reason; this is that pattern applied to the members grid.
   *
   * Deriving every button from `this._follows` rather than touching just the clicked one is deliberate: the
   * response REPLACES the whole set, so a follow made in another tab shows up here too.
   */
  _refreshFollowUi() {
    const count = this.$('.mcount');
    if (count) count.textContent = `${this._follows?.size ?? 0} following`;
    this.$$('[data-follow]').forEach((b) => {
      const on = this._follows?.has(lc(b.getAttribute('data-follow'))) ?? false;
      b.classList.toggle('on', on);
      b.innerHTML = on ? '&#10003; Following' : 'Follow'; // static markup, mirrors _memberCard exactly
    });
  }

  async _toggleFollow(username) {
    const u = lc(username);
    if (!u || !this._follows) return;
    const was = this._follows.has(u);
    was ? this._follows.delete(u) : this._follows.add(u); // optimistic
    this._refreshFollowUi();
    try {
      const r = await this.client.setFollow({ username: u, on: !was });
      const list = Array.isArray(r) ? r : (r?.following ?? null);
      if (list) this._follows = new Set(list.map((e) => lc(e?.username)).filter(Boolean));
    } catch {
      was ? this._follows.add(u) : this._follows.delete(u); // revert
    }
    this._refreshFollowUi();
  }
}

define('gbti-welcome', GbtiWelcome);
export { GbtiWelcome };
