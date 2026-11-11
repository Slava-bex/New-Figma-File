// Captures the current file as a template file (templates/<id>.json), so a
// hand-made template file in Figma becomes a template in the plugin. Only
// behind the CAPTURE flag in code.ts.
//
// What's captured: pages (name, background), and on them sections, frames and
// library component instances, with names, positions, sizes and fills.
// Instances of a component named in _shared.json "components" (e.g. "start")
// refer to it by name, so they get filled. Anything else (text, shapes,
// groups, auto layout, instance overrides, …) is skipped and listed as a warning.

import { SHARED, type ContentItem, type PageDef } from './templates';
import { FORM_FIELDS } from './types';

export interface CaptureResult {
  json: string;
  /** Suggested file name, from the Figma file's name. */
  fileName: string;
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

  // Component key -> its name in _shared.json, e.g. the "Start" key -> "start".
  const sharedNames = new Map(Object.entries(SHARED.components).map(([name, component]) => [component.key, name]));
  let thumbnail: BaseNode | null = null;
  try {
    thumbnail = await figma.getFileThumbnailNodeAsync();
  } catch {
    // No custom thumbnail, or not available.
  }

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

  async function captureNode(node: SceneNode, path: string): Promise<ContentItem | null> {
    const where = `${path} › ${node.name}`;
    const position = { x: round(node.x), y: round(node.y) };

    if (node.type === 'INSTANCE') {
      const main = await node.getMainComponentAsync();
      if (!main) {
        warnings.push(`${where}: its component is missing, skipped`);
        return null;
      }
      if (!main.remote) {
        warnings.push(`${where}: "${main.name}" is a local component. Publish it in a library, or the plugin can't place it`);
      }
      const sharedName = sharedNames.get(main.key);
      const filled = Boolean(sharedName && SHARED.components[sharedName].fill);
      // Filled components get the form data anyway, so their overrides don't matter.
      if (!filled && node.overrides.length > 0) {
        warnings.push(`${where}: changes made to this instance (overrides) aren't captured`);
      }
      const name = node.name !== main.name ? node.name : undefined;
      items++;

      const item: ContentItem = { component: sharedName ?? main.key, ...(name && { name }), ...position };
      if (thumbnail?.id === node.id) item.setAsThumbnail = true;
      else if (thumbnail && node.findOne((n) => n.id === thumbnail?.id)) item.setAsThumbnail = thumbnail.name;
      return item;
    }

    if (node.type === 'SECTION' || node.type === 'FRAME') {
      if (node.type === 'FRAME' && node.layoutMode !== 'NONE') {
        warnings.push(`${where}: auto layout isn't captured; children keep their current positions`);
      }
      const children: ContentItem[] = [];
      for (const child of node.children) {
        const item = await captureNode(child, where);
        if (item) children.push(item);
      }
      items++;
      return {
        ...(node.type === 'SECTION' ? { section: node.name } : { frame: node.name }),
        ...position,
        width: round(node.width),
        height: round(node.height),
        fill: fillOf(node, where),
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
      // A new file starts with "Page 1"; let the first page take it over.
      ...(pages.length === 0 && { renameFrom: ['Page 1'] }),
      ...(content.length && { content }),
    });
  }

  // A complete template file; label, nameLabel and fields are starting points to adjust.
  const template = {
    $schema: '../schemas/template.schema.json',
    label: figma.root.name,
    nameLabel: 'Name',
    fields: [...FORM_FIELDS],
    pages,
  };
  return {
    json: JSON.stringify(template, null, 2),
    fileName: `${slug(figma.root.name)}.json`,
    warnings,
    pages: pages.length,
    items,
  };
}
