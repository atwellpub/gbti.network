// Per-type form field descriptors for the CMS Author pane (SOW-006). The UI renders the right inputs per
// content type instead of a raw JSON box. These MIRROR client/src/schemas.mjs (the canonical zod copy) and
// are drift-tested against it (test/client-forms.test.mjs asserts every field key is a real schema key, and
// that the system-managed / forced fields are never offered). Field `kind` tells the UI how to render +
// serialize the value:
//   text | textarea | enum | array (comma-separated -> string[]) | boolean | number | date | image | json
// `json` is for nested objects (e.g. product/profile links) entered as a small JSON blob.

import { IMAGE_GEN_MODELS } from './image-models.mjs';

const f = (key, label, kind, extra = {}) => ({ key, label, kind, ...extra });

const STATUS = f('status', 'Status', 'enum', { options: ['draft', 'published'] });
const VISIBILITY = f('visibility', 'Visibility', 'enum', { options: ['public', 'members'] });
const TAGS = f('tags', 'Tags', 'array', { placeholder: 'comma,separated' });

export const FIELDS = Object.freeze({
  post: [
    f('title', 'Title', 'text', { required: true }),
    f('slug', 'Slug', 'text', { required: true, placeholder: 'kebab-case' }),
    STATUS, VISIBILITY,
    f('publicStub', 'Public stub (when members-only)', 'boolean'), // SOW-016: true = a public stub page; false = no public page
    f('excerpt', 'Excerpt', 'textarea'),
    f('categories', 'Categories', 'array'),
    TAGS,
    f('coverImage', 'Cover image', 'image'),
    f('coverAlt', 'Cover image alt text', 'text', { placeholder: 'Describe the image for screen readers' }),
    f('video', 'Video (YouTube/Vimeo URL)', 'text'),
    f('featured', 'Featured', 'boolean'),
    f('publishedAt', 'Published at', 'date'),
    f('canonicalUrl', 'Canonical URL', 'text'),
  ],
  product: [
    f('title', 'Title', 'text', { required: true }),
    f('slug', 'Slug', 'text', { required: true, placeholder: 'kebab-case' }),
    f('shortDescription', 'Short description', 'textarea', { required: true }),
    f('categories', 'Categories', 'array', { placeholder: 'devops, frameworks, wordpress' }),
    STATUS, VISIBILITY,
    f('publicStub', 'Public stub (when members-only)', 'boolean'), // SOW-016
    f('pricing', 'Pricing', 'enum', { options: ['free', 'freemium', 'paid'] }),
    f('pricingUrl', 'Pricing/upgrade URL', 'text'),
    f('version', 'Version', 'text'),
    TAGS,
    f('platforms', 'Platforms', 'array'),
    // Per-field aspect ratios, taken from what each render surface actually asks for rather than one shared
    // 4:3/Hero toggle. `frame` locks the editor preview so it cannot misrepresent the crop. Icon is square and
    // small, so it also carries the two real display sizes.
    f('icon', 'Icon (small, 1:1)', 'image', { required: true, frame: '1/1', previewPx: 96, hint: 'Square. Rendered at 56 on cards and 96 on the product page. 128x128 or larger.' }),
    f('iconLarge', 'Icon (large, 1:1)', 'image', { frame: '1/1', previewPx: 96, hint: 'Optional crisper square for the 96px product-page slot on high-density screens. 192x192 or 256x256.' }),
    f('featuredImage', 'Featured cover (spotlight)', 'image', { required: true, frame: '16/10', hint: 'Must be 16:10 (1280x800). The spotlight box is locked to 16:10, so it fills without cropping.' }),
    f('banner', 'Banner', 'image', { frame: '3/1', hint: 'Wide 3:1 strip across the top of the product page (rendered 1200x400, cropped to fill).' }),
    f('gallery', 'Gallery (screenshots)', 'array', { placeholder: 'image1.png, image2.png' }),
    f('video', 'Video (YouTube/Vimeo URL)', 'text'),
    f('links', 'Links (JSON array: {type,url,visibility:public|members,primary,label})', 'json'),
    f('publishedAt', 'Published at', 'date'),
  ],
  prompt: [
    f('title', 'Title', 'text', { required: true }),
    f('slug', 'Slug', 'text', { required: true, placeholder: 'kebab-case' }),
    f('shortDescription', 'Short description', 'textarea', { required: true }), // SOW-025: required by the schema (one-liner on cards + the feed)
    f('categories', 'Categories', 'array', { placeholder: 'devops, accessibility' }),
    STATUS, VISIBILITY,
    f('publicStub', 'Public stub (when members-only)', 'boolean'), // SOW-016
    f('pricing', 'Pricing', 'enum', { options: ['free', 'freemium', 'paid'] }),
    f('targets', 'Targets (models/tools)', 'array'),
    TAGS,
    f('variables', 'Variables', 'array'),
    f('exampleOutput', 'Example output', 'textarea'),
    // Result image: shown ONLY when a target is an image generator (Nano Banana, MidJourney, etc.). The
    // `showIf` is serializable data the form renderer evaluates live as the targets field changes; the
    // schema + content validator enforce the same rule server-side.
    f('image', 'Result image (image-gen models, recommended 4:3)', 'image', { placeholder: '1200x900 (4:3) crops cleanest', showIf: { field: 'targets', includesModel: IMAGE_GEN_MODELS } }),
    f('sourceUrl', 'Source URL', 'text'),
    f('links', 'Links (JSON array: {type,url,visibility:public|members,primary,label})', 'json'),
    f('publishedAt', 'Published at', 'date'),
  ],
  profile: [
    f('displayName', 'Display name', 'text', { required: true }),
    STATUS, VISIBILITY,
    f('headline', 'Headline', 'text'),
    f('avatar', 'Avatar', 'image'),
    f('location', 'Location', 'text'),
    f('forHire', 'For hire', 'boolean'),
    f('directory', 'List in member directory', 'boolean'),
    f('skills', 'Skills', 'array'),
    f('roles', 'Roles', 'array'),
    f('links', 'Links (JSON: github/website/x/linkedin/…)', 'json'),
  ],
});

export function fieldsFor(type) {
  return FIELDS[type] ?? null;
}
