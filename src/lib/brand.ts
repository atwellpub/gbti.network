// The canonical short brand name, used wherever the site names itself to the outside world (page titles and
// the og:site_name / og:title that drive link unfurls). sow-178 dropped the definite article ("The GBTI
// Network" -> "GBTI Network") and made this the single source of truth so a second hardcoded copy cannot drift
// out of sync again. This is the short form already used elsewhere (src/lib/authors.ts, src/lib/extension.ts,
// src/lib/share.ts); those may route through here in a future consolidation.
export const SITE_NAME = 'GBTI Network';
