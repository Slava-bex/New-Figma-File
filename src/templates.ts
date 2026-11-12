// The file templates (templates/*.json): types, lookups and checks.
// Each template is self-contained. See templates/README.md for how to edit them.

import loaded from 'build:all-templates';
import { placeholdersOf, unknownPlaceholders } from './placeholders';
import { FORM_FIELDS, type FileType, type FormField } from './types';

// ---- Shape of a template file ----

export interface TemplateDef {
  /** File name without .json. */
  id: FileType;
  order?: number;
  /** The template's name in the File type list. */
  templateName: string;
  /** Heading of the template's form (defaults to templateName). */
  templateFormHeading?: string;
  /** Label of the form field whose value becomes the thumbnail title, e.g. "Project name". */
  thumbnailTitleLabel: string;
  /** Form fields shown besides the name. */
  fields: FormField[];
  /** Fields from `fields` that must be filled in, e.g. ["products"] (at least one product). */
  requiredFields?: FormField[];
  /**
   * Suggested file name, shown after creating the file, e.g. "[Product] - [Project name]".
   * Empty placeholders and the separators next to them are dropped. Default: the name field alone.
   */
  fileName?: string;
  /**
   * Name of the page (from `pages`) that takes over the file's existing "Page 1",
   * keeping its content. Empty or missing: "Page 1" is left as it is.
   */
  mainDesignPage?: string;
  /** Pages to build, in order. */
  pages: PageDef[];
}

/** The file's default page, which a template's main design page takes over. */
export const DEFAULT_PAGE_NAME = 'Page 1';

export interface PageDef {
  /** Page name. Can use the placeholders, e.g. "[Project name]". */
  name: string;
  /** Hex color, e.g. "#F4F4F4". */
  background?: string;
  content?: ContentItem[];
  /** Space between top-level items on the page. */
  gap?: number;
  direction?: Direction;
}

export type Direction = 'horizontal' | 'vertical';

/** How an item is sized inside an auto-layout frame (or, for "hug", by its own auto layout). */
export type Sizing = 'fixed' | 'hug' | 'fill';

export interface AutoLayout {
  direction: Direction;
  /** Wrap onto new lines (horizontal only). */
  wrap?: boolean;
  /** Space between items (default 0). */
  gap?: number;
  /** Space between wrapped lines. */
  wrapGap?: number;
  /** One number for all sides, or [top, right, bottom, left] (default 0). */
  padding?: number | [number, number, number, number];
  /** Alignment along the direction (default "start"). */
  align?: 'start' | 'center' | 'end' | 'space-between';
  /** Alignment across the direction (default "start"). */
  crossAlign?: 'start' | 'center' | 'end' | 'baseline';
}

interface Placement {
  /** Layer name (defaults to the section/frame name or the component's name). */
  name?: string;
  /** Fixed position. Without it, items are laid out one after another. Ignored inside auto layout unless absolute. */
  x?: number;
  y?: number;
  /** Hug or fill instead of a fixed size (default fixed). */
  sizing?: { width?: Sizing; height?: Sizing };
  /** Inside auto layout: positioned freely at x/y instead of following the layout. */
  absolute?: boolean;
}

export interface ComponentItem extends Placement {
  /** Key of a published library component. */
  component: string;
  /** Detach the instance after placing it (default false). */
  detach?: boolean;
}

interface Container extends Placement {
  /** Fixed size. Without it, the container fits its children. */
  width?: number;
  height?: number;
  /** Hex color, or "none" for no fill (Figma's default is white). */
  fill?: string;
  padding?: number;
  gap?: number;
  direction?: Direction;
  children?: ContentItem[];
}

export interface SectionItem extends Container {
  section: string;
}

export interface FrameItem extends Container {
  frame: string;
  /** Figma auto layout. Children then follow it; padding/gap/direction above are not used. */
  autoLayout?: AutoLayout;
}

export type ContentItem = ComponentItem | SectionItem | FrameItem;

export const isComponent = (item: ContentItem): item is ComponentItem => 'component' in item;
export const isSection = (item: ContentItem): item is SectionItem => 'section' in item;
export const isFrame = (item: ContentItem): item is FrameItem => 'frame' in item;

// ---- Loaded data ----

/** All templates, in list order. */
export const TEMPLATES: TemplateDef[] = [...(loaded.templates as TemplateDef[])].sort(
  (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.templateName.localeCompare(b.templateName),
);

export const findTemplate = (id: FileType) => TEMPLATES.find((template) => template.id === id);

/** What the UI needs to show a template. */
export const templateSummaries = () =>
  TEMPLATES.map(({ id, templateName, templateFormHeading, thumbnailTitleLabel, fields, requiredFields }) => ({
    id,
    templateName,
    templateFormHeading: templateFormHeading ?? templateName,
    thumbnailTitleLabel,
    fields,
    requiredFields: requiredFields ?? [],
  }));

// ---- Checks ----

const HEX = /^#[0-9a-f]{6}$/i;
const KINDS = ['component', 'section', 'frame'] as const;
const KEY = /^[0-9a-f]{40}$/i;

/**
 * Lists everything wrong with the templates, so a typo in the JSON shows up
 * as a clear message before the document is touched.
 */
export function checkTemplates(): string[] {
  const errors: string[] = [];
  const err = (where: string, message: string) => errors.push(`${where}: ${message}`);

  const checkItems = (items: ContentItem[] | undefined, where: string, insideFrame: boolean, insideAutoLayout = false) => {
    (items ?? []).forEach((item, i) => {
      const at = `${where}[${i}]`;
      const kinds = KINDS.filter((kind) => kind in item);
      if (kinds.length !== 1) {
        err(at, `needs exactly one of ${KINDS.join(', ')}`);
        return;
      }
      if (isComponent(item)) {
        if (!item.component) err(at, 'component key is empty');
        else if (!KEY.test(item.component)) err(at, `"${item.component}" isn't a component key`);
      }
      if (isSection(item) && insideFrame) err(at, 'Figma sections can only sit on a page or in another section');
      if ((isSection(item) || isFrame(item)) && item.fill && item.fill !== 'none' && !HEX.test(item.fill)) {
        err(at, `fill "${item.fill}" isn't a #RRGGBB color or "none"`);
      }
      const fills = [item.sizing?.width, item.sizing?.height].includes('fill');
      if (fills && !insideAutoLayout) err(at, '"fill" sizing only works inside an auto-layout frame');
      if (item.absolute && !insideAutoLayout) err(at, '"absolute" only works inside an auto-layout frame');
      if (isFrame(item) && item.autoLayout && !['horizontal', 'vertical'].includes(item.autoLayout.direction)) {
        err(at, 'autoLayout.direction must be "horizontal" or "vertical"');
      }
      if (isSection(item) || isFrame(item)) {
        checkItems(item.children, `${at}.children`, insideFrame || isFrame(item), isFrame(item) && !!item.autoLayout);
      }
    });
  };

  if (TEMPLATES.length === 0) err('templates/', 'no templates found');
  for (const template of TEMPLATES) {
    const file = `${template.id}.json`;
    if (!template.templateName?.trim()) err(file, 'templateName is empty');
    if (!template.thumbnailTitleLabel?.trim()) err(file, 'thumbnailTitleLabel is empty');
    for (const field of template.fields ?? []) {
      if (!FORM_FIELDS.includes(field)) err(file, `unknown field "${field}" (known: ${FORM_FIELDS.join(', ')})`);
    }
    for (const field of template.requiredFields ?? []) {
      if (field === 'externalAccess') err(file, 'requiredFields: externalAccess is a switch and can\'t be required');
      else if (!(template.fields ?? []).includes(field)) err(file, `requiredFields: "${field}" isn't in fields`);
    }
    for (const placeholder of unknownPlaceholders(template.fileName ?? '', template)) {
      err(file, `fileName: unknown placeholder ${placeholder} (known: ${placeholdersOf(template).join(', ')})`);
    }
    if (!Array.isArray(template.pages) || template.pages.length === 0) err(file, 'pages is empty');
    if (template.mainDesignPage && !(template.pages ?? []).some((page) => page.name === template.mainDesignPage)) {
      err(file, `mainDesignPage "${template.mainDesignPage}" isn't one of its pages`);
    }
    (template.pages ?? []).forEach((page, i) => {
      const where = `${file} pages[${i}]`;
      if (!page.name?.trim()) err(where, 'name is empty');
      if (page.background && !HEX.test(page.background)) err(where, `background "${page.background}" isn't a #RRGGBB color`);
      checkItems(page.content, `${where}.content`, false);
    });
  }
  return errors;
}
