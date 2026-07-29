# GBTI Network

**A developer co-op, powered by git.** GBTI Network is a membership community where developers publish
their work, learn together, and share in what the community builds. The public side is a fast static
site: a blog, a product directory, a prompt library, and member profiles. The engine behind it is simple
to state: this git repository is the database, and members author everything they publish as pull
requests, by hand or through their own AI agents.

This README is the master document for the project. It describes what GBTI Network is, how membership
and revenue work, and how the whole system is built.

---

## What this is

GBTI Network is a co-op for developers. The heart of it is the community: a private Discord, weekly
coaching and build sessions, and a group of people shipping real things together. The public website is
the shop window: it is where members put their name, their writing, their products, and their prompts in
front of the world.

Three ideas hold it together:

1. **The community is the product.** You join for the people, the sessions, and the shared momentum. A
   90-day trial, with no card, exists so you can evaluate that before you pay.
2. **Paid membership unlocks your public presence.** Once you are a paid member, your profile, blog
   posts, products, and prompts go live on gbti.network under your own name.
3. **The repo is the database.** Every piece of content lives as a file in a public git repository.
   Members publish by opening a pull request. There is no traditional CMS and no server to run, so the
   whole site costs close to nothing to operate, which is what lets the membership fund the co-op
   instead of the hosting bill.

## Who it is for

Working developers who want a place to publish, a community to build with, and a share in the upside.
The bar to read and browse is zero; the bar to publish is membership. Members range from people shipping
WordPress plugins and IDE extensions to people writing about AI, sharing prompts, and building Minecraft
mods.

## How membership works

| | Visitor | Trial (up to 90 days, no card) | Paid ($150 / year) |
|---|---|---|---|
| Browse the public site | yes | yes | yes |
| Discord + weekly sessions | no | read-only trial access | full access |
| Author content (write, edit, stage on your fork) | no | yes | yes |
| Profile, blog, products, prompts go live | no | stage now, publish when you pay | yes |

The trial is a real evaluation of the community. Paying turns on your public presence: your member
profile, your blog posts, your products in the directory, and your prompts in the library all publish
under your name. Membership is a single annual tier at $150 per year, billed through Stripe.

Publishing is paid-only. A trial member authors freely, and their drafts live on their own fork until
they pay; nothing reaches the canonical repo during the trial. A content pull request from anyone who is
not a paid member (a visitor, a lapsed account, or a trial member) is rejected by the gate and closed
with a sign-up or upgrade nudge that reassures a trial member their work is safe on their fork. There is
no trial publishing carve-out: paying is what turns on your public presence, and your client publishes
your staged drafts the moment you upgrade.

## A syndication network

GBTI Network is a syndication network. Every published **article, product directory listing, and AI
prompt** is a content landing location, and member work is pushed out across the network properties so
it reaches far more people than any single member's following. More reach means more readers landing on
your content, which is what the revenue model below rewards.

The network's syndication surfaces:

- **gbti.network** itself (the blog, the product directory, the prompt library, member profiles)
- The **GBTI Discord** community
- **GitHub** (the `gbti-network` organization)
- **YouTube**
- **X**, **Bluesky**, **LinkedIn**, **Reddit**, and **Dev.to**

## Share in the revenue

Your work earns, for life. When a reader first lands on your **article, product, or AI prompt** and then
joins GBTI Network, you earn **30 percent of their membership revenue, for the lifetime of their
membership** (first-touch attribution, paid while both of you stay active members). Publishing strong
content and prompts that convert readers is the most direct way to earn on the network.

You keep **at least 90 percent of that 30 percent by default**, and you can choose to share up to 10
percent of it with the people who help you:

- **Contributors**: delegate up to **7 percent of your 30 percent** to the people who improved your
  content. Contributions earn points (one accepted contribution is worth seven points, which claims the
  full 7 percent pool), and the pool is split across those points, so more accepted contributions spread
  it more evenly.
- **Commenters**: up to **3 percent of your 30 percent** rewards the people whose comments add to your
  content, by the same rule (the first ten comments, no more than ninety days old, are eligible).

Delegation is optional and set per piece of content. With no delegation you keep the full 30 percent.
Everything is derived from Stripe and recorded in git, then paid out through Stripe Connect after a
90-day settlement hold. Payouts settle one invoice at a time, all recipients together or none, so an
overlapping run can never double-pay and a late-onboarding contributor never costs anyone their share.
The full model will live on the **Learn more about our model** page on the site.

## What members can do

- **Publish articles** under your own name.
- **List your work**: promote your products, plugins, and tools in the directory.
- **Participate in a community**: a private Discord and weekly meetings with other builders.
- **Grow as a professional**: a public profile, real feedback, and accountability with peers.
- **Generate and share in platform revenue**: earn from the members your work brings in.

## What membership includes

- **Publish under your name** at gbti.network: your profile, blog posts, products, and AI prompts.
- **Members-only posts and products** for content you want to keep inside the community (excluded from
  the public site and surfaced in your member client).
- **A members AI prompt directory**: a growing, reusable library with copy-to-clipboard.
- **A private Discord community** of working developers.
- **Weekly two-hour meetings** where members share what they are building and set accountability goals
  with each other.
- **Your own authoring client**: edit your content in place on the live site through a browser
  extension, or run a local CMS and AI-agent server, both of which publish through the same pull-request
  flow.
- **Revenue share**: the 30 percent lifetime referral share, plus the contributor and commenter
  distributions above.

## What members publish

- **Blog posts** at `/blog/<slug>/`: long-form writing, tutorials, and announcements, with author and
  contributor credits and native comments.
- **Products** at `/products/<slug>/`: a filterable directory of plugins, IDE extensions, Minecraft
  mods, WordPress tools, and utilities, each with its own page, links, and gallery.
- **Prompts** at `/prompts/<slug>/`: a library of reusable AI prompts with copy-to-clipboard, target
  models, variables, and example output.
- **Member profiles** at `/members/<username>/`: a public page per member, with a bio, links, skills,
  and everything they have published.

Alongside member content, the network publishes its own house pages (the about, contact, and legal
pages) and free utilities.

## The local-first model

Because the repo is the database, a member's machine is their authoring node. The authoring client is
one portable core delivered through two hosts that share one user interface, and the public site ships
that interface inert so a visitor never sees it.

- **Edit in place, in the browser (the primary path).** A Chrome extension lets a signed-in member edit
  their own content directly on the live gbti.network page, with no clone and no local server. The
  public build bakes inert editing hooks onto each member content page (custom-element tags plus data
  attributes, and nothing that defines them), so a visitor sees a normal static page. When the extension
  loads its bundle, the tag upgrades and editing turns on, but only for the member who owns that content.
  The edit opens a pull request through the same gate as any other change.
- **Run a local CMS and agent server (the richer path).** The kept npm package boots a browser CMS with
  per-type forms, preview, and image staging, plus a built-in MCP server. A member can author in the CMS
  or point an AI agent at the MCP server and have the agent draft and submit content through the exact
  same gated flow.

Both hosts run the same authoring core and load the same web-components interface. In the extension, the
GitHub token lives only in the background service worker and never enters the page. Either way, the
membership system decides what merges and stays published; the authoring tool only surfaces what a
member is allowed to do.

This is the whole architecture in one line: **the public git repo is the database, the static site is
the published read-view, and each member's client is their authoring node.**

## How it is built

### The site

[Astro](https://astro.build) and [Tailwind CSS](https://tailwindcss.com) build a static site that
deploys on **Cloudflare Pages**. Content is a set of Astro Zod collections (`post`, `product`, `prompt`,
`profile`, `page`, `applet`, `comment`, `share`), so the same schemas validate content in CI and in the
authoring client. Images are committed to the repo and served over the jsDelivr CDN; video is embed-only
and never committed. The public build renders only entries that are both `published` and `public`, so
drafts and members-only content are excluded from the bundle.

The design language is clean and green-accented, with a light and a dark theme: the GBTI green `#1f9e5f`,
the near-black ink `#25232b`, Baloo Da 2 for display, Hanken Grotesk for body and interface text, and
JetBrains Mono for labels.

### Membership and the single registry

**Stripe is the single source of truth for who has paid.** There is no separate database. At signup the
system creates a Stripe Customer carrying the member's immutable GitHub user id as metadata; conversion
adds the annual subscription. Status is derived from Stripe: an active subscription is paid, a card-less
Customer within 90 days of the trial start is trialing, and anything else is expired or cancelled.
GitHub usernames can change, so every lookup matches on the immutable GitHub id. Every membership check
fails closed: a missing Customer or any lookup error is treated as not paid.

### The gate

Members open pull requests; a metadata-only GitHub Action, the gate, decides whether each one may merge.
The gate runs on the base branch and reads only pull-request metadata (the author's GitHub id and the
changed file paths). It never checks out or runs the pull request's code, which is what keeps the
membership and automation secrets safe. It runs on both pull-request and pull-request-review events, so
a folder owner's approving review can flip a held check green.

The gate enforces a few rules:

- **Paid to publish.** A content pull request from anyone who is not a paid member (a visitor, a lapsed
  account, or a trial member) is rejected and closed with a sign-up or upgrade nudge (and left open, not
  destroyed, if the Stripe lookup was unhealthy at that moment, so a real member's work is never lost). A
  trial member's drafts stay on their own fork until they pay; nothing reaches the canonical repo during
  the trial.
- **Contribution carve-out.** A paid member may edit one other member's folder. That pull request is held
  until the folder owner approves it with a GitHub review on the current commit, resolved by the owner's
  immutable GitHub id, then it merges and the contributor is credited.
- **No privilege escalation.** Roles, bans, and overrides live in git under `house/`. Protected paths are
  owned through `CODEOWNERS`, and the gate hard-fails a pull request that reaches above its author's
  role, independent of review.

### Roles and overrides

Roles (member, moderator, admin, superadmin), bans, and grandfather grants live in git as
`house/roles.yml`, `house/bans.yml`, and `house/grandfathered.yml`. Effective status follows a fixed
precedence: a ban overrides everything, then staff, then a grandfather grant (treated as paid with no
subscription), then the Stripe-derived status. Superadmins are a fixed root of trust anchored in
`CODEOWNERS`.

### Keeping it in sync

Scheduled GitHub Actions reconcile the published site with payment status: they draft a lapsed member's
content, re-publish a resubscriber's, and sync Discord roles. Each member holds exactly one of three
Discord roles, Member, Trial, or Locked; a lapsed or banned account is swapped to Locked, which locks
them out of the channels while keeping them in the server (the reconcile never kicks). Status is derived
from Stripe in batches, so a real-time webhook is optional rather than required. A Cloudflare Worker
handles signup and checkout, and answers the client's membership-status check.

### Revenue distribution

Referral commissions and the contributor and commenter distributions are computed from Stripe invoices
and the git-recorded attribution, then paid through Stripe Connect after the 90-day hold. The payout job
settles atomically per invoice and is idempotent across overlapping runs.

### The authoring client

One portable, dependency-light core (`client/src/`) runs under two hosts: the Chrome extension
(`extension/`) and the npm CMS and MCP server (`client/`). They share one web-components interface
(`client-ui/`) that the public site embeds inert. The membership gate remains the only authority on what
merges; the client only surfaces what a member may do.

## Repository structure

- `members/<username>/`: a member's content, as `profile.md` plus nested `posts/<slug>/index.md`,
  `products/<slug>/index.md`, and `prompts/<slug>/index.md` folders
- `house/`: the network's own (non-member) content under `pages/`, `posts/`, `products/`, `applets/`, and
  `comments/`
- `house/*.yml`: git-native control files, including `roles.yml`, `bans.yml`, `grandfathered.yml`,
  `members-index.yml` (the GitHub-id to username map), `referral-config.yml`, `points-ledger.yml`,
  `taxonomy.yml` (the canonical category tree), and `favorite-counts.yml` (the member-identity-free
  aggregate synced from the edge store)
- `src/`: the Astro site (layouts, components, pages, content config, including the inert editing hooks
  in `src/components/EditHooks.astro`)
- `membership/`: the trust core (status derivation, the gate's merge logic, overrides, points, and
  revenue distribution), pure and unit-tested
- `clients/`: thin injectable-fetch REST clients for Stripe, GitHub, Discord, and Resend (no SDKs)
- `scripts/`: the membership controller (`pr-gate.mjs`, `reconcile.mjs`, `payout-referrals.mjs`,
  `award-contribution.mjs`, and their shared `lib/`)
- `workers/signup/`: the Cloudflare Worker for signup and checkout
- `client/`: the npm authoring host, a browser CMS plus an MCP server for AI agents
- `client-ui/`: the shared web-components interface, loaded by both hosts and embedded inert by the site
- `extension/`: the Chrome extension authoring host, for editing in place on the live site
- `test/`: the unit suite (`node --test`, no network, no secrets)

## Develop

- `npm install`
- `npm run dev`: local dev server (resolves a free port automatically)
- `npm run build`: production build to `dist/`
- `npm run preview`: preview the production build
- `npm test`: the membership and client unit suite (628 tests, no network, no secrets)
- `npm run check:content`: author scoping, unique slugs, and valid status and visibility
- `npm run check:media`: image size and format, and no committed video

The authoring hosts have their own guides: see `client/README.md` for the npm CMS and MCP server, and
`extension/README.md` for the Chrome extension.

## Contribute

See `CONTRIBUTING.md`. Members open a pull request that adds or edits files inside their own
`members/<github-username>/` folder. Anyone can read and fork; membership decides what merges and stays
published.

## Project status

The static site, the membership and revenue system, and the authoring client (both hosts) are built and
unit-tested against fixtures. Going live is a provisioning and deploy step: stand up the public GitHub
repo and branch protection, Cloudflare Pages and DNS, and the Stripe, Discord, GitHub OAuth, Turnstile,
and Resend accounts, then publish the client. Referral attribution and accrual are on by design; live
payouts switch on after the Stripe Connect platform is provisioned.
