// How the file's thumbnail page and its "OLD Thumbnail" section are recognised. Used by
// Create (cleaning up old thumbnail pages) and the experimental "Fill project team".

import { nameForMatching } from './name-matching';

/** The section Create moves an old thumbnail page's content into. */
export const OLD_THUMBNAIL_SECTION = 'OLD Thumbnail';

/**
 * Thumbnail pages are recognised by name only (whatever is on them): "thumbnail" or
 * "cover", matched like other names (ignoring capitals, emojis, symbols, punctuation
 * and spacing), e.g. "📷  Thumbnail" or "🖼 Cover".
 */
const THUMBNAIL_PAGE_NAMES = ['thumbnail', 'cover'];
export const isThumbnailPageName = (name: string) => THUMBNAIL_PAGE_NAMES.includes(nameForMatching(name));

/** The file's thumbnail pages (see isThumbnailPageName), in page order. */
export const thumbnailPages = () => figma.root.children.filter((page) => isThumbnailPageName(page.name));

/** Whether `node` is an "OLD Thumbnail" section, as Create makes them. */
export const isOldThumbnailSection = (node: BaseNode): node is SectionNode =>
  node.type === 'SECTION' && node.name === OLD_THUMBNAIL_SECTION;
