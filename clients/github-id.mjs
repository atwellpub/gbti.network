// The ONE definition of "is this a GitHub user id", shared by every layer that has to trust one.
//
// WHY IT LIVES HERE rather than in membership/. Two call sites needed the same rule and briefly had two
// implementations that DISAGREED (one trimmed and accepted "123\n", the other refused it), which is worse than
// either rule on its own: the same value could pass one gate and fail another. Consolidating needed a home that
// neither side owns.
//
// membership/ was the intuitive home and is the wrong one: membership/syndication-adapters.mjs already imports
// clients/, so the established direction is membership -> clients. Putting this in membership/ and importing it
// from clients/stripe.mjs would invert that and create a directory-level cycle. Keeping it inside stripe.mjs
// instead would force anyone wanting a validator to load a REST client. So: a dependency-free leaf in the lower
// layer, which both sides can import without either owning the other. THIS MODULE MUST IMPORT NOTHING, ever.
//
// REJECT, DO NOT CLEAN (SecurityMaster + UnifiedWorker, 2026-08-22). A padded or malformed github_id means
// something upstream is already wrong, and silently trimming it hides that. Returning null is the fail-closed
// answer everywhere this is used: on a membership check it reads as "no such customer", i.e. NOT paid, and as a
// key component it refuses rather than minting a key from a value nobody validated.

/** A GitHub user id as a bare digit string, or null. No sign, no whitespace, no exponent, no padding. */
export function normalizeGithubId(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v);
  // A LENGTH BOUND, which a bare quantifier does not give. This value reaches a query and, elsewhere, a KV key
  // component, so an arbitrarily long digit run must not pass. GitHub ids are far under 20 digits.
  if (s.length < 1 || s.length > 20) return null;
  // A character scan rather than an anchored regex: no anchor semantics to misread. (Note for the record: JS `$`
  // without the `m` flag matches only the true end of input, so /^[0-9]+$/ does NOT accept "123\n". The opposite
  // claim is Perl/PCRE/Python behaviour and was wrong here until 2026-08-22.)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return null;
  }
  return s;
}
