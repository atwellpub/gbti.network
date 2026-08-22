// SOW-186 phase 4 (DELIVERY): the PURE follow-notification core (membership/mail-notify.mjs) and its email
// template (membership/mail-notify-render.mjs). No network, no KV, no secrets. Proves the leak guard (no body ever
// reaches the output), the fail-closed email resolution, deterministic idempotent issue ids, and the escaping.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  NOTIFY_EVENT_FOR_TYPE, eventForType, notificationIssueId, buildNotificationIssue, selectEmailRecipients,
} from '../membership/mail-notify.mjs';
import { renderNotificationEmail } from '../membership/mail-notify-render.mjs';
import { renderMailIssue } from '../membership/mail-render-dispatch.mjs';

// ---------- event mapping ----------

test('eventForType maps a post to the article notify event and 1:1 for the rest; a share has none', () => {
  assert.equal(eventForType('post'), 'article');
  assert.equal(eventForType('article'), 'article');
  assert.equal(eventForType('product'), 'product');
  assert.equal(eventForType('prompt'), 'prompt');
  assert.equal(eventForType('share'), null, 'shares have no email notification in this cut');
  assert.equal(eventForType('nonsense'), null);
  assert.equal(NOTIFY_EVENT_FOR_TYPE.post, 'article');
});

// ---------- the deterministic, idempotent issue id ----------

test('notificationIssueId is deterministic and carries no timestamp (idempotent across Action retries)', () => {
  const a = notificationIssueId({ type: 'post', author: 'alice', slug: 'x' });
  const b = notificationIssueId({ type: 'post', author: 'alice', slug: 'x' });
  assert.equal(a, b);
  assert.equal(a, 'notify:post:alice:x');
  assert.notEqual(a, notificationIssueId({ type: 'product', author: 'alice', slug: 'x' }));
});

// ---------- buildNotificationIssue: metadata only, NO body field ----------

test('buildNotificationIssue carries only public metadata and kind:notification, never a body', () => {
  const issue = buildNotificationIssue({
    type: 'post', author: 'alice', slug: 'x', title: 'Hello', authorName: 'Alice',
    url: 'https://gbti.network/articles/x/', generatedAt: 123,
    // fields a caller might mistakenly pass; buildNotificationIssue must not carry them through:
    body: 'SECRET BODY', encryptedBody: 'CIPHER', blurb: 'SECRET BLURB',
  });
  assert.equal(issue.kind, 'notification');
  assert.equal(issue.issueId, 'notify:post:alice:x');
  assert.equal(issue.event, 'article');
  assert.equal(issue.title, 'Hello');
  assert.equal(issue.url, 'https://gbti.network/articles/x/');
  assert.equal(issue.authorName, 'Alice');
  assert.equal(issue.generatedAt, 123);
  // LEAK GUARD at the model layer: no body/blurb/ciphertext field survives onto the frozen issue.
  assert.ok(!('body' in issue), 'no body field');
  assert.ok(!('encryptedBody' in issue), 'no ciphertext field');
  assert.ok(!('blurb' in issue), 'no blurb field');
  const serialized = JSON.stringify(issue);
  assert.ok(!serialized.includes('SECRET'), 'no smuggled secret text is serialized into the frozen issue');
  assert.ok(!serialized.includes('CIPHER'));
});

// ---------- selectEmailRecipients: email fail-closed OFF ----------

const on = { article: { email: true } };
const off = { article: { email: false } };

test('selectEmailRecipients: a follower with no notify preference gets NO email (fail-closed OFF)', () => {
  const out = selectEmailRecipients(
    [{ githubId: '11', mailHash: 'hA' }], // no follow override, no global default
    { event: 'article' },
  );
  assert.deepEqual(out, [], 'the system default is email OFF, so no preference means no email');
});

test('selectEmailRecipients: a global default of email ON includes the mailable follower', () => {
  const out = selectEmailRecipients(
    [{ githubId: '11', mailHash: 'hA', globalNotify: on }],
    { event: 'article' },
  );
  assert.deepEqual(out, ['hA']);
});

test('selectEmailRecipients: a per-follow override BEATS the global default (both directions)', () => {
  // override ON over global OFF -> included
  assert.deepEqual(
    selectEmailRecipients([{ githubId: '11', mailHash: 'hA', followNotify: on, globalNotify: off }], { event: 'article' }),
    ['hA'],
  );
  // override OFF over global ON -> excluded
  assert.deepEqual(
    selectEmailRecipients([{ githubId: '11', mailHash: 'hA', followNotify: off, globalNotify: on }], { event: 'article' }),
    [],
  );
});

test('selectEmailRecipients: an email-on follower with NO mailable hash is excluded', () => {
  const out = selectEmailRecipients(
    [{ githubId: '11', mailHash: '', globalNotify: on }, { githubId: '22', globalNotify: on }],
    { event: 'article' },
  );
  assert.deepEqual(out, [], 'no subscriber record means no address means no recipient');
});

test('selectEmailRecipients: the author never self-notifies, even following their own folder with email on', () => {
  const out = selectEmailRecipients(
    [{ githubId: '9001', mailHash: 'hSelf', globalNotify: on }, { githubId: '11', mailHash: 'hA', globalNotify: on }],
    { event: 'article', authorId: '9001' },
  );
  assert.deepEqual(out, ['hA']);
});

test('selectEmailRecipients dedupes a hash that appears twice', () => {
  const out = selectEmailRecipients(
    [{ githubId: '11', mailHash: 'hA', globalNotify: on }, { githubId: '11', mailHash: 'hA', globalNotify: on }],
    { event: 'article' },
  );
  assert.deepEqual(out, ['hA']);
});

test('selectEmailRecipients resolves per EVENT: article-on does not fire for a product publish', () => {
  const out = selectEmailRecipients(
    [{ githubId: '11', mailHash: 'hA', globalNotify: { article: { email: true } } }],
    { event: 'product' },
  );
  assert.deepEqual(out, [], 'the article opt-in does not leak into a product notification');
});

// ---------- renderNotificationEmail: content, escaping, unsubscribe, LEAK guard ----------

const baseIssue = {
  issueId: 'notify:post:alice:x', kind: 'notification', author: 'alice', authorName: 'Alice',
  type: 'post', event: 'article', title: 'Hello World', url: 'https://gbti.network/articles/x/', generatedAt: 0,
};
const ctx = { unsubscribeUrl: 'https://signup.gbti.network/mail/unsubscribe?h=hA&t=tok' };

test('renderNotificationEmail renders subject/html/text with the title, author and public link', () => {
  const { subject, html, text } = renderNotificationEmail(baseIssue, ctx);
  assert.match(subject, /Alice published a new article: Hello World/);
  assert.ok(html.includes('Hello World'));
  assert.ok(html.includes('https://gbti.network/articles/x/'), 'the public link is present');
  assert.ok(html.includes('by Alice'));
  assert.ok(text.includes('Hello World'));
  assert.ok(text.includes('https://gbti.network/articles/x/'));
});

test('renderNotificationEmail always carries the one-click unsubscribe link (html + text)', () => {
  const { html, text } = renderNotificationEmail(baseIssue, ctx);
  assert.ok(html.includes('https://signup.gbti.network/mail/unsubscribe?h=hA&amp;t=tok'), 'unsub href, escaped');
  assert.ok(html.toLowerCase().includes('unsubscribe'));
  assert.ok(text.includes('https://signup.gbti.network/mail/unsubscribe?h=hA&t=tok'));
});

test('renderNotificationEmail LEAK GUARD: a body/ciphertext smuggled onto the issue never reaches the output', () => {
  const hostile = { ...baseIssue, body: 'MEMBERS-ONLY BODY', encryptedBody: 'CIPHERTEXT', blurb: 'SECRET' };
  const { subject, html, text } = renderNotificationEmail(hostile, ctx);
  for (const out of [subject, html, text]) {
    assert.ok(!out.includes('MEMBERS-ONLY BODY'), 'no body text in the email');
    assert.ok(!out.includes('CIPHERTEXT'), 'no ciphertext in the email');
    assert.ok(!out.includes('SECRET'), 'no blurb in the email');
  }
});

test('renderNotificationEmail escapes a hostile title (no raw markup injection)', () => {
  const evil = { ...baseIssue, title: '<script>alert(1)</script>', authorName: '<b>x</b>' };
  const { html } = renderNotificationEmail(evil, ctx);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'the script tag is escaped');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped form present');
  assert.ok(!html.includes('<b>x</b>'), 'the author name is escaped too');
});

test('renderNotificationEmail: a non-http(s) url is dropped to plain text, never a live link', () => {
  const evil = { ...baseIssue, url: 'javascript:alert(1)' };
  const { html } = renderNotificationEmail(evil, ctx);
  assert.ok(!html.includes('javascript:alert(1)'), 'an unsafe url never becomes an href');
  assert.ok(html.includes('Hello World'), 'the title still renders as plain text');
});

// ---------- renderMailIssue: the production dispatcher, BOTH branches through the REAL renderers ----------
// This is the exact function workers/signup/index.mjs mailDrainDeps injects, so both branches are covered by the
// line that actually runs (QAmaster gap, 2026-08-22): the notification branch AND the digest branch (which nothing
// exercised before, since the e2e only drives a notification issue).

test('renderMailIssue routes a notification issue to the follow template', () => {
  const { subject } = renderMailIssue(baseIssue, ctx);
  assert.match(subject, /Alice published a new article: Hello World/);
});

test('renderMailIssue routes a non-notification (digest) issue to the digest renderer', () => {
  // A minimal frozen digest issue (empty layout is a valid empty week); the digest renderer owns the subject.
  const digestIssue = { issueId: 'i1', layout: [], counts: {}, generatedAt: 0 };
  const { subject } = renderMailIssue(digestIssue, ctx);
  assert.match(subject, /digest/i, 'the digest branch renders the weekly digest, not the follow template');
  assert.ok(!/published a new/.test(subject), 'a digest issue never renders the follow subject');
});
