import { findTemplate } from './templates';
import type { NewFileData } from './types';

// Same constraints as the UI (Figma: "Input validation & constraints"). The UI
// already enforces them; this is a safety net so the plugin never acts on bad data.
export const LIMITS = { name: { min: 3, max: 80 }, description: 120, contributors: 60, product: 30 };

export const cleanText = (value: unknown, max: number) =>
  String(value ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

// Canonical GitHub issue URL, "" when empty, or null when it isn't an issue link.
export function cleanGithubIssueUrl(value: unknown): string | null {
  const text = String(value ?? '').replace(/\s+/g, '');
  if (!text) return '';
  const match = text.match(
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/(\d+)(?:[/?#].*)?$/i,
  );
  return match ? `https://github.com/${match[1]}/${match[2]}/issues/${match[3]}` : null;
}

// Returns sanitized data, or an error message if it can't be used.
export function sanitize(data: NewFileData): NewFileData | string {
  const template = findTemplate(data.fileType);
  if (!template) return 'Unknown file type';
  const name = cleanText(data.name, LIMITS.name.max);
  if (name.length < LIMITS.name.min) return `Name needs at least ${LIMITS.name.min} characters`;

  // Only keep the fields this template shows.
  const has = (field: (typeof template.fields)[number]) => template.fields.includes(field);
  const clean: NewFileData = {
    fileType: template.id,
    name,
    externallyAccessible: has('externalAccess') && data.externallyAccessible === true,
  };
  if (has('description') && data.description !== undefined) {
    clean.description = cleanText(data.description, LIMITS.description);
  }
  if (has('contributors') && data.contributors !== undefined) {
    clean.contributors = cleanText(data.contributors, LIMITS.contributors);
  }
  if (has('githubIssueUrl') && data.githubIssueUrl !== undefined) {
    const url = cleanGithubIssueUrl(data.githubIssueUrl);
    if (url === null) return 'GitHub issue URL is not a valid issue link';
    clean.githubIssueUrl = url;
  }
  if (has('products') && Array.isArray(data.products)) {
    clean.products = data.products.map((product) => cleanText(product, LIMITS.product)).filter(Boolean);
  }
  return clean;
}
