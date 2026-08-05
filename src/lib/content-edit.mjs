// sow-183: whether a signed-in identity may see a content-detail page's Edit affordance -- they own the item,
// or they are superadmin. Presentation only, matching every other use of the member signal (member-signal.ts):
// the SOW-005 gate (member content) and the Worker's authorizeSuperadmin (house / cross-folder content) are the
// real boundaries on publish, so a false positive here only offers a link, never a write.
//
// Node-free (no Astro types, no DOM) so it stays node --test-covered; relocated out of product-page.mjs (which
// used to be its only caller) now that every content-detail page (post/product/prompt) needs it, not just
// products.
export function canEditItem(identity, owner) {
  if (!identity) return false;
  if (identity.role === 'superadmin') return true;
  return !!identity.login && !!owner && identity.login.toLowerCase() === String(owner).toLowerCase();
}
