// Builds a file from its template (templates/<id>.json): pages (created,
// reused or renamed) and their content (library components, sections, frames).
// Everything it changes is undone if any step fails, so a file is never left
// half-built.

import {
  checkTemplates,
  DEFAULT_PAGE_NAME,
  findTemplate,
  isComponent,
  isFrame,
  isSection,
  type ContentItem,
  type Direction,
  type FrameItem,
  type PageDef,
  type SectionItem,
} from '../templates';
import type { NewFileData } from '../types';
import { FILLERS } from './fillers';
import { fileNameFor, interpolate } from '../placeholders';
import { CreateContext, placeComponent, setFileThumbnail, solid, type Parent } from './helpers';

const DEFAULT_PAGE_GAP = 200;
const DEFAULT_CONTAINER = { padding: 100, gap: 100, minSize: 100 };

/** Fills placeholders like [Product] in a page or layer name. */
type Names = (text: string) => string;

/** Builds the file and returns the suggested file name (plugins can't rename the file themselves). */
export async function createFile(data: NewFileData): Promise<{ fileName: string }> {
  const errors = checkTemplates();
  if (errors.length) throw new Error(`templates/${errors[0]}`);
  const template = findTemplate(data.fileType);
  if (!template) throw new Error(`Unknown template "${data.fileType}"`);

  // Fillers look up layers that library components hide by default (e.g. Contributors).
  figma.skipInvisibleInstanceChildren = false;

  const names: Names = (text) => interpolate(text, template, data);
  const ctx = new CreateContext();
  const originalOrder = [...figma.root.children];
  ctx.onRollback(() => restorePageOrder(originalOrder)); // runs last

  for (const [index, def] of template.pages.entries()) {
    try {
      const page = await ensurePage(ctx, def, names, def.name === template.mainDesignPage);
      figma.root.insertChild(index, page); // pages follow the template's order
      const placed = await placeItems(ctx, page, def.content ?? [], names, {
        gap: def.gap ?? DEFAULT_PAGE_GAP,
        direction: def.direction ?? 'horizontal',
        origin: startOfFreeSpace(page, def.gap ?? DEFAULT_PAGE_GAP),
      });
      // Put the form data into whatever library components were placed.
      for (const node of placed) {
        for (const fill of FILLERS) {
          const { thumbnail } = await fill(node, data);
          ctx.thumbnail ??= thumbnail ?? null;
        }
      }
    } catch (error) {
      ctx.rollback();
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Page "${def.name}": ${message}`);
    }
  }

  if (ctx.thumbnail) await setFileThumbnail(ctx.thumbnail);

  // Show the result.
  if (ctx.firstPage) {
    await figma.setCurrentPageAsync(ctx.firstPage);
    const nodes = ctx.firstPage.children;
    if (nodes.length) figma.viewport.scrollAndZoomIntoView(nodes);
  }

  return { fileName: fileNameFor(template, data) };
}

// ---- Pages ----

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The page for a definition, in this order of preference:
 * 1. an existing page that already has the name,
 * 2. for the template's main design page: the file's "Page 1", renamed (its content stays),
 * 3. a new page.
 */
async function ensurePage(ctx: CreateContext, def: PageDef, names: Names, isMainDesignPage: boolean): Promise<PageNode> {
  const name = names(def.name);
  const available = figma.root.children.filter((p) => !ctx.claimedPages.has(p));
  let page =
    available.find((p) => sameName(p.name, name)) ??
    (isMainDesignPage ? available.find((p) => sameName(p.name, DEFAULT_PAGE_NAME)) : undefined);

  if (page) {
    const existing = page;
    const { name: oldName, backgrounds: oldBackgrounds } = existing;
    ctx.onRollback(() => {
      existing.name = oldName;
      existing.backgrounds = oldBackgrounds;
    });
    await existing.loadAsync();
  } else {
    page = ctx.track(figma.createPage());
  }

  page.name = name;
  if (def.background) page.backgrounds = [solid(def.background)];
  ctx.claimedPages.add(page);
  ctx.firstPage ??= page;
  return page;
}

function restorePageOrder(order: PageNode[]) {
  order.forEach((page, index) => {
    if (!page.removed) figma.root.insertChild(index, page);
  });
}

/** Where new content starts on a page: next to anything already there. */
function startOfFreeSpace(page: PageNode, gap: number) {
  if (page.children.length === 0) return { x: 0, y: 0 };
  const right = Math.max(...page.children.map((n) => n.x + n.width));
  const top = Math.min(...page.children.map((n) => n.y));
  return { x: right + gap, y: top };
}

// ---- Content ----

interface Flow {
  gap: number;
  direction: Direction;
  origin: { x: number; y: number };
}

const SIZING = { fixed: 'FIXED', hug: 'HUG', fill: 'FILL' } as const;

/**
 * Builds items one after another (unless they have a fixed x/y). Inside auto
 * layout, the frame positions them instead. Returns the created nodes.
 */
async function placeItems(ctx: CreateContext, parent: Parent, items: ContentItem[], names: Names, flow: Flow | 'auto-layout') {
  const nodes: SceneNode[] = [];
  let { x, y } = flow === 'auto-layout' ? { x: 0, y: 0 } : flow.origin;
  for (const item of items) {
    const node = await buildItem(ctx, parent, item, names);
    nodes.push(node);
    if (item.sizing && 'layoutSizingHorizontal' in node) {
      if (item.sizing.width) node.layoutSizingHorizontal = SIZING[item.sizing.width];
      if (item.sizing.height) node.layoutSizingVertical = SIZING[item.sizing.height];
    }
    if (flow === 'auto-layout') {
      if (item.absolute && 'layoutPositioning' in node) {
        node.layoutPositioning = 'ABSOLUTE';
        node.x = item.x ?? 0;
        node.y = item.y ?? 0;
      }
      continue;
    }
    if (item.x !== undefined || item.y !== undefined) {
      node.x = item.x ?? 0;
      node.y = item.y ?? 0;
      continue;
    }
    node.x = x;
    node.y = y;
    if (flow.direction === 'horizontal') x += node.width + flow.gap;
    else y += node.height + flow.gap;
  }
  return nodes;
}

async function buildItem(ctx: CreateContext, parent: Parent, item: ContentItem, names: Names): Promise<SceneNode> {
  if (isComponent(item)) {
    const instance = await placeComponent(ctx, item.component, parent);
    // Nested library instances (thumbnail cover, link items, …) stay linked when detaching.
    const node = item.detach ? ctx.track(instance.detachInstance()) : instance;
    if (item.name) node.name = names(item.name);
    return node;
  }

  if (isSection(item)) {
    if (parent.type === 'FRAME') throw new Error(`Section "${item.section}" can't go inside a frame`);
    const section = ctx.track(figma.createSection());
    parent.appendChild(section);
    section.name = names(item.name ?? item.section);
    await fillContainer(ctx, section, item, names);
    return section;
  }

  if (isFrame(item)) {
    const frame = ctx.track(figma.createFrame());
    parent.appendChild(frame);
    frame.name = names(item.name ?? item.frame);
    await fillContainer(ctx, frame, item, names);
    return frame;
  }

  throw new Error(`Unknown item ${JSON.stringify(item)}`);
}

const ALIGN = { start: 'MIN', center: 'CENTER', end: 'MAX', 'space-between': 'SPACE_BETWEEN', baseline: 'BASELINE' } as const;

/** Adds a section's or frame's children, then sizes it (fixed, or fitting its children). */
async function fillContainer(ctx: CreateContext, container: SectionNode | FrameNode, item: SectionItem | FrameItem, names: Names) {
  if (item.fill) container.fills = item.fill === 'none' ? [] : [solid(item.fill)];

  if (container.type === 'FRAME' && 'autoLayout' in item && item.autoLayout) {
    const layout = item.autoLayout;
    container.layoutMode = layout.direction === 'vertical' ? 'VERTICAL' : 'HORIZONTAL';
    if (layout.wrap) container.layoutWrap = 'WRAP';
    container.itemSpacing = layout.gap ?? 0;
    if (layout.wrap && layout.wrapGap !== undefined) container.counterAxisSpacing = layout.wrapGap;
    const [top, right, bottom, left] =
      typeof layout.padding === 'number' ? [layout.padding, layout.padding, layout.padding, layout.padding] : (layout.padding ?? [0, 0, 0, 0]);
    Object.assign(container, { paddingTop: top, paddingRight: right, paddingBottom: bottom, paddingLeft: left });
    container.primaryAxisAlignItems = ALIGN[layout.align ?? 'start'] as FrameNode['primaryAxisAlignItems'];
    container.counterAxisAlignItems = ALIGN[layout.crossAlign ?? 'start'] as FrameNode['counterAxisAlignItems'];

    await placeItems(ctx, container, item.children ?? [], names, 'auto-layout');
    container.resize(item.width ?? container.width, item.height ?? container.height);
    // Without a size, the frame hugs its children (placeItems applies item.sizing afterwards).
    if (item.width === undefined) container.layoutSizingHorizontal = 'HUG';
    if (item.height === undefined) container.layoutSizingVertical = 'HUG';
    return;
  }

  const padding = item.padding ?? DEFAULT_CONTAINER.padding;
  const children = item.children ?? [];
  await placeItems(ctx, container, children, names, {
    gap: item.gap ?? DEFAULT_CONTAINER.gap,
    direction: item.direction ?? 'horizontal',
    origin: { x: padding, y: padding },
  });

  const kids = container.children;
  const fitWidth = kids.length ? Math.max(...kids.map((n) => n.x + n.width)) + padding : DEFAULT_CONTAINER.minSize;
  const fitHeight = kids.length ? Math.max(...kids.map((n) => n.y + n.height)) + padding : DEFAULT_CONTAINER.minSize;
  const width = item.width ?? Math.max(fitWidth, DEFAULT_CONTAINER.minSize);
  const height = item.height ?? Math.max(fitHeight, DEFAULT_CONTAINER.minSize);
  if (container.type === 'SECTION') container.resizeWithoutConstraints(width, height);
  else container.resize(width, height);
}
