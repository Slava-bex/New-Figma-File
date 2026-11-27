// Values from the file's old cover to pre-fill the form with (experimental, see
// index.ts): its title, contributors, product(s) and GitHub issue link. The old cover is
// what's in the "OLD Thumbnail" sections on the thumbnail page, or before Create has
// cleaned up the file, the thumbnail page's content if it has no current thumbnail (what
// Create would move into "OLD Thumbnail"). Hidden layers don't count.
//
// Each value is read on its own, and only kept when it passes the form's own checks, so
// pre-filling never shows a validation message. A value that can't be read is left
// out without a warning; only the developer console says why.

import { findInstances, GITHUB_LINK, PRODUCT, THUMBNAIL, variantValue } from '../../library';
import { nameForMatching } from '../../name-matching';
import { cleanGithubIssueUrl, cleanText, LIMITS } from '../../sanitize';
import { isOldThumbnailSection, thumbnailPages } from '../../thumbnail-page';
import { OLD_FILE_TYPE_BADGE, PROJECT_INFO } from './components';
import { splitNames } from './match-people';
import { thumbnailPageWithOldCover } from './old-cover-detection';
import { contributorsTexts, findByKeyOrName, isVisibleWithin } from './sources';

export interface OldCoverValues {
  /** For the form's title field, whatever the template calls it (Project name, Feature name…). */
  name?: string;
  /** As written on the old thumbnail, e.g. "Tom, Mustafa". */
  contributors?: string;
  /** As on the old cover, e.g. ["PMS"]; the form ticks the products it knows. */
  products?: string[];
  githubIssueUrl?: string;
  /** Only with `trace`: where the product came from, one short line per candidate (for the debug box). */
  productTrace?: string[];
}

// The product candidates looked at, when tracing (see readOldCoverValues).
let productTrace: string[] | null = null;

/** The old cover's values (see above); none without an old cover. `trace`: also say where the product came from. */
export async function readOldCoverValues(trace = false): Promise<OldCoverValues> {
  const values: OldCoverValues = {};
  let old: SceneNode[] = [];
  try {
    old = await oldCoverLayers();
  } catch (error) {
    console.warn("Couldn't find the old cover", error);
  }
  if (old.length === 0) return values;

  async function read<K extends keyof OldCoverValues>(field: K, reader: () => Promise<OldCoverValues[K]> | OldCoverValues[K]) {
    try {
      const value = await reader();
      if (value !== undefined) values[field] = value;
    } catch (error) {
      console.warn(`Couldn't read the old cover's ${field}`, error);
    }
  }
  await read('name', () => oldTitle(old));
  await read('contributors', () => oldContributors(old));
  productTrace = trace ? [] : null;
  await read('products', () => oldProducts(old));
  if (productTrace) values.productTrace = productTrace;
  productTrace = null;
  await read('githubIssueUrl', () => oldGithubIssueUrl(old));
  return values;
}

/**
 * The old cover's top-level layers: the "OLD Thumbnail" sections on the thumbnail page,
 * or else the first thumbnail page's content, unless it has a current thumbnail (then
 * it isn't old, as Create sees it too).
 */
async function oldCoverLayers(): Promise<SceneNode[]> {
  const cleanedUp = await thumbnailPageWithOldCover();
  if (cleanedUp) return cleanedUp.children.filter(isOldThumbnailSection);
  for (const page of thumbnailPages()) {
    await page.loadAsync();
    if (page.children.length === 0) continue;
    for (const node of page.children) if ((await findInstances(node, THUMBNAIL)).length) return [];
    return [...page.children];
  }
  return [];
}

/** Unfilled defaults of old covers' titles. */
const DEFAULT_TITLES = ['naamdocument', 'documentname', 'title', 'titel', 'maintitle'];

/** `text` as a title, if it passes the form's title checks and isn't an unfilled default ("Naam document", "[Title]"). */
function asTitle(text: string): string | undefined {
  const title = cleanText(text, Infinity);
  if (DEFAULT_TITLES.includes(nameForMatching(title)) || /^\[.*\]$/.test(title)) return undefined;
  return title.length >= LIMITS.name.min && title.length <= LIMITS.name.max ? title : undefined;
}

/** Names of older covers' title text layers (matched loosely); "Section Title" isn't one. */
const TITLE_LAYERS = ['maintitle', 'title', 'naamdocument', 'documentname'];

/**
 * The old cover's title: an earlier version of the current thumbnail's Title property,
 * or else an older cover's title text: a layer named like "Main Title" or "Naam
 * document", or the text directly in a "Title" layer. Texts in status badges ("Project
 * Status": "Discovery") don't count, and the text in the fewest nested instances wins
 * (the cover's own title, not one inside a badge).
 */
async function oldTitle(old: SceneNode[]): Promise<string | undefined> {
  for (const root of old) {
    for (const thumbnail of await findInstances(root, THUMBNAIL)) {
      const title = isVisibleWithin(thumbnail, root) ? textProperty(thumbnail, THUMBNAIL.properties.title) : undefined;
      const found = title ? asTitle(title) : undefined;
      if (found) return found;
    }
  }
  const candidates: { text: string; depth: number }[] = [];
  for (const root of old) {
    const texts = root.type === 'TEXT' ? [root] : 'findAllWithCriteria' in root ? root.findAllWithCriteria({ types: ['TEXT'] }) : [];
    for (const text of texts) {
      const isTitle = TITLE_LAYERS.includes(nameForMatching(text.name)) || (text.parent && nameForMatching(text.parent.name) === 'title');
      if (!isTitle || !isVisibleWithin(text, root)) continue;
      const instances = instancesAround(text, root);
      if (instances.some((instance) => nameForMatching(instance.name).includes('status'))) continue;
      candidates.push({ text: text.characters, depth: instances.length });
    }
  }
  // Fewest nested instances first; otherwise in layer order (the sort keeps it).
  for (const { text } of candidates.sort((a, b) => a.depth - b.depth)) {
    const title = asTitle(text);
    if (title) return title;
  }
  return undefined;
}

/** The instances `node` is nested in, up to `root`. */
function instancesAround(node: SceneNode, root: BaseNode): InstanceNode[] {
  const instances: InstanceNode[] = [];
  for (let current = node.parent; current && current.id !== root.id; current = current.parent) {
    if (current.type === 'INSTANCE') instances.push(current);
  }
  return instances;
}

/** The old thumbnail's contributors as written ("Tom, Mustafa"), if they fit the form's field. */
function oldContributors(old: SceneNode[]): string | undefined {
  const [text] = contributorsTexts(old);
  const names = text ? splitNames(text).join(', ') : '';
  return names && names.length <= LIMITS.contributors ? names : undefined;
}

/**
 * The old cover's product(s): an earlier version of the current thumbnail's product
 * pill (its product, or a "Custom" one's names), or else an older thumbnail's file type
 * badge (its "App", e.g. "PMS").
 */
async function oldProducts(old: SceneNode[]): Promise<string[] | undefined> {
  const trace = (line: string) => productTrace?.push(line);
  for (const root of old) {
    for (const pill of await findInstances(root, PRODUCT)) {
      if (!isVisibleWithin(pill, root)) {
        trace('pill: hidden');
        continue;
      }
      const product = await variantValue(pill, PRODUCT.properties.product);
      const names = product === 'Custom' ? textProperty(pill, PRODUCT.properties.customName) : product;
      trace(`pill: ${product === 'Custom' ? `Custom "${names ?? '?'}"` : (product ?? 'no Product variant')}`);
      if (typeof names !== 'string' || names === 'None') continue;
      const products = names.split(',').map((name) => name.trim()).filter(Boolean);
      if (products.length) return products;
    }
  }
  for (const root of old) {
    for (const badge of await findByKeyOrName(root, OLD_FILE_TYPE_BADGE)) {
      if (!isVisibleWithin(badge, root)) {
        trace('badge: hidden');
        continue;
      }
      const app = await variantValue(badge, 'App');
      trace(`badge: ${app ? `App=${app}` : 'no App variant'}`);
      if (app) return [app];
    }
  }
  trace('no product pill or badge with a product');
  return undefined;
}

/**
 * The GitHub issue link of an old Project Info (any version): from the first Project
 * Link set to Source=GitHub that has one, as its link (or its text).
 */
async function oldGithubIssueUrl(old: SceneNode[]): Promise<string | undefined> {
  for (const root of old) {
    for (const info of await findInstances(root, PROJECT_INFO)) {
      if (!isVisibleWithin(info, root)) continue;
      for (const link of await findInstances(info, GITHUB_LINK)) {
        if (!isVisibleWithin(link, info) || (await variantValue(link, GITHUB_LINK.properties.source)) !== 'GitHub') continue;
        for (const text of link.findAllWithCriteria({ types: ['TEXT'] })) {
          if (!isVisibleWithin(text, link)) continue;
          for (const candidate of [hyperlinkOf(text), text.characters]) {
            const url = candidate ? cleanGithubIssueUrl(candidate) : null;
            if (url) return url;
          }
        }
      }
    }
  }
  return undefined;
}

/**
 * A text property's value by its id ("829:1" for "Title#829:1"). Variants are read with
 * variantValue instead. Undefined if Figma can't read the instance's properties (a
 * component set with errors), so a broken component never stops the reading.
 */
function textProperty(instance: InstanceNode, id: string): string | undefined {
  try {
    const entry = Object.entries(instance.componentProperties).find(([key]) => key.endsWith(`#${id}`));
    return typeof entry?.[1].value === 'string' ? entry[1].value : undefined;
  } catch (error) {
    console.warn(`Couldn't read "${instance.name}"'s properties`, error);
    return undefined;
  }
}

/** A text's link (its first character's, if parts link to different places). */
function hyperlinkOf(text: TextNode): string | null {
  const link = text.hyperlink === figma.mixed && text.characters.length > 0 ? text.getRangeHyperlink(0, 1) : text.hyperlink;
  return link && link !== figma.mixed && link.type === 'URL' ? link.value : null;
}
