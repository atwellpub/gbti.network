// One-off discovery probe for the daily.dev public GraphQL API.
//
// Run:  node scripts/probe-daily.mjs
//
// It answers two questions that decide how we import daily.dev's curated catalog into
// config/sources.mjs:
//   1. What fields does the `Source` type expose — specifically, is there an RSS/feed URL we can poll?
//   2. What field on `Post` holds the external (third-party) article URL behind the "read more" items?
//
// Pure discovery: it only reads. Paste the output back so we can build the real importer.

const API = 'https://api.daily.dev/graphql';
const HEADERS = { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (gbti-news probe)' };

async function gql(query, variables = {}) {
  const res = await fetch(API, { method: 'POST', headers: HEADERS, body: JSON.stringify({ query, variables }) });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, raw: text.slice(0, 500) };
  }
}

function typeFields(name) {
  return gql(`query($n:String!){ __type(name:$n){ name fields{ name type{ name kind ofType{ name kind } } } } }`, { n: name });
}

console.log('=== Source type fields (look for rss/feed/url) ===');
console.log(JSON.stringify((await typeFields('Source')).json?.data?.__type?.fields?.map((f) => f.name) ?? (await typeFields('Source')), null, 2));

console.log('\n=== Post type fields (look for the external article url) ===');
console.log(JSON.stringify((await typeFields('Post')).json?.data?.__type?.fields?.map((f) => f.name) ?? null, null, 2));

console.log('\n=== Sample: first 3 sources ===');
console.log(JSON.stringify(await gql(`query{ sources(first:3){ edges{ node{ id name handle permalink } } pageInfo{ hasNextPage endCursor } } }`), null, 2));
