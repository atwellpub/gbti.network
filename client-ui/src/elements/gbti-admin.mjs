// <gbti-admin> (SOW-006 v2): role-gated moderation/admin tools. The visible actions follow the signed-in
// role (moderator -> deplatform/remove; admin -> ban/grandfather; superadmin -> roles). UX gating only: every
// action opens a house/content PR and the SOW-005 gate + CODEOWNERS are the real boundary.
// SOW-070: redesigned into grouped, labeled sub-sections styled to sit inside the admin.html "Actions" card
// (settings aesthetic: titled groups, rounded fields, primary/neutral/danger buttons). No outer .panel (the page
// card is the container). render() reads the role fresh each time, so it self-heals the client-ready race.

import { GbtiElement, define, esc } from '../base.mjs';

const RANK = { member: 0, moderator: 1, admin: 2, superadmin: 3 };

const CHEVRON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2384818c' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E";

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .rolebar { display:flex; align-items:center; gap:8px; margin:0 0 2px; }
  .rolebar .lbl { font-size:13px; color:var(--muted); }
  .badge { font-family:var(--font-mono, monospace); font-size:10.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; border-radius:999px; padding:3px 9px; background:var(--green-tint, #e9f6ef); color:var(--green-700, #0f6f40); border:1.5px solid var(--green-tint-2, rgba(31,158,95,.22)); }
  .grp { padding:18px 0; border-top:1px solid var(--line); }
  .grp:first-of-type { border-top:0; padding-top:8px; }
  .grp h4 { margin:0 0 3px; font-size:15px; font-weight:600; }
  .grp .desc { margin:0 0 12px; color:var(--muted); font-size:13px; line-height:1.45; max-width:64ch; }
  .fld { display:block; width:100%; box-sizing:border-box; font:inherit; font-size:14px; padding:10px 13px; border:1.5px solid var(--line); border-radius:10px; background:var(--bg, var(--panel)); color:var(--fg); margin:0 0 8px; }
  .fld::placeholder { color:var(--muted); }
  .fld:focus-visible { outline:2px solid var(--brand); outline-offset:1px; border-color:var(--brand); }
  select.fld { appearance:none; -webkit-appearance:none; cursor:pointer; padding-right:38px; background-image:url("${CHEVRON}"); background-repeat:no-repeat; background-position:right 12px center; }
  .btns { display:flex; gap:8px; flex-wrap:wrap; margin-top:4px; }
  .btn { font:inherit; font-weight:600; font-size:13.5px; padding:9px 15px; border:1.5px solid var(--line); border-radius:10px; background:var(--panel); color:var(--fg); cursor:pointer; white-space:nowrap; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
  .btn.primary { background:var(--brand); border-color:var(--brand); color:#fff; }
  .btn.primary:hover { filter:brightness(1.06); color:#fff; }
  .btn.danger { border-color:#e0a39d; color:#b3261e; }
  :host-context([data-theme="dark"]) .btn.danger { border-color:rgba(243,147,139,.5); color:#f3938b; }
  .btn.danger:hover { background:#b3261e; border-color:#b3261e; color:#fff; }
  .role-row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
  .role-row .fld { margin:0; flex:1; min-width:150px; }
  .role-row select.fld { flex:0 0 auto; min-width:150px; }
  .out { margin-top:14px; font-size:13px; min-height:18px; }
  .out.danger { color:#b3261e; }
  :host-context([data-theme="dark"]) .out.danger { color:#f3938b; }
  .out a { color:var(--accent); font-weight:600; }
  .tag { font-family:var(--font-mono, monospace); font-size:10.5px; font-weight:700; border-radius:999px; padding:2px 8px; background:var(--hover); color:var(--fg); }
  .tag.ok { background:var(--green-tint, #e9f6ef); color:var(--green-700, #0f6f40); }
  .nudge { color:var(--muted); font-size:14px; }
`;

class GbtiAdmin extends GbtiElement {
  async render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="nudge">Open in the GBTI client to use the admin actions.</p>`); return; }
    let role = 'member';
    try {
      role = (await this.client.status())?.role ?? 'member';
    } catch {
      /* ignore */
    }
    const rank = RANK[role] ?? 0;
    if (rank < RANK.moderator) {
      this.set(this.css(CSS) + `<p class="nudge">Admin actions are available to moderators and above.</p>`);
      return;
    }
    // sow-161: an optional `caps` attribute limits which mutation GROUPS render, so a host that has only
    // cookie-enabled SOME of the server-side admin mutations (the website, increment by increment) shows only
    // those. Absent attribute -> all groups (the extension/npm host, unchanged). Read from the attribute (not a
    // property) so it survives custom-element upgrade with no race. Groups: 'moderation', 'membership', 'roles'.
    const caps = this.hasAttribute('caps') ? this.getAttribute('caps').split(',').map((s) => s.trim()).filter(Boolean) : null;
    const capOn = (g) => !caps || caps.includes(g);
    this.set(
      this.css(CSS) +
        `<div class="rolebar"><span class="lbl">Acting as</span><span class="badge">${esc(role)}</span></div>

         <div class="grp">
           <h4>Content moderation</h4>
           <p class="desc">Deplatform sets a published item to draft, republish reverses it, and remove takes it down. Paste the content path.</p>
           <input class="fld" id="cpath" placeholder="members/&lt;user&gt;/posts/&lt;slug&gt;/index.md" />
           <div class="btns">
             <button class="btn" id="deplatform" type="button">Deplatform (draft)</button>
             <button class="btn" id="republish" type="button">Republish</button>
             <button class="btn danger" id="remove" type="button">Remove</button>
           </div>
         </div>

         ${rank >= RANK.admin && capOn('membership') ? `<div class="grp">
           <h4>Member status</h4>
           <p class="desc">Ban deplatforms a member regardless of payment; grandfather grants permanent paid access with no Stripe subscription. Keyed by the immutable github_id.</p>
           <input class="fld" id="gid" placeholder="github_id" />
           <input class="fld" id="reason" placeholder="Reason (optional)" />
           <div class="btns">
             <button class="btn danger" id="ban" type="button">Ban</button>
             <button class="btn" id="unban" type="button">Unban</button>
             <button class="btn" id="grandfather" type="button">Grandfather</button>
             <button class="btn" id="ungrandfather" type="button">Ungrandfather</button>
           </div>
         </div>` : ''}

         ${rank >= RANK.superadmin && capOn('roles') ? `<div class="grp">
           <h4>Role assignment</h4>
           <p class="desc">Set a member's role. Superadmin owns roles.yml and the root of trust, so assign it carefully.</p>
           <div class="role-row">
             <input class="fld" id="rid" placeholder="github_id" />
             <select class="fld" id="role"><option>member</option><option>moderator</option><option>admin</option><option>superadmin</option></select>
             <button class="btn primary" id="setrole" type="button">Set role</button>
           </div>
         </div>` : ''}

         <div id="out" class="out muted" aria-live="polite"></div>`,
    );

    const run = (action, args) => async () => {
      this.out('Working&hellip;');
      try {
        const res = await this.client.admin(action, args());
        // SOW-038 P4: a governance action is idempotent — already-in-that-state returns changed:false (no PR).
        if (res?.changed === false || res?.noop) this.out(`<span class="tag ok">No change</span> ${esc(res.message || 'already in that state')}`);
        else this.out(`<span class="tag ok">PR opened</span> <a href="${esc(res.prUrl)}" target="_blank" rel="noopener">#${esc(res.prNumber)}</a>`);
      } catch (err) {
        this.out(esc(err.message), 'danger');
      }
    };
    const cpath = () => ({ path: this.$('#cpath').value.trim() });
    const gid = () => ({ githubId: this.$('#gid').value.trim(), reason: this.$('#reason').value.trim() || undefined });

    this.on('#deplatform', 'click', run('deplatform', cpath));
    this.on('#republish', 'click', run('republish', cpath)); // SOW-071: the inverse of deplatform (un-hide)
    this.on('#remove', 'click', run('remove', cpath));
    if (rank >= RANK.admin && capOn('membership')) {
      this.on('#ban', 'click', run('ban', gid));
      this.on('#unban', 'click', run('unban', () => ({ githubId: this.$('#gid').value.trim() })));
      this.on('#grandfather', 'click', run('grandfather', gid));
      this.on('#ungrandfather', 'click', run('ungrandfather', () => ({ githubId: this.$('#gid').value.trim() })));
    }
    if (rank >= RANK.superadmin && capOn('roles')) {
      this.on('#setrole', 'click', run('role', () => ({ githubId: this.$('#rid').value.trim(), role: this.$('#role').value })));
    }
  }

  out(html, cls = 'muted') {
    const o = this.$('#out');
    if (o) {
      o.className = `out ${cls}`;
      o.innerHTML = html;
    }
  }
}

define('gbti-admin', GbtiAdmin);
export { GbtiAdmin };
