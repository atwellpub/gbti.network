// Canonical taxonomy access (SOW-012). Loads house/taxonomy.yml once and exposes label/path helpers
// shared by every content type (posts, products, prompts). The same tree validates `categories` in
// scripts/validate-content.mjs, so the site and CI never disagree on what a valid category is.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { topicVocabList, topicVocabLabel } from '../../membership/topics-vocab.mjs';

interface TaxNode {
  label: string;
  children?: Record<string, TaxNode>;
}
interface TaxFile {
  tree: Record<string, TaxNode>;
}

const file = path.resolve(process.cwd(), 'house/taxonomy.yml');
const TREE: Record<string, TaxNode> = (yaml.load(fs.readFileSync(file, 'utf8')) as TaxFile)?.tree ?? {};

// Flat key -> label map (keys are unique across the tree).
const LABELS: Record<string, string> = {};
(function walk(nodes: Record<string, TaxNode>) {
  for (const [key, node] of Object.entries(nodes)) {
    LABELS[key] = node.label ?? key;
    if (node.children) walk(node.children);
  }
})(TREE);

/** sow-169: the flat key -> label map, exported so a client-rendered surface (the WorkBench preview) can
 *  serialize it and show the SAME words the built page does, instead of a raw slug. */
export const CATEGORY_LABELS: Readonly<Record<string, string>> = LABELS;

/** Display label for a single category key (falls back to the key). */
export function categoryLabel(key: string): string {
  return LABELS[key] ?? key;
}

/** The most specific (leaf) label for a category path, e.g. ["devops","accessibility"] -> "Accessibility". */
export function leafLabel(pathArr: string[] | undefined): string {
  if (!pathArr?.length) return '';
  return categoryLabel(pathArr[pathArr.length - 1]);
}

/** Breadcrumb labels for a path, e.g. ["devops","frameworks","wordpress"] -> ["DevOps","Frameworks","WordPress"]. */
export function breadcrumb(pathArr: string[] | undefined): string[] {
  return (pathArr ?? []).map(categoryLabel);
}

/** The top-level key of a path (used for grouping + directory filters), or '' if uncategorized. */
export function topKey(pathArr: string[] | undefined): string {
  return pathArr?.[0] ?? '';
}

/** Distinct top-level categories present across a set of paths, as {key,label}, sorted by label. */
export function topLevelCategories(paths: (string[] | undefined)[]): { key: string; label: string }[] {
  const keys = [...new Set(paths.map((p) => p?.[0]).filter((k): k is string => !!k))];
  return keys.map((k) => ({ key: k, label: categoryLabel(k) })).sort((a, b) => a.label.localeCompare(b.label));
}

/** True if a category path exists in the tree (each segment a child of the previous). Empty = allowed. */
export function isValidPath(pathArr: string[] | undefined): boolean {
  if (!pathArr?.length) return true;
  let level: Record<string, TaxNode> | undefined = TREE;
  for (const seg of pathArr) {
    if (!level || !level[seg]) return false;
    level = level[seg].children;
  }
  return true;
}

export const TAXONOMY_TREE = TREE;

// SOW-080: the followed-topic vocabulary is now a flat, git-native file (house/topics.yml) DECOUPLED from the content
// taxonomy, so it can grow to ~50 follow topics without re-tagging content. Loaded once; the pure parser lives in
// membership/topics-vocab.mjs (shared with the Worker + node tests).
const topicsFile = path.resolve(process.cwd(), 'house/topics.yml');
let TOPICS_PARSED: unknown = {};
try {
  TOPICS_PARSED = yaml.load(fs.readFileSync(topicsFile, 'utf8'));
} catch {
  TOPICS_PARSED = {};
}

/** SOW-054/SOW-080: the followed-topic vocabulary as {key,label,group?}, sorted by label. Drives the browse
 *  drill-down and (via house/topic-map.yml) the news default. */
export function topicList(): { key: string; label: string; group?: string }[] {
  return topicVocabList(TOPICS_PARSED);
}

/** Display label for a followed-topic key; falls back to a Title-Cased key. */
export function topicLabel(key: string): string {
  return topicVocabLabel(TOPICS_PARSED, key);
}
