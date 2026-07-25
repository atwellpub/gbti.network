// SOW-019: Chrome extension distribution config, single-sourced for the site. The Web Store URL is the
// primary install path once the M0 store submission lands; until then the site falls back to the direct zip
// built by `npm run build:extension` (committed under public/extension/). The site detects an installed
// extension via the content-script marker (document.documentElement.dataset.gbtiExtension); see SOW-019.
export const EXTENSION = {
  name: 'GBTI Network',
  /** Mirrors public/extension/latest.json (written by `npm run build:extension`). */
  version: '0.2.0',
  /** Set to the Chrome Web Store listing URL after the M0 submission. Empty = fall back to the install page. */
  webStoreUrl: 'https://chromewebstore.google.com/detail/gbti-network-extension/iffjdmifgnjgkdjoodapjciddibmifka',
  /** The install/download page that hosts the download button + the unpacked-install guide. */
  pageUrl: '/extension/',
  /** Direct download of the current build (served from the static site). */
  zipUrl: '/extension/gbti-network-extension.zip',
} as const;

/** Primary "get the extension" link: the Web Store if published, else the install page (zip + how-to). */
export const extensionInstallUrl: string = EXTENSION.webStoreUrl || EXTENSION.pageUrl;
/** Direct zip download, used by the install page's download button. */
export const extensionZipUrl: string = EXTENSION.zipUrl;
/** True once the extension is on the Chrome Web Store (a one-click install); false while only the zip exists. */
export const extensionIsListed: boolean = Boolean(EXTENSION.webStoreUrl);
