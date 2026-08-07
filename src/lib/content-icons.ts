// sow-192: the STANDARD content-type icon (an IconSprite `#ico-*` id) shown beside a type label, e.g. the
// Popular rail chips. One source of truth so every surface uses the same mark. Decisions recorded in
// .data/ops/design-ops/icons.md. Prompt + Skill share the robot to match the homepage prompt card.
export const CONTENT_ICON: Record<string, string> = {
  article: 'ico-pencil',
  post: 'ico-pencil',
  product: 'ico-box',
  prompt: 'ico-bot',
  skill: 'ico-bot',
  fun: 'ico-bot',
  share: 'ico-link',
  news: 'ico-mega',
};

/** The sprite id for a content kind, falling back to a neutral spark for anything unmapped. */
export function contentIcon(kind: string | undefined): string {
  return (kind && CONTENT_ICON[kind]) || 'ico-spark';
}
