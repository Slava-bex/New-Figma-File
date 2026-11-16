// Captures the current file as a template file (templates/<id>.json), so a
// hand-made template file in Figma becomes a template in the plugin. Only
// behind the CAPTURE flag in code.ts.
//
// What's captured: pages (name, background), and on them sections, frames and
// library component instances, with names, positions, sizes, fills and auto
// layout. Instances that contain the thumbnail (a template's cover) are marked
// "detach", so the frame around the thumbnail is a regular frame and can become
// the file thumbnail. Anything else (text, shapes, groups, instance
// overrides, …) is skipped and listed as a warning.

import { containsInstanceOf, FILLED_COMPONENTS, isInstanceOf, THUMBNAIL } from './library';
import { placeholdersOf, unknownPlaceholders } from './placeholders';
import { type AutoLayout, type ContentItem, type PageDef, type Sizing, type TemplateDef } from './templates';
import { FORM_FIELDS } from './types';

// Used when the template file doesn't say otherwise.
const DEFAULT_TITLE_LABEL = 'Name';
const DEFAULT_TEMPLATE_NAME = 'New file';

// Main design page names, ignoring case and any emoji or spaces in front:
// "Design", or "Concept" optionally followed by ": anything".
const MAIN_DESIGN_PAGE = [/^[^\p{L}\p{N}]*design\s*$/iu, /^[^\p{L}\p{N}]*concept\s*(:.*)?$/iu];

/**
 * The first page after the first divider, if it's called "Design" or "Concept"
 * (see MAIN_DESIGN_PAGE); otherwise "" (no main design page).
 */
function guessMainDesignPage(pages: readonly PageNode[]): string {
  const divider = pages.findIndex((page) => page.isPageDivider);
  if (divider < 0) return '';
  const page = pages.slice(divider + 1).find((p) => !p.isPageDivider);
  return page && MAIN_DESIGN_PAGE.some((pattern) => pattern.test(page.name.trim())) ? page.name : '';
}

/** A boolean property's value on an instance, by the property's id; undefined if it has none. */
function booleanProperty(instance: InstanceNode, id: string): boolean | undefined {
  const entry = Object.entries(instance.componentProperties).find(([key]) => key.endsWith(`#${id}`));
  return typeof entry?.[1].value === 'boolean' ? entry[1].value : undefined;
}

/** A text property's value on an instance, by the property's id (see src/library.ts). */
function textProperty(instance: InstanceNode, id: string): string {
  const entry = Object.entries(instance.componentProperties).find(([key]) => key.endsWith(`#${id}`));
  return typeof entry?.[1].value === 'string' ? entry[1].value.trim() : '';
}

export interface CaptureResult {
  json: string;
  /** Suggested JSON file name in templates/, from the template's name. */
  saveAs: string;
  warnings: string[];
  pages: number;
  items: number;
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'new-template';

const round = (n: number) => Math.round(n * 100) / 100;

function hex(color: RGB) {
  const channel = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return `#${channel(color.r)}${channel(color.g)}${channel(color.b)}`.toUpperCase();
}

export async function captureFile(): Promise<CaptureResult> {
  const warnings: string[] = [];
  let items = 0;


  /** "#RRGGBB" or "none" for a node's fills. */
  function fillOf(node: MinimalFillsMixin, where: string): string {
    const fills = node.fills === figma.mixed ? [] : node.fills.filter((paint) => paint.visible !== false);
    if (fills.length === 0) return 'none';
    const solid = fills.find((paint): paint is SolidPaint => paint.type === 'SOLID');
    if (!solid) {
      warnings.push(`${where}: fill isn't a solid color, captured as none`);
      return 'none';
    }
    if (fills.length > 1 || (solid.opacity ?? 1) < 1) warnings.push(`${where}: only the first solid color of its fill is captured`);
    return hex(solid.color);
  }

  /** Hug/fill sizing and absolute positioning, for nodes that have them. */
  function layoutOf(node: SceneNode, inAutoLayout: boolean) {
    const result: Pick<ContentItem, 'sizing' | 'absolute'> = {};
    if (!('layoutSizingHorizontal' in node)) return result;
    const sizing: { width?: Sizing; height?: Sizing } = {};
    const own = node.type === 'FRAME' && node.layoutMode !== 'NONE';
    const read = (value: 'FIXED' | 'HUG' | 'FILL') =>
      value === 'FILL' && inAutoLayout ? 'fill' : value === 'HUG' && (own || inAutoLayout) ? 'hug' : undefined;
    const width = read(node.layoutSizingHorizontal);
    const height = read(node.layoutSizingVertical);
    if (width) sizing.width = width;
    if (height) sizing.height = height;
    if (width || height) result.sizing = sizing;
    if (inAutoLayout && 'layoutPositioning' in node && node.layoutPositioning === 'ABSOLUTE') result.absolute = true;
    return result;
  }

  function autoLayoutOf(frame: FrameNode, where: string): AutoLayout {
    const layout: AutoLayout = { direction: frame.layoutMode === 'VERTICAL' ? 'vertical' : 'horizontal' };
    if (frame.layoutWrap === 'WRAP') {
      layout.wrap = true;
      if (frame.counterAxisSpacing) layout.wrapGap = round(frame.counterAxisSpacing);
    }
    if (frame.itemSpacing && frame.primaryAxisAlignItems !== 'SPACE_BETWEEN') layout.gap = round(frame.itemSpacing);
    const padding = [frame.paddingTop, frame.paddingRight, frame.paddingBottom, frame.paddingLeft].map(round) as [number, number, number, number];
    if (padding.some(Boolean)) layout.padding = padding.every((p) => p === padding[0]) ? padding[0] : padding;
    const align = { MIN: 'start', CENTER: 'center', MAX: 'end', SPACE_BETWEEN: 'space-between' } as const;
    const crossAlign = { MIN: 'start', CENTER: 'center', MAX: 'end', BASELINE: 'baseline' } as const;
    const main = frame.primaryAxisAlignItems;
    if (main === 'SPACE_EVENLY' || main === 'SPACE_AROUND') {
      warnings.push(`${where}: "${main.toLowerCase()}" alignment isn't supported, captured as space-between`);
      layout.align = 'space-between';
    } else if (main !== 'MIN') layout.align = align[main];
    if (frame.counterAxisAlignItems !== 'MIN') layout.crossAlign = crossAlign[frame.counterAxisAlignItems];
    return layout;
  }

  async function captureNode(node: SceneNode, path: string, inAutoLayout = false): Promise<ContentItem | null> {
    const where = `${path} › ${node.name}`;
    const layout = layoutOf(node, inAutoLayout);
    // Inside auto layout, the frame positions its children.
    const position = inAutoLayout && !layout.absolute ? {} : { x: round(node.x), y: round(node.y) };

    if (node.type === 'INSTANCE') {
      const main = await node.getMainComponentAsync();
      if (!main) {
        warnings.push(`${where}: its component is missing, skipped`);
        return null;
      }
      if (!main.remote) {
        warnings.push(`${where}: "${main.name}" is a local component. Publish it in a library, or the plugin can't place it`);
      }
      // Filled components get the form data anyway, so their overrides don't matter.
      let filled = false;
      for (const component of FILLED_COMPONENTS) filled ||= await isInstanceOf(node, component);
      if (!filled && node.overrides.length > 0) {
        warnings.push(`${where}: changes made to this instance (overrides) aren't captured`);
      }
      // The frame around the thumbnail must be a regular frame to become the file thumbnail.
      const detach = await containsInstanceOf(node, THUMBNAIL);
      const name = node.name !== main.name ? node.name : undefined;
      items++;
      return { component: main.key, ...(detach && { detach }), ...(name && { name }), ...position, ...layout };
    }

    if (node.type === 'SECTION' || node.type === 'FRAME') {
      const autoLayout = node.type === 'FRAME' && node.layoutMode !== 'NONE' ? autoLayoutOf(node, where) : undefined;
      const children: ContentItem[] = [];
      for (const child of node.children) {
        const item = await captureNode(child, where, !!autoLayout);
        if (item) children.push(item);
      }
      items++;
      return {
        ...(node.type === 'SECTION' ? { section: node.name } : { frame: node.name }),
        ...position,
        // Hugging sides get their size from the children.
        ...(layout.sizing?.width !== 'hug' && { width: round(node.width) }),
        ...(layout.sizing?.height !== 'hug' && { height: round(node.height) }),
        fill: fillOf(node, where),
        ...(autoLayout && { autoLayout }),
        ...layout,
        ...(children.length && { children }),
      } as ContentItem;
    }

    warnings.push(`${where}: ${node.type.toLowerCase()} layers aren't supported, skipped`);
    return null;
  }

  const pages: PageDef[] = [];
  let thumbnail: InstanceNode | null = null;
  for (const page of figma.root.children) {
    await page.loadAsync();
    // The first thumbnail in the file gives the form's name label and the template's name.
    if (!thumbnail) {
      for (const node of page.findAllWithCriteria({ types: ['INSTANCE'] })) {
        if (await isInstanceOf(node, THUMBNAIL)) {
          thumbnail = node;
          break;
        }
      }
    }
    const content: ContentItem[] = [];
    for (const node of page.children) {
      const item = await captureNode(node, page.name);
      if (item) content.push(item);
    }
    // Divider pages can't show content, so their background is meaningless.
    const background = page.isPageDivider
      ? undefined
      : page.backgrounds.find((paint): paint is SolidPaint => paint.type === 'SOLID');
    pages.push({
      name: page.name,
      ...(background && { background: hex(background.color) }),
      ...(content.length && { content }),
    });
  }

  // The thumbnail's title is the name field's label (e.g. "Feature name").
  // Its description is never used: it's optional, and hidden it still holds default text.
  const title = thumbnail ? textProperty(thumbnail, THUMBNAIL.properties.title) : '';
  if (!thumbnail) warnings.push(`No thumbnail found, so the name label uses the default`);
  const thumbnailTitleLabel = title || DEFAULT_TITLE_LABEL;
  // Nothing in the file names the template; set it by hand after capturing.
  const templateName = DEFAULT_TEMPLATE_NAME;

  // The Figma file's name is the suggested file name pattern, e.g. "[Product] - [Feature name]".
  const pattern = figma.root.name.trim();
  const usesPlaceholders = /\[[^\]]+\]/.test(pattern);
  const fileName = usesPlaceholders ? pattern : `[${thumbnailTitleLabel}]`;
  if (!usesPlaceholders) {
    warnings.push(`The file name "${pattern}" has no [placeholders], so the suggested file name is ${fileName}`);
  }
  for (const placeholder of unknownPlaceholders(fileName, { thumbnailTitleLabel })) {
    warnings.push(
      `File name: ${placeholder} isn't a known placeholder (known: ${placeholdersOf({ thumbnailTitleLabel }).join(', ')})`,
    );
  }

  const mainDesignPage = guessMainDesignPage(figma.root.children);
  // Without a thumbnail there's nothing to go by, so the field stays.
  const showsContributors = !thumbnail || booleanProperty(thumbnail, THUMBNAIL.properties.showContributors) !== false;

  // A complete template file, every setting included; adjust the form details by hand after capturing.
  const template: Omit<TemplateDef, 'id'> = {
    order: 0, // templates with the same order are listed alphabetically
    templateName,
    templateFormHeading: templateName,
    thumbnailTitleLabel,
    // Contributors only when the template's thumbnail shows them.
    fields: FORM_FIELDS.filter((field) => field !== 'contributors' || showsContributors),
    requiredFields: [],
    fileName,
    mainDesignPage,
    pages,
  };
  return {
    json: JSON.stringify(template, null, 2),
    saveAs: `${slug(templateName)}.json`,
    warnings,
    pages: pages.length,
    items,
  };
}
