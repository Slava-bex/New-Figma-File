// Building blocks used by the builder (./index.ts) and the fillers: undo
// tracking, placing library components, and finding and filling layers.

/** Tracks what a run changes, so a failed run can be undone. */
export class CreateContext {
  private readonly undo: (() => void)[] = [];
  /** The page to show when the run finishes (the template's first page). */
  firstPage: PageNode | null = null;
  /** Pages already used by this run, so two page definitions never share one. */
  readonly claimedPages = new Set<PageNode>();
  /** Set as the file thumbnail once everything is built. */
  thumbnail: FrameNode | null = null;

  /** Registers a node this run created; it's removed on rollback. */
  track<T extends PageNode | SceneNode>(node: T): T {
    this.onRollback(() => {
      if (!node.removed) node.remove();
    });
    return node;
  }

  onRollback(fn: () => void) {
    this.undo.push(fn);
  }

  rollback() {
    for (const fn of this.undo.reverse()) {
      try {
        fn();
      } catch (error) {
        console.warn('Rollback step failed', error);
      }
    }
    this.undo.length = 0;
  }
}

// ---- Library components ----

export type Parent = PageNode | SectionNode | FrameNode;

/** Places an instance of a published library component in `parent`. */
export async function placeComponent(ctx: CreateContext, componentKey: string, parent: Parent): Promise<InstanceNode> {
  let component: ComponentNode;
  try {
    component = await figma.importComponentByKeyAsync(componentKey);
  } catch {
    throw new Error(
      `Couldn't load component ${componentKey} from the library. Check that it's published and that you have access to it.`,
    );
  }
  const instance = component.createInstance();
  parent.appendChild(instance);
  return ctx.track(instance);
}

// ---- Finding layers ----

/**
 * Finds a text layer in `instance` by its id inside the main component
 * (see src/library.ts), or throws a clear error.
 */
export function textLayerById(instance: InstanceNode, layerId: string): TextNode {
  const node = instance.findOne((n) => n.type === 'TEXT' && n.id.split(';').pop() === layerId);
  if (!node) throw new Error(`Couldn't fill "${instance.name}": missing text layer ${layerId}`);
  return node as TextNode;
}

// ---- Filling layers ----

/** Replaces a text layer's content, keeping its styling. */
export async function setText(node: TextNode, text: string) {
  const fonts =
    node.characters.length > 0
      ? node.getRangeAllFontNames(0, node.characters.length)
      : [node.fontName as FontName];
  await Promise.all(fonts.map((font) => figma.loadFontAsync(font)));
  node.characters = text;
}

/** Makes a text layer a link to `url`. */
export function setLink(node: TextNode, url: string) {
  node.hyperlink = { type: 'URL', value: url };
}

/**
 * Sets component properties by their id, e.g. { '829:1': 'Foo' } for "Title#829:1",
 * so renaming a property doesn't matter. Variant properties have no id and go by name.
 */
export async function setProperties(instance: InstanceNode, values: Record<string, string | boolean>) {
  const keys = Object.keys(instance.componentProperties);
  const resolved: Record<string, string | boolean> = {};
  for (const [id, value] of Object.entries(values)) {
    const key = keys.find((k) => k === id || k.endsWith(`#${id}`));
    if (!key) throw new Error(`Couldn't fill "${instance.name}": missing property "${id}"`);
    resolved[key] = value;
  }
  // Without its fonts loaded, Figma may not redraw the new values until the
  // instance is edited. After the change too: a variant switch can bring new fonts.
  await loadFontsOf(instance);
  instance.setProperties(resolved);
  await loadFontsOf(instance);
}

/** Fonts already loaded in this run; loading is requested once per font. */
const loadedFonts = new Set<string>();

/** Loads every font used by the text layers inside `node`. */
async function loadFontsOf(node: InstanceNode) {
  const fonts = new Map<string, FontName>();
  for (const text of node.findAllWithCriteria({ types: ['TEXT'] })) {
    const used = text.characters.length > 0 ? text.getRangeAllFontNames(0, text.characters.length) : [text.fontName];
    for (const font of used) {
      if (font === figma.mixed) continue;
      const key = `${font.family}|${font.style}`;
      if (!loadedFonts.has(key)) fonts.set(key, font);
    }
  }
  await Promise.all(
    [...fonts].map(async ([key, font]) => {
      await figma.loadFontAsync(font);
      loadedFonts.add(key);
    }),
  );
}

/** The options of a variant property, e.g. every "Product" value. */
export async function variantOptions(instance: InstanceNode, property: string): Promise<string[]> {
  const main = await instance.getMainComponentAsync();
  const owner = main?.parent?.type === 'COMPONENT_SET' ? main.parent : main;
  return owner?.componentPropertyDefinitions[property]?.variantOptions ?? [];
}

export function hide(...nodes: SceneNode[]) {
  for (const node of nodes) node.visible = false;
}

export function show(...nodes: SceneNode[]) {
  for (const node of nodes) node.visible = true;
}

// ---- Misc ----

export function solid(hex: string): SolidPaint {
  const value = hex.replace('#', '');
  const channel = (i: number) => parseInt(value.slice(i, i + 2), 16) / 255;
  return { type: 'SOLID', color: { r: channel(0), g: channel(2), b: channel(4) } };
}

/** Uses `node` as the file's thumbnail. Not critical, so failures are only logged. */
export async function setFileThumbnail(node: FrameNode) {
  try {
    await figma.setFileThumbnailNodeAsync(node);
  } catch (error) {
    console.warn('Could not set the file thumbnail', error);
  }
}
