// sow-174: curated banner-color presets, an alternative to uploading a banner image. Six options only, no
// free color input: every value here already exists as a design token elsewhere (the brand green/amber/ink,
// plus the category colors ProductDirectory.astro already uses for wordpress/ide-plugins/mods), so a choice
// can never land on a public page with poor contrast under the hero's white title or a color that clashes
// with the rest of the site.
//
// The `from` hex values for wordpress/ide-plugins/mods are the exact `--cb` values from ProductDirectory
// .astro's scoped `.c-wp`/`.c-ide`/`.c-mod` styles. That block is page-scoped CSS, not a shared custom
// property, so this file is the one place both sides (the schema's enum and the editor's swatch picker) get
// the same six values from; gbti-v3.css's `.pd-hero[data-preset]` rules restate them as literal hex for the
// same reason (a page-scoped CSS block cannot be `@import`ed).
export const BANNER_PRESETS = [
  { key: 'green', label: 'Green', from: '#1f9e5f', to: '#25232b' },
  { key: 'amber', label: 'Amber', from: '#b57616', to: '#25232b' },
  { key: 'ink', label: 'Ink', from: '#393542', to: '#25232b' }, // today's existing default hero, unchanged
  { key: 'wordpress', label: 'WordPress', from: '#5a8de0', to: '#25232b' },
  { key: 'ide-plugins', label: 'IDE Plugins', from: '#9277d4', to: '#25232b' },
  { key: 'mods', label: 'Mods', from: '#d8a847', to: '#25232b' },
];

export const BANNER_PRESET_KEYS = BANNER_PRESETS.map((p) => p.key);
