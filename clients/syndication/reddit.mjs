// SOW-088: the Reddit syndication adapter, ported from the owner's Radle WordPress plugin (the authority
// for the OAuth + submit contract). Posts a LINK to the community subreddit as the brand account:
//   1. refresh an access token (https://www.reddit.com/api/v1/access_token, HTTP Basic client_id:secret,
//      grant_type=refresh_token; the refresh token comes from a duration=permanent authorize and is
//      long-lived) — stateless per post, fine at our volume;
//   2. POST https://oauth.reddit.com/api/submit with Bearer + Reddit's REQUIRED User-Agent, kind=link
//      (sr, title, url). Improvement over Radle: `api_type: 'json'` makes the response clean JSON
//      (json.data.id/url) instead of the legacy jquery-array walk.
// A url-less item posts kind=self with the text as the body; a LINK post carries its bodyText natively
// (field-proven: /api/submit stores `text` as selftext on kind=link). Thin injectable-fetch client; no SDK.
//
// Secrets: REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET, REDDIT_REFRESH_TOKEN, REDDIT_SUBREDDIT. Mint/renew the
// refresh token with scripts/reddit-auth.mjs (the app's redirect URI must be localhost:8976/callback).

import { buildChannelText, renderTemplate } from '../../membership/syndication-format.mjs';
import { templateFor } from '../../membership/syndication-config-core.mjs';
import { channelLimit, secretsPresent } from '../../membership/syndication-channels.mjs';

const USER_AGENT = 'cloudflare-worker:network.gbti.syndication:v0.1 (by /u/gbti_network)';

async function refreshAccessToken(env, fetchImpl) {
  const basic = btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`);
  const res = await fetchImpl('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: env.REDDIT_REFRESH_TOKEN }).toString(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`reddit token refresh failed (${res.status}); the refresh token may be revoked — re-mint via scripts/reddit-auth.mjs`);
  return body.access_token;
}

export function createRedditAdapter({ env = {}, fetchImpl = globalThis.fetch, cfg = null } = {}) {
  return {
    name: 'reddit',
    enabled() { return secretsPresent(env, 'reddit'); },
    async post(item) {
      // SOW-088 manual syndicate: the rendered template IS the Reddit post title (an already-sanitized
      // override wins). The AUTO rail renders the reddit channel templates (stub-aware for members items;
      // adversarial finding: it previously ignored the template system entirely via buildChannelText).
      const stubish = item.membersOnly === true || String(item.visibility || '') === 'members';
      const autoTitle = cfg ? renderTemplate(templateFor(cfg, item.source, 'reddit', { stub: stubish, channelOnly: true }) || '{title}', item, { limit: channelLimit('reddit') }) : buildChannelText(item, { limit: channelLimit('reddit'), includeUrl: false });
      const title = ((typeof item.textOverride === 'string' && item.textOverride.trim()) ? item.textOverride : autoTitle).slice(0, channelLimit('reddit'));
      let token;
      try { token = await refreshAccessToken(env, fetchImpl); }
      catch (err) { return { ok: false, error: err.message }; }
      const params = { sr: String(env.REDDIT_SUBREDDIT || ''), title, api_type: 'json', resubmit: 'true' };
      // Radle-style post kinds: an explicit item.redditKind wins ('self' = a text post whose body is the
      // Worker-rendered item.bodyText); the default stays a LINK post. Reddit's /api/submit DOES accept
      // body text on kind=link (field-proven 2026-07-10 by post 1u35tf7, selftext stored on the link post;
      // the earlier body-less test was a stale-extension-background miss, not an API limit), so the body
      // rides natively on the post instead of a first comment.
      const autoBody = (!item.bodyText && cfg) ? renderTemplate(templateFor(cfg, 'reddit-body', 'reddit', { stub: stubish }) || '', item, { limit: 9500 }) : '';
      const bodyText = String(item.bodyText || autoBody || '');
      const self = item.redditKind === 'self' || !item.url; // no url can never be a link post
      if (self) { params.kind = 'self'; params.text = bodyText || String(item.url || ''); }
      else { params.kind = 'link'; params.url = String(item.url); if (bodyText) params.text = bodyText; }
      const res = await fetchImpl('https://oauth.reddit.com/api/submit', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body: new URLSearchParams(params).toString(),
      });
      if (res.status === 429) return { ok: false, error: 'reddit 429 (rate limited)' };
      const body = await res.json().catch(() => ({}));
      const errors = body?.json?.errors;
      if (!res.ok || (Array.isArray(errors) && errors.length)) {
        const first = Array.isArray(errors) && errors.length ? errors[0].join(' ') : `status ${res.status}`;
        return { ok: false, error: `reddit ${first}`.slice(0, 160) };
      }
      const id = body?.json?.data?.id || body?.json?.data?.name || null;
      const url = body?.json?.data?.url || null;
      const out = { ok: true, id, url };
      // The separately-templated FIRST COMMENT (owner-directed: independent of the post body/description).
      // Fail-soft: a comment miss never un-sends the post; the result surfaces it.
      // The AUTO rail renders the stored `reddit-comment` template from cfg exactly as the title (line 42)
      // and body (line 53) do; only the MANUAL rail pre-renders item.commentText. Without this fallback the
      // auto rail could never post a first comment at all, because nothing but membership-syndicate-now.mjs
      // ever sets commentText.
      // sow-180: a SHARE is someone else's link, so it never AUTO-renders the member-crediting reddit-comment
      // (that first comment credits the poster and pitches following them, which is member credit on a share).
      // A superadmin-provided item.commentText still posts (a deliberate manual choice); only the automatic
      // default is suppressed for shares. This closes the drain + Social-Queue + manual-without-template paths.
      const autoComment = (!item.commentText && cfg && item.source !== 'share')
        ? renderTemplate(templateFor(cfg, 'reddit-comment', 'reddit', { stub: stubish }) || '', item, { limit: 9500 })
        : '';
      const commentText = String(item.commentText || autoComment || '').trim();
      if (commentText && id) {
        const thing = String(body?.json?.data?.name || (String(id).startsWith('t3_') ? id : `t3_${id}`));
        try {
          const cRes = await fetchImpl('https://oauth.reddit.com/api/comment', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
            body: new URLSearchParams({ api_type: 'json', thing_id: thing, text: commentText }).toString(),
          });
          const cBody = await cRes.json().catch(() => ({}));
          const cErrors = cBody?.json?.errors;
          out.comment = (cRes.ok && !(Array.isArray(cErrors) && cErrors.length))
            ? { id: cBody?.json?.data?.things?.[0]?.data?.id ?? null }
            : { error: `reddit comment ${Array.isArray(cErrors) && cErrors.length ? cErrors[0].join(' ') : `status ${cRes.status}`}`.slice(0, 160) };
        } catch (err) {
          out.comment = { error: (err?.message || 'reddit comment failed').slice(0, 160) };
        }
      }
      return out;
    },
  };
}
