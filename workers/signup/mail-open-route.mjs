// The digest open counter, the IO half. Rules live in membership/mail-open.mjs.
//
//   GET /o/<issueId>  ->  a 1x1 transparent gif, and one open counted against that frozen issue
//
// THE PIXEL MUST RETURN EVEN WHEN COUNTING FAILS. It is an image in someone's inbox; whether it renders cannot
// depend on our KV being reachable or the write succeeding. So every path returns the gif and the counting is
// best-effort around it, exactly like the /c/ click route returns a redirect no matter what.
import { parseOpenPath, isIssueIdShape, openKey, applyOpen, TRANSPARENT_GIF_BASE64 } from '../../membership/mail-open.mjs';

function pixel() {
  const bin = atob(TRANSPARENT_GIF_BASE64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      // Never cached: a cached pixel is fetched once and shown many times, and the fetch is the whole signal.
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

export async function handleMailOpen(request, env, { now = Date.now } = {}) {
  const parsed = parseOpenPath(new URL(request.url).pathname);
  const kv = env?.SIGNUP_KV;

  // Count only a well-shaped issue id, so /o/<garbage> renders the pixel but never writes a junk key.
  if (kv && parsed && isIssueIdShape(parsed.issueId)) {
    try {
      const key = openKey(parsed.issueId);
      const current = await kv.get(key, 'json');
      const next = applyOpen(current ?? { issueId: parsed.issueId }, { now });
      next.issueId = parsed.issueId;
      await kv.put(key, JSON.stringify(next));
    } catch { /* an open count is never allowed to cost the pixel */ }
  }

  return pixel();
}
