// Placeholders in template texts (file name, page and layer names), named after
// the form's fields: [Product], and the name field by its label in that
// template, e.g. [Title], [Project name] or [Feature name].

import type { TemplateDef } from './templates';
import type { NewFileData } from './types';

const PLACEHOLDER = /\[([^\]]+)\]/g;
const key = (label: string) => label.trim().toLowerCase();

/** The placeholders a template can use, e.g. ["[Project name]", "[Product]"]. */
export const placeholdersOf = (template: Pick<TemplateDef, 'thumbnailTitleLabel'>) => [
  `[${template.thumbnailTitleLabel}]`,
  '[Product]',
];

function values(template: TemplateDef, data: NewFileData) {
  const products = data.products ?? [];
  return new Map([
    [key(template.thumbnailTitleLabel), data.name],
    // Only a single product goes into names; with several, it's left out.
    ['product', products.length === 1 ? products[0] : ''],
  ]);
}

/** Replaces the placeholders in `text`; anything else in brackets stays as it is. */
export function interpolate(text: string, template: TemplateDef, data: NewFileData) {
  const known = values(template, data);
  return text.replace(PLACEHOLDER, (match, label: string) => known.get(key(label)) ?? match);
}

/** Bracketed parts of `text` that aren't placeholders of the template, e.g. a typo like [Prodcut]. */
export function unknownPlaceholders(text: string, template: Pick<TemplateDef, 'thumbnailTitleLabel'>) {
  const known = placeholdersOf(template).map((p) => key(p.slice(1, -1)));
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[0]).filter((p) => !known.includes(key(p.slice(1, -1))));
}

// Separators left dangling by an empty placeholder, e.g. " - Deposit invoices" without a product.
const SEPARATOR = '[-–—|·/:]';
const EDGES = new RegExp(`^(?:\\s|${SEPARATOR})+|(?:\\s|${SEPARATOR})+$`, 'g');
const REPEATED = new RegExp(`\\s*(${SEPARATOR})(?:\\s*${SEPARATOR})+\\s*`, 'g');

/** The suggested file name: the template's fileName with placeholders filled and empty parts removed. */
export function fileNameFor(template: TemplateDef, data: NewFileData) {
  const pattern = template.fileName || `[${template.thumbnailTitleLabel}]`;
  return interpolate(pattern, template, data).replace(REPEATED, ' $1 ').replace(EDGES, '').replace(/\s+/g, ' ') || data.name;
}
