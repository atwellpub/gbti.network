import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, cleanText, toEpochSeconds, contentRichness, RICH_CONTENT_MIN } from '../workers/signup/news/src/feeds.mjs';

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Example</title>
  <item>
    <title>First &amp; Best</title>
    <link>https://ex.com/1</link>
    <description><![CDATA[<p>Hello <b>world</b></p>]]></description>
    <pubDate>Mon, 15 Jun 2026 12:00:00 GMT</pubDate>
    <guid>https://ex.com/1</guid>
  </item>
  <item>
    <title>Second</title>
    <link>https://ex.com/2</link>
    <guid isPermaLink="false">guid-2</guid>
  </item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Example</title>
  <entry>
    <title>Atom Post</title>
    <link href="https://ex.com/a1" rel="alternate"/>
    <id>tag:ex.com,2026:a1</id>
    <summary>Some &lt;em&gt;summary&lt;/em&gt;</summary>
    <published>2026-06-14T10:00:00Z</published>
  </entry>
</feed>`;

const SINGLE_ITEM_RSS = `<rss version="2.0"><channel><item>
  <title>Only one</title><link>https://ex.com/only</link>
</item></channel></rss>`;

test('parseFeed handles RSS 2.0', () => {
  const items = parseFeed(RSS, 'ex');
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    guid: 'https://ex.com/1',
    source: 'ex',
    title: 'First & Best',
    link: 'https://ex.com/1',
    image: null, // SOW-046 F: no enclosure/media on this item
    summary: 'Hello world',
    contentText: 'Hello world', // SOW-046 A: transient article text for the AI summarizer (here = the description)
    publishedAt: toEpochSeconds('Mon, 15 Jun 2026 12:00:00 GMT'),
  });
  // guid element with attributes still resolves to its text node
  assert.equal(items[1].guid, 'guid-2');
});

test('parseFeed captures full <content:encoded> as contentText while summary stays the short excerpt (SOW-046 A)', () => {
  const long = 'Word '.repeat(200).trim(); // ~1000 chars, well over the 500-char excerpt cap
  const RSS_FULL = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
  <item>
    <title>Full body</title>
    <link>https://ex.com/full</link>
    <description>Short blurb</description>
    <content:encoded><![CDATA[<p>${long}</p>]]></content:encoded>
  </item>
</channel></rss>`;
  const [it] = parseFeed(RSS_FULL, 'ex');
  assert.equal(it.summary, 'Short blurb'); // display excerpt prefers the short <description>
  assert.ok(it.contentText.length > 500, 'contentText carries the fuller article body for the AI'); // from content:encoded
  assert.ok(it.contentText.startsWith('Word Word'));
});

test('parseFeed handles Atom and picks the alternate link href', () => {
  const items = parseFeed(ATOM, 'atom');
  assert.equal(items.length, 1);
  assert.equal(items[0].link, 'https://ex.com/a1');
  assert.equal(items[0].guid, 'tag:ex.com,2026:a1');
  assert.equal(items[0].summary, 'Some summary');
  assert.ok(items[0].publishedAt > 0);
});

test('parseFeed coerces a single <item> into an array', () => {
  const items = parseFeed(SINGLE_ITEM_RSS, 's');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Only one');
  // no guid in feed -> falls back to the link
  assert.equal(items[0].guid, 'https://ex.com/only');
});

test('contentRichness flags full inline content vs a thin blurb (SOW-046 A diagnostics)', () => {
  assert.equal(contentRichness({ contentText: 'x'.repeat(RICH_CONTENT_MIN) }), 'full');
  assert.equal(contentRichness({ contentText: 'x'.repeat(RICH_CONTENT_MIN - 1) }), 'thin');
  assert.equal(contentRichness({ contentText: 'short blurb' }), 'thin');
  assert.equal(contentRichness({}), 'thin'); // no content at all
});

test('parseFeed returns [] on garbage instead of throwing', () => {
  assert.deepEqual(parseFeed('not xml at all <<<', 'x'), []);
  assert.deepEqual(parseFeed('', 'x'), []);
});

test('cleanText strips tags, decodes entities, collapses whitespace', () => {
  assert.equal(cleanText('<p>A &amp; B   &lt;3</p>\n\nC'), 'A & B <3 C');
  assert.equal(cleanText('x'.repeat(600)).length, 500);
});

test('toEpochSeconds parses RFC-822 and RFC-3339, null on junk', () => {
  assert.equal(typeof toEpochSeconds('2026-06-14T10:00:00Z'), 'number');
  assert.equal(typeof toEpochSeconds('Mon, 15 Jun 2026 12:00:00 GMT'), 'number');
  assert.equal(toEpochSeconds('not a date'), null);
  assert.equal(toEpochSeconds(''), null);
});

// SOW-046 F: extract the source article image from the item's own markup (no extra fetch). Covers an image
// <enclosure>, Media RSS <media:thumbnail>/<media:content> (incl. a <media:group>), and an Atom enclosure link.
const RSS_IMG = `<?xml version="1.0"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/"><channel>
  <item>
    <title>Enclosure image</title>
    <link>https://ex.com/e</link>
    <guid>https://ex.com/e</guid>
    <enclosure url="https://cdn.ex.com/e.jpg" type="image/jpeg" length="12345"/>
  </item>
  <item>
    <title>Media thumbnail</title>
    <link>https://ex.com/m</link>
    <guid>https://ex.com/m</guid>
    <media:thumbnail url="https://cdn.ex.com/m.png"/>
  </item>
  <item>
    <title>Media group content</title>
    <link>https://ex.com/g</link>
    <guid>https://ex.com/g</guid>
    <media:group><media:content url="https://cdn.ex.com/g.webp" medium="image"/></media:group>
  </item>
  <item>
    <title>Non-image enclosure is ignored</title>
    <link>https://ex.com/p</link>
    <guid>https://ex.com/p</guid>
    <enclosure url="https://cdn.ex.com/p.mp3" type="audio/mpeg"/>
  </item>
  <item>
    <title>No media at all</title>
    <link>https://ex.com/n</link>
    <guid>https://ex.com/n</guid>
  </item>
</channel></rss>`;

const ATOM_IMG = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Atom enclosure image</title>
    <link href="https://ex.com/a1" rel="alternate"/>
    <link href="https://cdn.ex.com/a1.jpg" rel="enclosure" type="image/jpeg"/>
    <id>tag:ex.com,2026:a1</id>
  </entry>
</feed>`;

test('parseFeed extracts an item image from enclosure / media:* (SOW-046 F)', () => {
  const items = parseFeed(RSS_IMG, 'src');
  const by = Object.fromEntries(items.map((i) => [i.title, i.image]));
  assert.equal(by['Enclosure image'], 'https://cdn.ex.com/e.jpg');
  assert.equal(by['Media thumbnail'], 'https://cdn.ex.com/m.png');
  assert.equal(by['Media group content'], 'https://cdn.ex.com/g.webp');
  assert.equal(by['Non-image enclosure is ignored'], null); // audio enclosure -> no image
  assert.equal(by['No media at all'], null);
});

test('parseFeed extracts an Atom enclosure-link image (SOW-046 F)', () => {
  const [it] = parseFeed(ATOM_IMG, 'src');
  assert.equal(it.image, 'https://cdn.ex.com/a1.jpg');
  assert.equal(it.link, 'https://ex.com/a1'); // the alternate link still wins for the article URL
});

// SOW-050 Tier 0: when a feed carries no enclosure/media image, fall back to the FIRST inline <img> in the item body
// (content:encoded / description), with NO extra fetch. Skips tracking/beacon images; media still wins when present.
const RSS_INLINE = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/"><channel>
  <item>
    <title>Inline content image</title>
    <link>https://ex.com/i</link>
    <guid>https://ex.com/i</guid>
    <content:encoded><![CDATA[<p>Lead</p><img src="https://cdn.ex.com/lead.jpg" width="800"/><p>More</p>]]></content:encoded>
  </item>
  <item>
    <title>Description image</title>
    <link>https://ex.com/d</link>
    <guid>https://ex.com/d</guid>
    <description><![CDATA[<img src='https://cdn.ex.com/desc.png'> body]]></description>
  </item>
  <item>
    <title>Tracking beacon is skipped</title>
    <link>https://ex.com/t</link>
    <guid>https://ex.com/t</guid>
    <description><![CDATA[<img src="https://feeds.feedburner.com/~r/site/~4/abc.gif"> text]]></description>
  </item>
  <item>
    <title>Media wins over inline</title>
    <link>https://ex.com/w</link>
    <guid>https://ex.com/w</guid>
    <media:thumbnail url="https://cdn.ex.com/win.png"/>
    <content:encoded><![CDATA[<img src="https://cdn.ex.com/inline.jpg"/>]]></content:encoded>
  </item>
</channel></rss>`;

test('parseFeed falls back to the first inline body <img> (SOW-050 Tier 0)', () => {
  const by = Object.fromEntries(parseFeed(RSS_INLINE, 'src').map((i) => [i.title, i.image]));
  assert.equal(by['Inline content image'], 'https://cdn.ex.com/lead.jpg');
  assert.equal(by['Description image'], 'https://cdn.ex.com/desc.png'); // single-quoted src too
  assert.equal(by['Tracking beacon is skipped'], null); // feedburner .gif beacon -> not picked
  assert.equal(by['Media wins over inline'], 'https://cdn.ex.com/win.png'); // enclosure/media still takes priority
});
