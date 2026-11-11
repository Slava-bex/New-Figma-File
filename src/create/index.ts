// Builds a file from its template (templates/<id>.json): pages (created,
// reused or renamed) and their content (library components, sections, frames).
// Everything it changes is undone if any step fails, so a file is never left
// half-built.

import {
  checkTemplates,
  findTemplate,
  isComponent,
  isFrame,
  isSection,
  pagesFor,
  resolveComponent,
  type ContentItem,
  type Direction,
  type FrameItem,
  type PageDef,
  type SectionItem,
} from '../templates';
import type { NewFileData } from '../types';
import { FILLERS } from './fillers';
import { CreateContext, interpolate, layer, placeComponent, setFileThumbnail, solid, type Parent } from './helpers';

const DEFAULT_PAGE_GAP = 200;
const DEFAULT_CONTAINER = { padding: 100, gap: 100, minSize: 100 };

export async function createFile(data: NewFileData): Promise<void> {
  const errors = checkTemplates();
  if (errors.length) throw new Error(`templates/${errors[0]}`);
  const template = findTemplate(data.fileType);
  if (!template) throw new Error(`Unknown template "${data.fileType}"`);

  // Fillers look up layers that templates hide by default (e.g. Contributors).
  figma.skipInvisibleInstanceChildren = false;

  const ctx = new CreateContext();
  const originalOrder = [...figma.root.children];
  ctx.onRollback(() => restorePageOrder(originalOrder)); // runs last

  for (const [index, def] of pagesFor(template).entries()) {
    try {
      const page = await ensurePage(ctx, def, data);
      figma.root.insertChild(index, page); // pages follow the structure's order
      await placeItems(ctx, page, def.content ?? [], data, {
        gap: def.gap ?? DEFAULT_PAGE_GAP,
        direction: def.direction ?? 'horizontal',
        origin: startOfFreeSpace(page, def.gap ?? DEFAULT_PAGE_GAP),
      });
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
}

// ---- Pages ----

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The page for a definition, in this order of preference:
 * 1. an existing page that already has the name,
 * 2. an existing page named like one of `renameFrom`, renamed,
 * 3. a new page.
 */
async function ensurePage(ctx: CreateContext, def: PageDef, data: NewFileData): Promise<PageNode> {
  const name = interpolate(def.name, data);
  const available = figma.root.children.filter((p) => !ctx.claimedPages.has(p));
  let page =
    available.find((p) => sameName(p.name, name)) ??
    available.find((p) => def.renameFrom?.some((from) => sameName(p.name, interpolate(from, data))));

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

/** Builds items one after another (unless they have a fixed x/y). */
async function placeItems(ctx: CreateContext, parent: Parent, items: ContentItem[], data: NewFileData, flow: Flow) {
  let { x, y } = flow.origin;
  for (const item of items) {
    const node = await buildItem(ctx, parent, item, data);
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
}

async function buildItem(ctx: CreateContext, parent: Parent, item: ContentItem, data: NewFileData): Promise<SceneNode> {
  if (isComponent(item)) {
    const { key, fill, detach } = resolveComponent(item);
    const instance = await placeComponent(ctx, key, parent);
    // Nested library instances (thumbnail cover, link items, …) stay linked when detaching.
    const node = detach ? ctx.track(instance.detachInstance()) : instance;
    if (item.name) node.name = interpolate(item.name, data);
    if (fill && node.type === 'FRAME') await FILLERS[fill](node, data);
    if (item.setAsThumbnail) {
      ctx.thumbnail = typeof item.setAsThumbnail === 'string' ? layer(node, item.setAsThumbnail, 'FRAME') : (node as FrameNode);
    }
    return node;
  }

  if (isSection(item)) {
    if (parent.type === 'FRAME') throw new Error(`Section "${item.section}" can't go inside a frame`);
    const section = ctx.track(figma.createSection());
    parent.appendChild(section);
    section.name = interpolate(item.name ?? item.section, data);
    await fillContainer(ctx, section, item, data);
    return section;
  }

  if (isFrame(item)) {
    const frame = ctx.track(figma.createFrame());
    parent.appendChild(frame);
    frame.name = interpolate(item.name ?? item.frame, data);
    await fillContainer(ctx, frame, item, data);
    return frame;
  }

  throw new Error(`Unknown item ${JSON.stringify(item)}`);
}

/** Adds a section's or frame's children, then sizes it (fixed, or fitting its children). */
async function fillContainer(ctx: CreateContext, container: SectionNode | FrameNode, item: SectionItem | FrameItem, data: NewFileData) {
  if (item.fill) container.fills = item.fill === 'none' ? [] : [solid(item.fill)];
  const padding = item.padding ?? DEFAULT_CONTAINER.padding;
  const children = item.children ?? [];
  await placeItems(ctx, container, children, data, {
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
