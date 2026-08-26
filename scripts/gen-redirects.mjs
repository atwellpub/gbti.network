#!/usr/bin/env node
// Emit a Cloudflare Pages `public/_redirects` from .data/legacy/redirect-map.csv (flattened legacy post paths
// + /author/* -> /members/*), VISIBILITY-AWARE (SOW-016). A legacy URL whose destination content is no longer
// a public page (members-only with no stub = Mode A, a draft, or a removed slug) must NOT 301 to a 404, which
// would lose the SEO equity and serve a broken redirect. Such a destination is retargeted to /membership/ (a
// real page that explains the content is members-only). Run after migration and after any visibility change;
// the file is copied verbatim into the build output.
//   node scripts/gen-redirects.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

// Build the set of /<seg>/<slug>/ paths that WILL be public pages: published AND (public OR a Mode B stub).
const SEG = { posts: 'articles', products: 'products', prompts: 'prompts' };
const field = (txt, k) => {
  const m = new RegExp('^' + k + ':\\s*"?([^"\\n]+?)"?\\s*$', 'm').exec(txt);
  return m ? m[1].trim() : null;
};
const publicPaths = new Set();
function scan(baseDir) {
  for (const [sub, seg] of Object.entries(SEG)) {
    const dir = path.join(baseDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const slugDir of fs.readdirSync(dir)) {
      const idx = path.join(dir, slugDir, 'index.md');
      if (!fs.existsSync(idx)) continue;
      const txt = fs.readFileSync(idx, 'utf8');
      const status = field(txt, 'status') ?? 'draft';
      const visibility = field(txt, 'visibility') ?? 'public';
      const publicStub = /^true$/i.test(String(field(txt, 'publicStub') ?? ''));
      const slug = field(txt, 'slug') ?? slugDir;
      if (status === 'published' && (visibility === 'public' || publicStub)) publicPaths.add(`/${seg}/${slug}/`);
    }
  }
}
scan(path.join(ROOT, 'house'));
const membersDir = path.join(ROOT, 'members');
const memberPaths = new Set(); // /members/<username>/ for each published+public profile (a real public page)
if (fs.existsSync(membersDir)) {
  for (const u of fs.readdirSync(membersDir)) {
    const b = path.join(membersDir, u);
    try {
      if (!fs.statSync(b).isDirectory()) continue;
    } catch { continue; }
    scan(b);
    // A member-profile redirect target (/author/* -> /members/<u>/) must point at a profile that actually
    // builds. Add it to the resolved set only if the profile is published + public.
    const prof = path.join(b, 'profile.md');
    if (fs.existsSync(prof)) {
      const txt = fs.readFileSync(prof, 'utf8');
      const status = field(txt, 'status') ?? 'draft';
      const visibility = field(txt, 'visibility') ?? 'public';
      const username = field(txt, 'username') ?? u;
      if (status === 'published' && visibility === 'public') memberPaths.add(`/members/${username}/`);
    }
  }
}

const CONTENT_DEST = /^\/(articles|products|prompts)\/[^/]+\/$/;
const MEMBER_DEST = /^\/members\/[^/]+\/$/;
const MEMBERS_INDEX = '/members/';
const MEMBERSHIP = '/membership/';
const csv = fs.readFileSync(path.join(ROOT, '.data/legacy/redirect-map.csv'), 'utf8').trim().split('\n').slice(1);

const lines = [
  '# Generated from .data/legacy/redirect-map.csv by scripts/gen-redirects.mjs (visibility-aware, SOW-016).',
  '# Cloudflare Pages _redirects: <source> <destination> <status>. Do not edit by hand; re-run the generator.',
];
let n = 0;
const retargeted = [];
for (const row of csv) {
  const [oldPath, newPathRaw, code] = row.split(',');
  if (!oldPath || !newPathRaw) continue;
  let newPath = newPathRaw;
  // A content destination that is no longer a public page (Mode A / draft / removed) must not 301 to a 404.
  if (CONTENT_DEST.test(newPath) && !publicPaths.has(newPath)) {
    retargeted.push(`${newPath} -> ${MEMBERSHIP}`);
    newPath = MEMBERSHIP;
  } else if (MEMBER_DEST.test(newPath) && !memberPaths.has(newPath)) {
    // A member-profile destination that no longer resolves (a renamed/removed member, a draft profile) falls
    // back to the members directory rather than 301-ing to a 404.
    retargeted.push(`${newPath} -> ${MEMBERS_INDEX}`);
    newPath = MEMBERS_INDEX;
  }
  lines.push(`${oldPath} ${newPath} ${code || 301}`);
  n++;
}

// Non-legacy redirects (site reclassifications, not from the legacy CSV). SOW-022: the two GBTI tools moved
// from the `product` collection to the `applet` collection, so their old /products/<slug>/ detail URLs now
// 301 to the running tool at /utilities/<slug>/ (which is also each applet card's launchUrl).
const EXTRA = [
  // sow-230: /linkedin-invite/ is RETIRED into /member-invite/. It shipped 2026-08-15 with benefit prose
  // inherited from the Creator page it was copied from, so a member-tier invite advertised publishing,
  // syndication, a creator profile, weekly shop talk and the first-touch revenue program, none of which a
  // Member gets. Redirected rather than deleted because the link was created to be SENT to a specific
  // person: a 404 is the worst outcome for anyone already holding it, and leaving it up was not an option
  // while it made claims the tier does not support. The replacement is audience-neutral, so there is
  // nothing LinkedIn-specific to preserve at the old path.
  ['/linkedin-invite/', '/member-invite/'],

  ['/products/js-animate-hue/', '/utilities/js-animate-hue/'],
  ['/products/email-signature-generator/', '/utilities/email-signature-generator/'],

  // Outbound partner links. The WordPress site cloaked its affiliate links behind /outbound/ and
  // /outsourcing/ paths served by the Redirection plugin. The content migrated and the redirect rules did
  // not, so seven links across five published posts have been returning 404 ever since, on both bylines,
  // earning nothing. `check-redirects` never caught it because a path that exists in no config has no
  // destination to fail on.
  //
  // Each path was first restored to the destination its own legacy rule carried, recovered from
  // .data/legacy/db (wp_redirection_items). The dump had two enabled Codeable codes, so the paths were
  // restored on the codes they each carried rather than guessed onto one account (sow-119). The owner has
  // since consolidated: every Codeable path below now points at the single live code, MzT91, and the other
  // legacy code is retired (sow-257, owner decision 2026-08-18).
  ['/outbound/codeable', 'https://codeable.io/?ref=MzT91'],
  ['/outbound/codeable/wordpress-services', 'https://app.codeable.io/tasks/new?ref=MzT91'],
  ['/codeable/naresh-devineni', 'https://www.codeable.io/developers/naresh-devineni/?ref=MzT91'],
  // BugHerd carries four "Learn more about BugHerd" banner links across two published posts, all pointing at
  // this one path, so every click funnels through here.
  //
  // THE COMMENT THAT STOOD HERE UNTIL 2026-08-25 WAS WRONG, AND IT COST REAL REFERRALS. It said the legacy
  // target https://partners.bugherd.com/gbti-network "is DEAD AT THE VENDOR: that URL 404s and so does the
  // bare partners.bugherd.com root", and on that basis the path was pointed at the bare product page, which
  // credits nobody. Measured 2026-08-25: that URL answers **302** into PartnerStack carrying our partner key
  // (ps_partner_key / gspk), and only the bare SUBDOMAIN ROOT 404s, which is ordinary for a PartnerStack
  // subdomain with no index page. Checking the root and generalising from it to the path is what produced
  // the false conclusion. The claim also parked sow-257 in staging as blocked on a dead vendor.
  //
  // It was not a dormant link either, which is why this was worth correcting rather than deleting. Zone
  // analytics for the seven days to 2026-08-25 record 59 requests to /outbound/bugherd, against 952 to the
  // anime-prompts post and 152 to the react-templates post. A third to a half of those 59 carry an
  // identifiable browser (Chrome and Chrome Mobile from ID, US and IN); the rest report an unknown agent and
  // are likelier to be crawlers. So on the order of 20 to 30 human clicks a month were reaching BugHerd
  // uncredited for as long as the destination was wrong.
  ['/outbound/bugherd', 'https://partners.bugherd.com/gbti-network'],
  ['/codeable', 'https://codeable.io/?ref=MzT91'],
  ['/outsourcing/codeable', 'https://codeable.io/?ref=MzT91'],
  ['/outsource/codeable/wp-cli', 'https://www.codeable.io/developers/wp-cli/?ref=MzT91'],
  // Linked live from members/atwellpub/posts/how-to-use-wp-cli-staging-to-import-a-remote-database. It
  // matches no legacy rule exactly: the dump has /outsourcing/codeable and /outsource/codeable/wp-cli,
  // and this link is a hybrid of the two, so it was probably broken on WordPress as well. Pointed at the
  // WP-CLI developers page its sibling rule used, on the consolidated MzT91 code like the rest.
  ['/outsourcing/codeable/wp-cli', 'https://www.codeable.io/developers/wp-cli/?ref=MzT91'],
];
for (const [oldPath, newPath] of EXTRA) { lines.push(`${oldPath} ${newPath} 301`); n++; }

// The blog section was renamed to /articles/ (one canonical path). Catch any remaining /blog/<slug>/ link
// (including ones inside older post bodies) with a splat so it lands on the live /articles/ page. This MUST
// come after the specific legacy rows above so a slug that was also renamed (e.g. the snapshots-for-ai post)
// keeps its exact destination instead of being swept to a same-slug /articles/ 404. The splat destination is
// skipped by check-redirects (it carries a `:` placeholder), so it never fails the build guard.
lines.push('/blog/* /articles/:splat 301');
n++;

fs.mkdirSync(path.join(ROOT, 'public'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'public/_redirects'), lines.join('\n') + '\n');
console.log(`Wrote public/_redirects with ${n} redirects.`);
if (retargeted.length) {
  console.log(`Retargeted ${retargeted.length} redirect(s) whose destination is not a public page (to ${MEMBERSHIP}):`);
  for (const r of retargeted) console.log('  - ' + r);
}
