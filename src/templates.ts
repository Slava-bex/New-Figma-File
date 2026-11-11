// The file templates (templates/*.json) and shared parts (templates/_shared.json):
// types, lookups and checks. See templates/README.md for how to edit them.

import loaded from 'virtual:templates';
import { FILLERS } from './create/fillers';
import { FORM_FIELDS, type FileType, type FormField } from './types';

// ---- Shapes of the JSON files ----

export interface SharedDef {
  /** Named library components, used in content as { "component": "<name>" }. */
  components: Record<string, ComponentDef>;
  /** Pages that several templates use, referenced by name. */
  pages: Record<string, PageDef>;
}

export interface ComponentDef {
  /** Key of the published library component. */
  key: string;
  /** Code that fills it with form data (src/create/fillers.ts). Filled components are always detached. */
  fill?: string;
  detach?: boolean;
}

export interface TemplateDef {
  /** File name without .json. */
  id: FileType;
  order?: number;
  /** Text in the File type list. */
  label: string;
  /** Heading of the details step (defaults to label). */
  heading?: string;
  /** Label of the name field. */
  nameLabel: string;
  /** Form fields shown besides the name. */
  fields: FormField[];
  /** Page names from _shared.json, or full page definitions. */
  pages: (string | PageDef)[];
}

export interface PageDef {
  /** Page name. "{name}" is replaced with the name entered in the form. */
  name: string;
  /** Hex color, e.g. "#F4F4F4". */
  background?: string;
  /** Existing pages with one of these names are renamed to `name` instead of creating a new page. */
  renameFrom?: string[];
  content?: ContentItem[];
  /** Space between top-level items on the page. */
  gap?: number;
  direction?: Direction;
}

export type Direction = 'horizontal' | 'vertical';

interface Placement {
  /** Layer name (defaults to the section/frame name or the component's name). */
  name?: string;
  /** Fixed position. Without it, items are laid out one after another. */
  x?: number;
  y?: number;
}

export interface ComponentItem extends Placement {
  /** A name from _shared.json "components", or a published component key. */
  component: string;
  detach?: boolean;
  /** Use the placed component (true) or a frame inside it (by layer name) as the file thumbnail. */
  setAsThumbnail?: boolean | string;
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
}

export type ContentItem = ComponentItem | SectionItem | FrameItem;

export const isComponent = (item: ContentItem): item is ComponentItem => 'component' in item;
export const isSection = (item: ContentItem): item is SectionItem => 'section' in item;
export const isFrame = (item: ContentItem): item is FrameItem => 'frame' in item;

// ---- Loaded data ----

const data = loaded as unknown as { shared: Partial<SharedDef>; templates: TemplateDef[] };

export const SHARED: SharedDef = {
  components: data.shared.components ?? {},
  pages: data.shared.pages ?? {},
};

/** All templates, in list order. */
export const TEMPLATES: TemplateDef[] = [...data.templates].sort(
  (a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || a.label.localeCompare(b.label),
);

export const findTemplate = (id: FileType) => TEMPLATES.find((template) => template.id === id);

/** A component item resolved to its key and how to place it. */
export function resolveComponent(item: ComponentItem): { key: string; fill?: string; detach: boolean } {
  const named = SHARED.components[item.component];
  if (!named) return { key: item.component, detach: item.detach ?? false };
  return { key: named.key, fill: named.fill, detach: Boolean(named.fill) || (item.detach ?? named.detach ?? false) };
}

/** The pages of a template, with shared page names resolved. */
export function pagesFor(template: TemplateDef): PageDef[] {
  return template.pages.map((page) => (typeof page === 'string' ? SHARED.pages[page] : page));
}

/** What the UI needs to show a template. */
export const templateSummaries = () =>
  TEMPLATES.map(({ id, label, heading, nameLabel, fields }) => ({ id, label, heading: heading ?? label, nameLabel, fields }));

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

  for (const [name, component] of Object.entries(SHARED.components)) {
    const where = `_shared.json components.${name}`;
    if (!component.key) err(where, 'key is empty');
    if (component.fill && !(component.fill in FILLERS)) {
      err(where, `unknown fill "${component.fill}" (known: ${Object.keys(FILLERS).join(', ')})`);
    }
  }

  const checkItems = (items: ContentItem[] | undefined, where: string, insideFrame: boolean) => {
    (items ?? []).forEach((item, i) => {
      const at = `${where}[${i}]`;
      const kinds = KINDS.filter((kind) => kind in item);
      if (kinds.length !== 1) {
        err(at, `needs exactly one of ${KINDS.join(', ')}`);
        return;
      }
      if (isComponent(item)) {
        if (!SHARED.components[item.component] && !KEY.test(item.component)) {
          err(at, `"${item.component}" isn't a name from _shared.json components or a component key`);
        }
        if (item.setAsThumbnail === true && !resolveComponent(item).detach) {
          err(at, 'setAsThumbnail: true needs a detached component (Figma can\'t use an instance as thumbnail)');
        }
      }
      if (isSection(item) && insideFrame) err(at, 'Figma sections can only sit on a page or in another section');
      if ((isSection(item) || isFrame(item)) && item.fill && item.fill !== 'none' && !HEX.test(item.fill)) {
        err(at, `fill "${item.fill}" isn't a #RRGGBB color or "none"`);
      }
      if (isSection(item) || isFrame(item)) checkItems(item.children, `${at}.children`, insideFrame || isFrame(item));
    });
  };

  const checkPage = (page: PageDef, where: string) => {
    if (!page.name?.trim()) err(where, 'name is empty');
    if (page.background && !HEX.test(page.background)) err(where, `background "${page.background}" isn't a #RRGGBB color`);
    checkItems(page.content, `${where}.content`, false);
  };

  for (const [name, page] of Object.entries(SHARED.pages)) checkPage(page, `_shared.json pages.${name}`);

  if (TEMPLATES.length === 0) err('templates/', 'no templates found');
  for (const template of TEMPLATES) {
    const file = `${template.id}.json`;
    if (!template.label?.trim()) err(file, 'label is empty');
    if (!template.nameLabel?.trim()) err(file, 'nameLabel is empty');
    for (const field of template.fields ?? []) {
      if (!FORM_FIELDS.includes(field)) err(file, `unknown field "${field}" (known: ${FORM_FIELDS.join(', ')})`);
    }
    if (!Array.isArray(template.pages) || template.pages.length === 0) err(file, 'pages is empty');
    (template.pages ?? []).forEach((page, i) => {
      const where = `${file} pages[${i}]`;
      if (typeof page === 'string') {
        if (!SHARED.pages[page]) err(where, `unknown shared page "${page}"`);
      } else {
        checkPage(page, where);
      }
    });
  }
  return errors;
}
