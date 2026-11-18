// The file templates (templates/*.json): types, lookups and checks.
// Each template is self-contained. See templates/README.md for how to edit them.

import loaded from 'build:all-templates';
import { placeholdersOf, unknownPlaceholders } from './placeholders';
import { FORM_FIELDS, type FileType, type FormField } from './types';

// ---- Shape of a template file ----

export interface TemplateDef {
  /** File name without .json. */
  id: FileType;
  /**
   * Where the template is offered (default "figma"). In FigJam the plugin opens
   * straight on the first FigJam template's form; its pages are built like any
   * template's, but the file thumbnail isn't set (FigJam doesn't support it).
   */
  editor?: TemplateEditor;
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

export type TemplateEditor = 'figma' | 'figjam';
export const editorOf = (template: TemplateDef): TemplateEditor => template.editor ?? 'figma';

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

/**
 * All templates, in list order: by `order`, then alphabetically by name. Several
 * templates may share an order (e.g. the captured default 0); that's fine.
 * Templates without an order come last.
 */
export const TEMPLATES: TemplateDef[] = [...(loaded.templates as TemplateDef[])].sort(
  (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.templateName.localeCompare(b.templateName),
);

export const findTemplate = (id: FileType) => TEMPLATES.find((template) => template.id === id);

/** The template's known fields; unknown ones are ignored (see templateWarnings). */
export const fieldsOf = (template: TemplateDef): FormField[] =>
  (template.fields ?? []).filter((field) => FORM_FIELDS.includes(field));

/** The template's required fields that it shows and that can be required; others are ignored. */
export const requiredFieldsOf = (template: TemplateDef): FormField[] =>
  (template.requiredFields ?? []).filter((field) => field !== 'externalAccess' && fieldsOf(template).includes(field));

/** The templates offered in an editor, in list order. */
export const templatesFor = (editor: TemplateEditor) => TEMPLATES.filter((template) => editorOf(template) === editor);

/** What the UI needs to show the templates of an editor. */
export const templateSummaries = (editor: TemplateEditor) =>
  templatesFor(editor).map((template) => ({
    id: template.id,
    templateName: template.templateName,
    templateFormHeading: template.templateFormHeading ?? template.templateName,
    thumbnailTitleLabel: template.thumbnailTitleLabel,
    fields: fieldsOf(template),
    requiredFields: requiredFieldsOf(template),
  }));

// ---- Checks ----

const HEX = /^#[0-9a-f]{6}$/i;
const KINDS = ['component', 'section', 'frame'] as const;
const KEY = /^[0-9a-f]{40}$/i;

/** Problems with the template set as a whole, checked when the plugin opens. */
export function checkTemplates(editor: TemplateEditor): string[] {
  return templatesFor(editor).length === 0
    ? [`Couldn't show any templates: templates/ has none for ${editor === 'figjam' ? 'FigJam' : 'Figma'}.`]
    : [];
}

/**
 * Lists what stops a template from being built, checked when Create is clicked
 * for that template, before the document is touched. Problems that don't stop
 * it are in templateWarnings instead.
 */
export function checkTemplate(template: TemplateDef): string[] {
  const errors: string[] = [];
  const file = `templates/${template.id}.json`;
  // Every message: what couldn't be done, why, and in which template file.
  const err = (what: string, why: string) => errors.push(`${what}: ${why}. (${file})`);

  /** How an item is called in messages, e.g. `frame "Thumbnail"`. */
  const describe = (item: ContentItem) =>
    isSection(item) ? `section "${item.name ?? item.section}"`
    : isFrame(item) ? `frame "${item.name ?? item.frame}"`
    : item.name ? `component "${item.name}"` : 'a component';

  const checkItems = (items: ContentItem[] | undefined, where: string, insideFrame: boolean, insideAutoLayout = false) => {
    for (const item of items ?? []) {
      const kinds = KINDS.filter((kind) => kind in item);
      if (kinds.length !== 1) {
        err(`Couldn't add an item to ${where}`, `an item needs exactly one of ${KINDS.join(', ')}`);
        continue;
      }
      const name = describe(item);
      if (isComponent(item)) {
        if (!item.component) err(`Couldn't place ${name} in ${where}`, 'its component key is empty');
        else if (!KEY.test(item.component)) err(`Couldn't place ${name} in ${where}`, `"${item.component}" isn't a valid component key`);
      }
      if (isSection(item) && insideFrame) {
        err(`Couldn't create ${name} in ${where}`, 'Figma sections can only sit on a page or in another section, not in a frame');
      }
      if ((isSection(item) || isFrame(item)) && item.fill && item.fill !== 'none' && !HEX.test(item.fill)) {
        err(`Couldn't set the fill of ${name} in ${where}`, `"${item.fill}" isn't a #RRGGBB color or "none"`);
      }
      const fills = [item.sizing?.width, item.sizing?.height].includes('fill');
      if (fills && !insideAutoLayout) err(`Couldn't size ${name} in ${where} to fill`, '"fill" only works inside an auto-layout frame');
      if (item.absolute && !insideAutoLayout) err(`Couldn't position ${name} in ${where} absolutely`, '"absolute" only works inside an auto-layout frame');
      if (isFrame(item) && item.autoLayout && !['horizontal', 'vertical'].includes(item.autoLayout.direction)) {
        err(`Couldn't set auto layout on ${name} in ${where}`, 'its direction must be "horizontal" or "vertical"');
      }
      if (isSection(item) || isFrame(item)) {
        checkItems(item.children, `${where} › ${name}`, insideFrame || isFrame(item), isFrame(item) && !!item.autoLayout);
      }
    }
  };

  if (template.editor !== undefined && !['figma', 'figjam'].includes(template.editor)) {
    err("Couldn't tell where the template is used", `editor must be "figma" or "figjam", not "${template.editor}"`);
  }
  if (!template.thumbnailTitleLabel?.trim()) err("Couldn't set up the name field", 'thumbnailTitleLabel is empty');
  if (!Array.isArray(template.pages) || template.pages.length === 0) err("Couldn't create any pages", 'the template has no pages');
  (template.pages ?? []).forEach((page, i) => {
    if (!page.name?.trim()) {
      err(`Couldn't create page ${i + 1}`, 'its name is empty');
      return;
    }
    const where = `page "${page.name}"`;
    if (page.background && !HEX.test(page.background)) {
      err(`Couldn't set the background of ${where}`, `"${page.background}" isn't a #RRGGBB color`);
    }
    checkItems(page.content, where, false);
  });
  return errors;
}

/**
 * Problems in a template that don't stop it from being built; they're ignored
 * and shown after creating the file.
 */
export function templateWarnings(template: TemplateDef): string[] {
  const warnings: string[] = [];
  const file = `templates/${template.id}.json`;
  // Every message: what couldn't be done, why, what happened instead, and in which template file.
  const warn = (what: string, why: string, instead: string) => warnings.push(`${what}: ${why}. ${instead}. (${file})`);

  if (!template.templateName?.trim()) {
    warn("Couldn't name the template in the File type list", 'templateName is empty', 'It shows without a name');
  }
  for (const field of template.fields ?? []) {
    if (!FORM_FIELDS.includes(field)) {
      warn(`Couldn't show the field "${field}"`, `it isn't a known field (known: ${FORM_FIELDS.join(', ')})`, 'It was left out');
    }
  }
  for (const field of template.requiredFields ?? []) {
    if (field === 'externalAccess') {
      warn("Couldn't make externalAccess required", "it's a switch, so it always has a value", 'It stays optional');
    } else if (!(template.fields ?? []).includes(field)) {
      warn(`Couldn't make "${field}" required`, "it isn't in the template's fields", 'It was ignored');
    }
  }
  for (const placeholder of unknownPlaceholders(template.fileName ?? '', template)) {
    warn(
      `Couldn't fill ${placeholder} in the suggested file name`,
      `it isn't a known placeholder (known: ${placeholdersOf(template).join(', ')})`,
      'It was kept as text',
    );
  }
  for (const page of template.pages ?? []) {
    for (const placeholder of unknownPlaceholders(page.name ?? '', template)) {
      warn(
        `Couldn't fill ${placeholder} in page "${page.name}"`,
        `it isn't a known placeholder (known: ${placeholdersOf(template).join(', ')})`,
        'It was kept as text',
      );
    }
  }
  if (template.mainDesignPage && !(template.pages ?? []).some((page) => page.name === template.mainDesignPage)) {
    warn(
      "Couldn't set the main design page",
      `"${template.mainDesignPage}" isn't one of the template's pages`,
      `"${DEFAULT_PAGE_NAME}" was left as it is`,
    );
  }
  return warnings;
}
