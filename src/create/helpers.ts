// Building blocks used by the builder (./index.ts) and the fillers: undo
// tracking, placing library components, and finding and filling layers.

/** Tracks what a run changes, so a failed run can be undone. */
export class CreateContext {
  private readonly undo: (() => void)[] = [];
  /** The page to show when the run finishes (the first one in the structure). */
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

/** Finds a layer by name (and optionally type) inside `root`, or throws a clear error. */
export function layer<T extends SceneNode['type']>(
  root: ChildrenMixin,
  name: string,
  type?: T,
): Extract<SceneNode, { type: T }> {
  const node = root.findOne((n) => n.name === name && (!type || n.type === type));
  if (!node) throw new Error(`Template is missing the layer "${name}"`);
  return node as Extract<SceneNode, { type: T }>;
}

export const textLayer = (root: ChildrenMixin, name: string) => layer(root, name, 'TEXT');
export const instanceLayer = (root: ChildrenMixin, name: string) => layer(root, name, 'INSTANCE');

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
 * Sets component properties by their display name, e.g. { Title: 'Foo' },
 * without the "#123:4" id suffix Figma adds to non-variant properties.
 */
export function setProperties(instance: InstanceNode, values: Record<string, string | boolean>) {
  const keys = Object.keys(instance.componentProperties);
  const resolved: Record<string, string | boolean> = {};
  for (const [name, value] of Object.entries(values)) {
    const key = keys.find((k) => k === name || k.startsWith(`${name}#`));
    if (!key) throw new Error(`Template "${instance.name}" has no property "${name}"`);
    resolved[key] = value;
  }
  instance.setProperties(resolved);
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

/** Replaces "{name}" with the name entered in the form. */
export const interpolate = (text: string, values: { name: string }) => text.replace(/\{name\}/g, values.name);

/** Uses `node` as the file's thumbnail. Not critical, so failures are only logged. */
export async function setFileThumbnail(node: FrameNode) {
  try {
    await figma.setFileThumbnailNodeAsync(node);
  } catch (error) {
    console.warn('Could not set the file thumbnail', error);
  }
}
