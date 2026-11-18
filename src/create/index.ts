// Builds a file from its template (templates/<id>.json): pages (created,
// reused or renamed) and their content (library components, sections, frames).
// FigJam templates are built the same way, except that the file thumbnail isn't set.
// Everything it changes is undone if any step fails, so a file is never left
// half-built.

import {
  checkTemplate,
  DEFAULT_PAGE_NAME,
  editorOf,
  findTemplate,
  isComponent,
  isFrame,
  isSection,
  type ContentItem,
  type Direction,
  type FrameItem,
  type PageDef,
  type SectionItem,
  templateWarnings,
} from '../templates';
import type { NewFileData } from '../types';
import { FILLERS } from './fillers';
import { isInstanceOf, THUMBNAIL, type LibraryComponent } from '../library';
import { DISPLAY_VERSION, PLUGIN_NAME } from '../version';
import { fileNameFor, nameFor } from '../placeholders';
import { CreateContext, placeComponent, setFileThumbnail, solid, type Parent } from './helpers';

const DEFAULT_PAGE_GAP = 200;
const DEFAULT_CONTAINER = { padding: 100, gap: 100, minSize: 100 };

/** Fills placeholders like [Product] in a page or layer name. */
type Names = (text: string) => string;

/**
 * Builds the file and returns the suggested file name (plugins can't rename the
 * file themselves) and any template warnings to show afterwards.
 */
export async function createFile(data: NewFileData): Promise<{
  fileName: string;
  changed: boolean;
  skipped: boolean;
  warnings: string[];
  cleanup: string[];
  backedUp: boolean;
}> {
  const template = findTemplate(data.fileType);
  if (!template) throw new Error(`Unknown template "${data.fileType}"`);
  // Only this template's problems matter; others don't stop it.
  const errors = checkTemplate(template);
  if (errors.length) {
    console.error(`Template can't be built:\n${errors.join('\n')}`);
    throw new Error(errors[0]);
  }

  // Fillers look up layers that library components hide by default (e.g. Contributors).
  figma.skipInvisibleInstanceChildren = false;

  const editor = editorOf(template);
  if (editor !== figma.editorType) {
    const where = editor === 'figjam' ? 'FigJam' : 'Figma design files';
    throw new Error(`Couldn't use the template "${template.templateName}": it only works in ${where}.`);
  }

  // A version to go back to, saved before anything changes (only for files with content).
  const backup = await saveBackupVersion();

  const names: Names = (text) => nameFor(text, template, data);
  const ctx = new CreateContext();
  const originalOrder = [...figma.root.children];
  ctx.onRollback(() => restorePageOrder(originalOrder)); // runs last

  const notices: string[] = [];
  // What was done to the file's existing pages: renames, removed dividers, moves.
  const cleanup: string[] = [];
  // The template's pages as they ended up in the file, in template order.
  const templatePages: PageNode[] = [];
  // The main design page as it ended up in the file (built, or already there).
  let mainPage: PageNode | null = null;
  let reused = false;
  // Whether a page other than a divider was created or taken over (see reuseDividers for those).
  let built = false;
  const startPage = figma.currentPage;
  // Always ends on the thumbnail's page, never a divider, also when Create fails.
  try {
    for (const def of template.pages) {
      try {
        const isMain = !!template.mainDesignPage && def.name === template.mainDesignPage;
        // FigJam: a board that already has pages of its own (not the template's other
        // pages, not dividers) keeps them as they are, without a new main design page.
        const hasOwnPages = originalOrder.some((p) => !p.removed && !p.isPageDivider && !ctx.claimedPages.has(p));
        const mayCreate = !(isMain && editor === 'figjam' && hasOwnPages);
        const found = await ensurePage(ctx, def, names, isMain, mayCreate);
        // The board's own pages stand in for the main design page; nothing to report.
        if (!found) continue;
        const { page, kind, oldName } = found;
        templatePages.push(page);
        if (isMain) mainPage ??= page;
        if (oldName !== undefined) cleanup.push(`Renamed '${oldName}' to '${page.name}'`);
        // Existing pages with the template page's name are only renamed and moved, so
        // nothing on them changes. Unless they're empty: then they get the template's
        // content like a new page (nothing there to change or lose).
        if (kind === 'exact' || kind === 'similar') {
          await page.loadAsync();
          const fillsEmptyPage = page.children.length === 0 && (def.content ?? []).length > 0;
          if (!fillsEmptyPage) {
            if (kind === 'exact') notices.push(`Skipped creating '${page.name}': already exists`);
            reused = true;
            continue;
          }
          if (def.background) {
            const oldBackgrounds = page.backgrounds;
            ctx.onRollback(() => (page.backgrounds = oldBackgrounds));
            page.backgrounds = [solid(def.background)];
          }
          ctx.firstPage ??= page;
        }
        if (!page.isPageDivider) built = true;
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
        throw new Error(`${message} (page "${def.name}")`);
      }
    }

    // Clean-up, once everything is built (removing pages can't be undone): the file's
    // dividers take the place of the template's (see reuseDividers), then the pages
    // are put in template order (see arrangePages).
    const dividers = reuseDividers(templatePages, originalOrder);
    if (dividers.removed) {
      cleanup.push(dividers.removed === 1 ? 'Removed 1 extra divider' : `Removed ${dividers.removed} extra dividers`);
    }
    if (dividers.added) built = true;
    // Dividers are left out: a move is about the order of real pages.
    const keptBefore = originalOrder.filter((p) => !p.removed && !p.isPageDivider);
    arrangePages(templatePages, mainPage);
    for (const page of movedPages(keptBefore)) cleanup.push(`Moved '${page.name}'`);

    // FigJam can't set a file thumbnail.
    if (ctx.thumbnail && editor === 'figma') await setFileThumbnail(ctx.thumbnail);
  } finally {
    try {
      await showResult(ctx, templatePages, mainPage, startPage);
    } catch (error) {
      console.warn("Couldn't show the result", error);
    }
  }

  return {
    fileName: fileNameFor(template, data),
    // False when every page was already there as it is, so nothing in the file changed.
    changed: built || cleanup.length > 0,
    // True when any page was reused instead of built, because the file already has it.
    skipped: reused,
    warnings: [...notices, ...templateWarnings(template)],
    cleanup,
    // Whether a backup version was saved first (mentioned in the success message).
    backedUp: backup,
  };
}

// ---- Backup ----

const BACKUP_TITLE = 'Before file structure change';

/**
 * Saves a named version to the file's version history, so the user can go back
 * to the file as it was. Skipped for an empty file (a single empty page): there's
 * nothing to lose. Returns whether a version was saved. If saving fails, nothing
 * is changed: Create stops with an error.
 */
async function saveBackupVersion(): Promise<boolean> {
  const pages = figma.root.children;
  if (pages.length === 1) {
    await pages[0].loadAsync();
    if (pages[0].children.length === 0) return false;
  }
  try {
    await figma.saveVersionHistoryAsync(
      BACKUP_TITLE,
      `Backup snapshot before '${PLUGIN_NAME} ${DISPLAY_VERSION}' plug-in has applied any changes to the pages`,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Couldn't save a backup to the version history. No changes applied: ${reason}`);
  }
  return true;
}

// ---- Showing the result ----

/**
 * Ends on the thumbnail's page, zoomed to the thumbnail, never on a divider (Figma
 * would show it as an odd "-" page until another page is opened). Without a thumbnail
 * (or after a failed run): the first built page, the page the user was on, or the
 * file's first page that isn't a divider.
 */
async function showResult(ctx: CreateContext, templatePages: PageNode[], mainPage: PageNode | null, startPage: PageNode) {
  const usable = (page: PageNode | null | undefined): page is PageNode => !!page && !page.removed && !page.isPageDivider;

  let thumbnail: SceneNode | null = ctx.thumbnail && !ctx.thumbnail.removed ? ctx.thumbnail : null;
  // A thumbnail page that was already there (reused) wasn't filled; look for its thumbnail.
  if (!thumbnail) {
    for (const page of templatePages.filter(usable)) {
      if (page === mainPage) continue; // can be big, and isn't where the thumbnail goes
      await page.loadAsync();
      thumbnail = await firstInstanceOf(page, THUMBNAIL);
      if (thumbnail) break;
    }
  }

  const page =
    [pageOf(thumbnail), ctx.firstPage, startPage].find(usable) ?? figma.root.children.find((p) => !p.isPageDivider);
  if (!page) return;
  if (figma.currentPage !== page) await figma.setCurrentPageAsync(page);
  // The whole cover: the top-level layer the thumbnail sits in (or its own frame, as in Blank).
  if (thumbnail && pageOf(thumbnail) === page) zoomToFit([topLevelOf(thumbnail)]);
  else if (page.children.length) zoomToFit(page.children);
}

/** Share of the viewport the content may take, leaving space around it on every side. */
const FIT = 0.8;

/** Zooms so `nodes` fit entirely, both ways, centered with space around them. */
function zoomToFit(nodes: readonly SceneNode[]) {
  // Fits them exactly (whichever dimension is tighter) and centers them…
  figma.viewport.scrollAndZoomIntoView(nodes);
  const center = figma.viewport.center;
  // …then zooms out a little around the same center.
  figma.viewport.zoom *= FIT;
  figma.viewport.center = center;
}

/** The layer directly on the page that contains `node` (or is it). */
function topLevelOf(node: SceneNode): SceneNode {
  let current = node;
  while (current.parent && current.parent.type !== 'PAGE') current = current.parent as SceneNode;
  return current;
}

/** The first instance of `component` on `page`, stopping at the first match. */
async function firstInstanceOf(page: PageNode, component: LibraryComponent): Promise<InstanceNode | null> {
  for (const node of page.findAllWithCriteria({ types: ['INSTANCE'] })) {
    if (await isInstanceOf(node, component)) return node;
  }
  return null;
}

function pageOf(node: BaseNode | null): PageNode | null {
  let current = node;
  while (current && current.type !== 'PAGE') current = current.parent;
  return current;
}

// ---- Pages ----

// Emojis: keycaps (1\ufe0f\u20e3, #\ufe0f\u20e3) as a whole, pictographs, skin tones, country flags,
// the tag characters of flags like \ud83c\udff4\udb40\udc67\udb40\udc62\udb40\udc65\udb40\udc6e\udb40\udc67\udb40\udc7f, and the joiners and text/emoji style
// selectors between parts. Digits, # and * are only removed as part of a keycap.
const EMOJI =
  /[0-9#*]\ufe0f?\u20e3|\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[\u{E0020}-\u{E007F}]|\u200d|\ufe0e|\ufe0f|\u20e3/gu;

/** A page name without emojis, spacing and capitals, e.g. "🚧  Concept: X" → "concept:x". */
const looseName = (name: string) => name.replace(EMOJI, '').replace(/\s+/g, '').toLowerCase();

/** Same name apart from capitals, emojis and spacing (e.g. "design" and "🎨 Design"). */
const similarName = (a: string, b: string) => looseName(a) !== '' && looseName(a) === looseName(b);

/**
 * The page for a definition, and how it was found:
 * - "exact": the file has a page with exactly that name; it's reused as it is,
 * - "similar": the file has a page with a similar name (see similarName); it's renamed,
 * - "takeover": for the template's main design page, the file's "Page 1"; renamed, its content stays,
 * - "new": a new page, unless `mayCreate` is false: then null, and no page is made.
 * Only "takeover" and "new" pages get the template's background and content.
 * oldName is set when an existing page was renamed. Existing dividers aren't matched
 * here; they take the place of the template's dividers afterwards (see reuseDividers).
 */
async function ensurePage(
  ctx: CreateContext,
  def: PageDef,
  names: Names,
  isMainDesignPage: boolean,
  mayCreate: boolean,
): Promise<{ page: PageNode; kind: 'exact' | 'similar' | 'takeover' | 'new'; oldName?: string } | null> {
  const name = names(def.name);
  // Pages already used are excluded, so a template can repeat a page name.
  const available = figma.root.children.filter((p) => !ctx.claimedPages.has(p) && !p.isPageDivider);

  const exact = available.find((p) => p.name === name);
  if (exact) {
    ctx.claimedPages.add(exact);
    return { page: exact, kind: 'exact' };
  }

  const similar = available.find((p) => similarName(p.name, name));
  if (similar) {
    const oldName = similar.name;
    ctx.onRollback(() => (similar.name = oldName));
    similar.name = name;
    ctx.claimedPages.add(similar);
    return { page: similar, kind: 'similar', oldName };
  }

  const page1 = isMainDesignPage ? available.find((p) => similarName(p.name, DEFAULT_PAGE_NAME)) : undefined;
  if (!page1 && !mayCreate) return null;
  let page: PageNode;
  let oldName: string | undefined;
  if (page1) {
    page = page1;
    const { name: previousName, backgrounds: oldBackgrounds } = page1;
    ctx.onRollback(() => {
      page1.name = previousName;
      page1.backgrounds = oldBackgrounds;
    });
    await page1.loadAsync();
    oldName = previousName;
  } else {
    page = ctx.track(figma.createPage());
  }

  page.name = name;
  if (def.background) page.backgrounds = [solid(def.background)];
  ctx.claimedPages.add(page);
  ctx.firstPage ??= page;
  return { page, kind: page1 ? 'takeover' : 'new', oldName };
}

/**
 * The file's existing dividers take the place of the dividers this run created for
 * the template, in order, so a file that already has them keeps them (and nothing
 * needs reporting). Dividers can't hold content, so nothing is lost either way.
 * Existing dividers left over are removed; template dividers left over stay new.
 * Updates `templatePages` in place.
 */
function reuseDividers(templatePages: PageNode[], originalOrder: PageNode[]) {
  const existing = new Set(originalOrder);
  const old = originalOrder.filter((p) => !p.removed && p.isPageDivider);
  let next = 0;
  let added = 0;
  templatePages.forEach((page, index) => {
    if (!page.isPageDivider || existing.has(page)) return;
    const reused = old[next];
    if (!reused) {
      added++;
      return;
    }
    next++;
    if (reused.name !== page.name) reused.name = page.name;
    templatePages[index] = reused;
    page.remove();
  });
  const extra = old.slice(next);
  for (const divider of extra) divider.remove();
  return { removed: extra.length, added };
}

/**
 * Puts the pages in template order. The file's other pages (the ones the template
 * didn't use) go just before the first divider after the main design page, so they
 * end up in its group; without a main design page or a divider after it, at the end.
 */
function arrangePages(templatePages: PageNode[], mainPage: PageNode | null) {
  const ordered = [...new Set(templatePages)];
  const inTemplate = new Set(ordered);
  const others = figma.root.children.filter((p) => !inTemplate.has(p));
  const start = mainPage ? ordered.indexOf(mainPage) : -1;
  const divider = start === -1 ? -1 : ordered.findIndex((p, i) => i > start && p.isPageDivider);
  const at = divider === -1 ? ordered.length : divider;
  const order = [...ordered.slice(0, at), ...others, ...ordered.slice(at)];
  order.forEach((page, index) => {
    if (figma.root.children[index] !== page) figma.root.insertChild(index, page);
  });
}

/**
 * The fewest of `before`'s pages that explain their new order: the others kept
 * their order relative to each other (longest such run), so only these moved.
 */
function movedPages(before: PageNode[]): PageNode[] {
  const now = before.map((page) => figma.root.children.indexOf(page));
  // Longest increasing run of new positions (O(n²), files have few pages).
  const length = now.map(() => 1);
  const previous = now.map(() => -1);
  for (let i = 0; i < now.length; i++) {
    for (let j = 0; j < i; j++) {
      if (now[j] < now[i] && length[j] + 1 > length[i]) {
        length[i] = length[j] + 1;
        previous[i] = j;
      }
    }
  }
  const stayed = new Set<number>();
  let i = length.indexOf(Math.max(0, ...length));
  while (i !== -1) {
    stayed.add(i);
    i = previous[i];
  }
  return before.filter((_, index) => !stayed.has(index));
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
