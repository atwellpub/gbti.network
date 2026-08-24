// sow-166 (2026-08-23): every subscriber's FIRST email is the 90-day WELCOME issue, whenever they join.
//
// Before this, the 90-day scope was a property of the NEWSLETTER (it applied only while no prior weekly issue
// existed), not of the SUBSCRIBER. Somebody joining in month three got a thin "this week" email as their
// introduction to the network and never saw the back catalogue.
//
// The tests that carry weight here are the ISOLATION ones. A welcome issue holds ninety days of urls, so if it
// were ever counted as a prior issue it would mark a quarter of the catalogue as already-mailed and gut the
// next weekly. That safety rests entirely on a string prefix, which is exactly the kind of thing that gets
// "tidied" later, so it is pinned rather than argued.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { welcomeIssueId, weeklyIssueId, isWelcomeIssueId, isWelcomed, weeklyEligible } from '../membership/mail-compile-core.mjs';
import { composeIssue, FIRST_ISSUE_NOTE, WELCOME_NOTE, WELCOME_GREETING, WELCOME_HEADER_LINE } from '../membership/mail-digest.mjs';
import { renderIssue } from '../membership/mail-render.mjs';
import { resolveWindow, listRecipientHashes } from '../workers/signup/mail-compile.mjs';
import { MAIL_SUBSCRIBER_PREFIX } from '../membership/mail-suppress.mjs';

const DAY = 24 * 3600 * 1000;

/** A KV double holding the given issue ids and subscriber records. */
function fakeKv({ issues = {}, subscribers = {} } = {}) {
  const store = new Map();
  for (const [id, issue] of Object.entries(issues)) store.set(`mail:issue:${id}`, issue);
  for (const [hash, sub] of Object.entries(subscribers)) store.set(`${MAIL_SUBSCRIBER_PREFIX}${hash}`, sub);
  return {
    list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
    get: async (key) => store.get(key) ?? null,
    put: async (key, value) => { store.set(key, typeof value === 'string' ? JSON.parse(value) : value); },
    _store: store,
  };
}

const sub = (hash, extra = {}) => ({ hash, source: 'anon', emailEnc: 'enc', status: 'active', createdAt: 1, updatedAt: 1, ...extra });

test('a welcome id is date-stamped and distinguishable from a weekly id', () => {
  assert.equal(welcomeIssueId(Date.UTC(2026, 7, 25)), 'welcome-2026-08-25');
  assert.equal(weeklyIssueId(Date.UTC(2026, 7, 25)), 'weekly-2026-08-25');
  assert.ok(isWelcomeIssueId('welcome-2026-08-25'));
  assert.ok(!isWelcomeIssueId('weekly-2026-08-25'));
  assert.ok(!isWelcomeIssueId(null) && !isWelcomeIssueId(undefined) && !isWelcomeIssueId(42));
  assert.throws(() => welcomeIssueId(NaN), /finite/);
});

// THE ISOLATION PROPERTY, and it turned out to be over-determined. Recorded because the first version of
// this test PASSED under a mutation that should have broken it, which is the only reason anyone found out.
//
// A welcome issue carries ninety days of urls. If it were ever counted as a "prior issue" it would mark a
// quarter of the catalogue as already-mailed and gut the next weekly. TWO independent mechanisms in
// listPriorIssueIds prevent that, and it matters that they are separate:
//
//   1. The `weekly-` prefix filter, which is the intentional control.
//   2. An accident of string ordering. The guard skips any id where `id >= currentIssueId`, and "welcome-"
//      sorts AFTER "weekly-" (they share "we", then 'l' beats 'e'), so a welcome id is skipped for EVERY
//      weekly compile whatever its date.
//
// Because (2) alone is sufficient on the real code path, a test that only exercises that path cannot tell
// whether (1) still works. So the filter is pinned separately below, on the one call shape where the ordering
// guard does not apply. Do not merge these two tests back together.
test('ISOLATION: a frozen welcome issue never moves the weekly floor or enters its exclude set', async () => {
  const weeklyOnly = fakeKv({ issues: { 'weekly-2026-08-25': { generatedAt: Date.UTC(2026, 7, 25), sections: { article: [{ url: 'https://a' }] } } } });
  const withWelcome = fakeKv({ issues: {
    'weekly-2026-08-25': { generatedAt: Date.UTC(2026, 7, 25), sections: { article: [{ url: 'https://a' }] } },
    'welcome-2026-08-31': { generatedAt: Date.UTC(2026, 7, 31), sections: { article: [{ url: 'https://b' }, { url: 'https://c' }] } },
  } });
  const opts = { nowMs: Date.UTC(2026, 8, 1), currentIssueId: 'weekly-2026-09-01' };
  const a = await resolveWindow(weeklyOnly, opts);
  const b = await resolveWindow(withWelcome, opts);
  assert.equal(b.since, a.since, 'the floor must not move because a welcome exists');
  assert.deepEqual([...b.exclude].sort(), [...a.exclude].sort(), 'welcome urls must not enter the exclude set');
  assert.ok(!b.exclude.has('https://b'), 'a url mailed only in a welcome stays eligible for the weekly');
});

test('ISOLATION: the weekly- prefix filter alone excludes a welcome, with no help from id ordering', async () => {
  // With no currentIssueId the `id >= currentIssueId` guard does not run, so the prefix filter is the ONLY
  // thing standing between a welcome issue and the exclude set. This is the shape that fails if somebody
  // widens that filter, and the real path above cannot detect that.
  const kv = fakeKv({ issues: {
    'weekly-2026-08-25': { generatedAt: Date.UTC(2026, 7, 25), sections: { article: [{ url: 'https://a' }] } },
    'welcome-2026-08-31': { generatedAt: Date.UTC(2026, 7, 31), sections: { article: [{ url: 'https://b' }] } },
  } });
  const w = await resolveWindow(kv, { nowMs: Date.UTC(2026, 8, 1), currentIssueId: null });
  assert.ok(w.exclude.has('https://a'), 'the real weekly IS counted, so this assertion is not vacuous');
  assert.ok(!w.exclude.has('https://b'), 'the welcome is excluded by the prefix filter alone');
});

test('the ordering accident that backs up the prefix filter, pinned so a rename cannot silently remove it', () => {
  // Not a style assertion. listPriorIssueIds skips `id >= currentIssueId`, so these orderings are load-bearing:
  // a welcome must sort after any weekly, and a rehearsal must sort before any weekly.
  assert.ok('welcome-2026-01-01' >= 'weekly-2099-12-31', 'a welcome id must sort after every weekly id');
  assert.ok(!('test-2026-01-01' >= 'weekly-2020-01-01'), 'a test id must sort before every weekly id');
});

// THE REHEARSAL PROPERTY, which already held by an unwritten accident of string ordering and is now pinned.
test('a test- compile always resolves the full 90-day launch window, even with real issues present', async () => {
  const kv = fakeKv({ issues: {
    'weekly-2026-08-25': { generatedAt: Date.UTC(2026, 7, 25), sections: {} },
    'weekly-2026-09-01': { generatedAt: Date.UTC(2026, 8, 1), sections: {} },
  } });
  const nowMs = Date.UTC(2026, 8, 15);
  const rehearsal = await resolveWindow(kv, { nowMs, currentIssueId: 'test-2026-09-15' });
  assert.equal(rehearsal.firstIssue, true, 'a rehearsal must show what a NEW subscriber sees');
  assert.equal(Math.round((nowMs - rehearsal.since) / DAY), 90);
  assert.equal(rehearsal.exclude, null);
  // Contrast: the real weekly is narrow, so the assertion above is not vacuously true of every compile.
  const real = await resolveWindow(kv, { nowMs, currentIssueId: 'weekly-2026-09-15' });
  assert.equal(real.firstIssue, false);
  assert.ok(Math.round((nowMs - real.since) / DAY) < 90, 'the real weekly must NOT get the 90-day window');
});

test('resolveWindow reports the newest prior weekly as the start of the current cycle', async () => {
  const kv = fakeKv({ issues: {
    'weekly-2026-08-25': { generatedAt: 1000, sections: {} },
    'weekly-2026-09-01': { generatedAt: 2000, sections: {} },
  } });
  const w = await resolveWindow(kv, { nowMs: 3000, currentIssueId: 'weekly-2026-09-08' });
  assert.equal(w.previousGeneratedAt, 2000);
  const first = await resolveWindow(fakeKv(), { nowMs: 3000, currentIssueId: 'weekly-2026-09-08' });
  assert.equal(first.previousGeneratedAt, null, 'no prior issue means no cycle to double up with');
});

test('weeklyEligible excludes the unwelcomed and anyone welcomed during this cycle', () => {
  assert.equal(weeklyEligible(sub('a'), 2000), false, 'never welcomed: the sweep owns them');
  assert.equal(weeklyEligible(sub('a', { welcomedAt: 2500 }), 2000), false, 'welcomed this cycle');
  assert.equal(weeklyEligible(sub('a', { welcomedAt: 2000 }), 2000), false, 'welcomed exactly at the cusp');
  assert.equal(weeklyEligible(sub('a', { welcomedAt: 1500 }), 2000), true, 'welcomed in an earlier cycle');
  // Number(null) is 0, not NaN. A bare isFinite check here would read "no prior weekly" as a floor of zero and
  // silently exclude EVERY subscriber from EVERY weekly. This caught exactly that during implementation.
  assert.equal(weeklyEligible(sub('a', { welcomedAt: 1500 }), null), true, 'no prior weekly: nothing to clash with');
  assert.equal(weeklyEligible(sub('a', { welcomedAt: 1500 }), undefined), true);
  assert.equal(weeklyEligible(null, 2000), false);
});

test('isWelcomed fails safe: anything that is not a positive timestamp reads as NOT welcomed', () => {
  for (const v of [null, undefined, 0, -1, NaN, 'yes', {}]) {
    assert.equal(isWelcomed({ welcomedAt: v }), false, `welcomedAt=${String(v)}`);
  }
  assert.equal(isWelcomed({ welcomedAt: 1 }), true);
  assert.equal(isWelcomed(null), false);
});

test('the recipient filter splits the base: the unwelcomed for the welcome, earlier-welcomed for the weekly', async () => {
  const kv = fakeKv({ subscribers: {
    fresh: sub('fresh'),
    lastCycle: sub('lastCycle', { welcomedAt: 1500 }),
    thisCycle: sub('thisCycle', { welcomedAt: 2500 }),
  } });
  const unwelcomed = await listRecipientHashes(kv, { filter: (s) => !isWelcomed(s) });
  assert.deepEqual(unwelcomed.hashes.sort(), ['fresh']);
  const weekly = await listRecipientHashes(kv, { filter: (s) => weeklyEligible(s, 2000) });
  assert.deepEqual(weekly.hashes.sort(), ['lastCycle']);
  // No filter is the unchanged behaviour: everybody who canReceive.
  const all = await listRecipientHashes(kv);
  assert.deepEqual(all.hashes.sort(), ['fresh', 'lastCycle', 'thisCycle']);
});

// sow-166: THE SPAN PHRASE EXISTS IN TWO MODULES AND HAS ALREADY DRIFTED ONCE.
//
// membership/mail-digest.mjs owns FIRST_ISSUE_PHRASE (the per-section notes) and membership/mail-render.mjs
// hardcodes the same span in emptyPhrase (the collapsed empty line). They are kept separate so the template
// carries no digest imports and can be swapped behind the renderIssue seam. The cost of that separation is
// exactly this: when the owner widened the bootstrap window from 7 days to 90 on 2026-08-22, BOTH strings were
// left saying "week", and the launch issue told its readers it covered a week while listing items from two
// months back. Nobody noticed until it was rendered and read.
//
// So the duplication is allowed and the AGREEMENT is pinned here.
test('the launch span phrase agrees across the digest and the renderer', () => {
  const layout = [
    { key: 'news', label: 'News', empty: false, items: [{ title: 'N', url: 'https://n/x', source: 'S', date: 1 }] },
    { key: 'article', label: 'Articles', empty: true, note: 'x', items: [] },
  ];
  const html = renderIssue({ launchNote: FIRST_ISSUE_NOTE, layout }, {}).html;
  assert.match(html, /Nothing new in Articles in the past 90 days\./, 'the renderer names the 90-day span');
  assert.match(FIRST_ISSUE_NOTE, /past 90 days/, 'and so does the digest note');
  // Not vacuous: a non-launch issue still uses the cadence clause.
  assert.match(renderIssue({ layout }, {}).html, /Nothing new in Articles since the last issue\./);
});

test('the WELCOME note thanks the subscriber and explains nothing about the compiler', () => {
  // OWNER RULING, 2026-08-24. This note used to read "this is your first issue, so it covers the past 90
  // days", which was a fact about the window dressed as a greeting. Before that it read "this is THE first
  // issue", which is simply false for anyone joining after the launch. The third version is the one the owner
  // asked for: thank them for subscribing, and thank them for the work they do.
  assert.match(WELCOME_NOTE, /thank you for subscribing/i);
  assert.match(WELCOME_NOTE, /making the internet a better place/i);
  // Both superseded shapes must stay gone, including the one that was itself a correction.
  assert.doesNotMatch(WELCOME_NOTE, /first issue/i);
  assert.doesNotMatch(WELCOME_NOTE, /90 days/, 'the span is said by the preheader and the empty line, not here');
  assert.match(WELCOME_GREETING, /welcome/i);
  assert.doesNotMatch(WELCOME_HEADER_LINE, /90 days/);
});

test('dropping the span from the note did NOT drop it from the issue', () => {
  // The note was the only place a reader was told the welcome reaches back further than a week, so removing
  // it is only safe because two other lines still say so. If both of those ever go, a subscriber gets three
  // months of items under a week number with nothing to explain it. This is that guard.
  const layout = [
    { key: 'article', label: 'Articles', empty: false, items: [{ title: 'A', url: 'https://gbti.network/a', author: 'x' }] },
    { key: 'product', label: 'Products', empty: true, note: 'x', items: [] },
  ];
  const { html } = renderIssue({ launchNote: WELCOME_NOTE, layout, counts: { article: 4 } }, {});
  assert.match(html, /from the network in the past 90 days\./, 'the preheader still names the span');
  assert.match(html, /Nothing new in Products in the past 90 days\./, 'and so does the empty-section line');
});

test('a composed WELCOME issue renders the welcome note and the 90-day empty-section wording', () => {
  const issue = composeIssue(
    { issueId: welcomeIssueId(Date.UTC(2026, 7, 25)), items: [], news: [], now: () => Date.UTC(2026, 7, 25) },
    { perSection: 5, since: Date.UTC(2026, 7, 25) - 90 * DAY, exclude: null, firstIssue: true, launchNote: WELCOME_NOTE },
  );
  assert.equal(issue.launchNote, WELCOME_NOTE);
  const { html } = renderIssue(issue, { greeting: WELCOME_GREETING, headerLine: WELCOME_HEADER_LINE });
  assert.match(html, /Thank you for subscribing to the weekly digest/);
  assert.doesNotMatch(html, /This is the first issue/, 'the newsletter-wide launch note must not appear on a welcome');
  // The note no longer carries the span, but it still has to switch the WORDING, because the renderer reads
  // firstIssue off the presence of a note. A welcome whose empty sections said "since the last issue" would be
  // claiming a previous issue that does not exist.
  assert.match(html, /in the past 90 days/, 'empty sections use the launch wording, not "since the last issue"');
  assert.doesNotMatch(html, /since the last issue/);
});

// sow-166 (2026-08-24): THE PREHEADER WAS A THIRD COPY OF THE CADENCE, AND IT WAS STILL WRONG.
//
// The first delivered welcome carried the right header, the right date range and the right launch note, and
// then opened its preview line with "from the network this week" over 90 days of items. Two copies of the
// span had already been found and fixed by rendering the email; this one survived BOTH passes because the
// preheader is display:none and does not appear when you look at the rendered page. It only shows up in the
// inbox list, which is the first thing a reader sees and the last thing anyone checks.
//
// The lesson is not "grep harder for the string". It is that a cadence word anywhere in this template is a
// copy of the window, and every copy has now been routed through one constant.
test('the PREHEADER names the span it covers, and does not say "this week" on a first issue', () => {
  const layout = [
    { key: 'article', label: 'Articles', empty: false, items: [{ title: 'A', url: 'https://gbti.network/a', author: 'x' }] },
  ];
  const counts = { article: 4, product: 2 };

  const first = renderIssue({ launchNote: FIRST_ISSUE_NOTE, layout, counts }, {}).html;
  assert.match(first, /from the network in the past 90 days\./);
  assert.doesNotMatch(first, /from the network this week\./, 'a 90-day issue must not preview itself as a week');

  // Not vacuous: the ordinary weekly is unchanged, so this pins the SPLIT rather than the phrase.
  const weekly = renderIssue({ layout, counts }, {}).html;
  assert.match(weekly, /from the network this week\./);
  assert.doesNotMatch(weekly, /in the past 90 days/);
});

test('the no-counts preheader fallback splits on cadence too', () => {
  // The fallback used to be a bare literal at the call site, which is how the other copies of this phrase
  // drifted apart in the first place: it is not reached by any test that renders a normal issue.
  const layout = [{ key: 'article', label: 'Articles', empty: true, note: 'x', items: [] }];
  assert.match(renderIssue({ launchNote: WELCOME_NOTE, layout }, {}).html, /Your first roundup from the GBTI Network\./);
  assert.match(renderIssue({ layout }, {}).html, /Your weekly roundup from the GBTI Network\./);
});
