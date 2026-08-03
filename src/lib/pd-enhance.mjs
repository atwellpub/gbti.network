// sow-172: the two behaviours the product "Doc Shell" layout adds on top of static markup.
//
// Shared rather than inlined in the page because TWO routes render this layout: the published product page
// and the WorkBench draft preview, which builds the same structure at runtime. One implementation, so the
// preview's contents rail and carousel behave exactly like the page it is previewing.
//
// Both are progressive enhancement. Without them the contents list is still a working set of anchor links
// and the carousel is still a swipeable scroll-snap strip; only the highlighting and the arrows are lost.

/**
 * Contents scroll-spy: highlight the entry whose section is in the reading band.
 *
 * A narrow band near the top of the viewport decides what counts as "current", so the rail tracks reading
 * position rather than merely the last thing clicked. Entries whose target is missing are skipped rather
 * than assumed, which is what lets the preview reuse this against a partially rendered draft.
 */
export function initToc(root = document) {
  const nav = root.querySelector('[data-pd-toc]');
  if (!nav) return;
  const links = Array.from(nav.querySelectorAll('[data-pd-toc-link]'));
  const targets = links
    .map((a) => ({ a, el: root.getElementById ? root.getElementById(a.dataset.pdTocLink || '') : document.getElementById(a.dataset.pdTocLink || '') }))
    .filter((t) => Boolean(t.el));
  if (!targets.length) return;

  const spy = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        for (const t of targets) t.a.classList.toggle('on', t.el === e.target);
      }
    },
    { rootMargin: '-12% 0px -74% 0px', threshold: 0 },
  );
  for (const t of targets) spy.observe(t.el);
  return () => spy.disconnect();
}

/**
 * Screenshot carousel: arrows, counter, caption swap, filmstrip.
 *
 * The frames are a scroll-snap strip, so swiping and keyboard scrolling already work with no script at all.
 * Position is READ BACK from scrollLeft rather than tracked in a variable, so a swipe and a thumbnail click
 * can never disagree about which shot is showing.
 */
export function initCarousel(root = document) {
  const el = root.querySelector('[data-pd-carousel]');
  if (!el) return;
  const frames = el.querySelector('[data-pd-frames]');
  if (!frames) return;
  const prev = el.querySelector('[data-pd-prev]');
  const next = el.querySelector('[data-pd-next]');
  const count = el.querySelector('[data-pd-count]');
  const cap = el.querySelector('[data-pd-cap]');
  const thumbs = Array.from(el.querySelectorAll('[data-pd-go]'));

  let captions = [];
  try { captions = JSON.parse(el.dataset.captions || '[]'); } catch { captions = []; }

  const total = frames.children.length;
  if (total < 2) return;

  const pad = (n) => String(n).padStart(2, '0');
  const indexNow = () => Math.round(frames.scrollLeft / Math.max(1, frames.clientWidth));

  const sync = () => {
    const i = Math.min(total - 1, Math.max(0, indexNow()));
    if (count) count.textContent = `${pad(i + 1)} / ${pad(total)}`;
    if (cap) cap.textContent = captions[i] || '';
    thumbs.forEach((t, n) => t.setAttribute('aria-current', n === i ? 'true' : 'false'));
    if (prev) prev.hidden = i === 0;
    if (next) next.hidden = i >= total - 1;
  };

  const goTo = (i) => {
    frames.scrollTo({ left: frames.clientWidth * Math.min(total - 1, Math.max(0, i)), behavior: 'smooth' });
  };

  prev?.addEventListener('click', () => goTo(indexNow() - 1));
  next?.addEventListener('click', () => goTo(indexNow() + 1));
  for (const t of thumbs) t.addEventListener('click', () => goTo(Number(t.dataset.pdGo)));

  let raf = 0;
  frames.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(sync);
  });
  window.addEventListener('resize', sync);
  sync(); // reveals the arrows, which ship hidden so they never appear without their behaviour
}

/**
 * Slugify a heading's text the way the contents rail needs it.
 *
 * The published page uses the ids Astro already generated during the markdown build; the preview renders its
 * markdown in the browser with a renderer that emits none, so it stamps its own. They only have to be
 * internally consistent (the link and the target come from the same pass), not to match Astro's algorithm.
 */
export function slugifyHeading(text, taken = new Set()) {
  const base =
    String(text ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section';
  let slug = base;
  let n = 2;
  while (taken.has(slug)) slug = `${base}-${n++}`;
  taken.add(slug);
  return slug;
}
