// Captures the current file as a template file (templates/<id>.json), so a
// hand-made template file in Figma becomes a template in the plugin. Only
// behind the CAPTURE flag in code.ts.
//
// What's captured: pages (name, background), and on them sections, frames and
// library component instances, with names, positions, sizes, fills and auto
// layout. Instances that contain the thumbnail cover (e.g. "Start") are marked
// "detach", so the frame around the cover is a regular frame and can become
// the file thumbnail. Anything else (text, shapes, groups, instance
// overrides, …) is skipped and listed as a warning.

import { FILLED_COMPONENTS, THUMBNAIL_COVER } from './create/fillers';
import type { AutoLayout, ContentItem, PageDef, Sizing } from './templates';
import { FORM_FIELDS } from './types';

export interface CaptureResult {
  json: string;
  /** Suggested JSON file name in templates/, from the Figma file's name. */
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
      if (!FILLED_COMPONENTS.includes(node.name) && node.overrides.length > 0) {
        warnings.push(`${where}: changes made to this instance (overrides) aren't captured`);
      }
      // The frame around the cover must be a regular frame to become the file thumbnail.
      const detach = node.findOne((n) => n.type === 'INSTANCE' && n.name === THUMBNAIL_COVER) !== null;
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
  for (const page of figma.root.children) {
    await page.loadAsync();
    const content: ContentItem[] = [];
    for (const node of page.children) {
      const item = await captureNode(node, page.name);
      if (item) content.push(item);
    }
    const background = page.backgrounds.find((paint): paint is SolidPaint => paint.type === 'SOLID');
    pages.push({
      name: page.name,
      ...(background && { background: hex(background.color) }),
      ...(content.length && { content }),
    });
  }

  // A complete template file; the form details above pages are adjusted by hand after capturing.
  const template = {
    templateName: figma.root.name,
    thumbnailTitleLabel: 'Name',
    fields: [...FORM_FIELDS],
    fileName: '[Name]',
    mainDesignPage: '',
    pages,
  };
  return {
    json: JSON.stringify(template, null, 2),
    saveAs: `${slug(figma.root.name)}.json`,
    warnings,
    pages: pages.length,
    items,
  };
}
