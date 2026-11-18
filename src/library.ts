// The shared library components the plugin fills with form data, and how to
// find them. They're shared by every template; each template's cover (which
// contains the thumbnail) lives in its own templates/<id>.json instead.
//
// Everything is identified by id, not by name, so renaming a component, a
// property or a layer in the library doesn't break the plugin:
// - `key`: the component's key, or its component set's key if it has variants.
//   It changes when the component moves to another library; update it here then.
// - `properties`: the id Figma appends to the property name ("Title#829:1" → "829:1").
//   Variant properties have no id, so they're listed by name.
// - `layers`: the layer's id inside the main component (the last part of an
//   instance layer's id, "I5:1705;5025:585" → "5025:585").
//
// To look up the ids, select an instance in Figma and inspect it with the
// plugin API (main component key, componentProperties, layer ids).

export interface LibraryComponent {
  /** For error messages only; the component's name may change. */
  label: string;
  key: string;
  properties?: Record<string, string>;
  layers?: Record<string, string>;
}

/** The thumbnail component. The frame directly around it becomes the file thumbnail. */
export const THUMBNAIL = {
  label: 'Figma Thumbnail / Design File',
  key: '6663693af5fd361811926d93dba80f2a1e3a8715',
  properties: {
    title: '829:1',
    description: '829:4',
    showDescription: '2067:30',
    accessibleExternally: '2071:111',
    showContributors: '5060:2',
    contributors: '5060:3',
  },
} as const satisfies LibraryComponent;

/** The product pill inside the thumbnail (not published on its own, so it's only found, never placed). */
export const PRODUCT = {
  label: '.Figma Thumbnail / Product',
  key: '065810205c688e16d0f8c03281517c4844cbe10c', // component set
  properties: {
    product: 'Product', // variant: one option per product, plus "Custom" and "None"
    customName: '5040:0',
  },
} as const satisfies LibraryComponent;

/** The GitHub link in a cover's "Project Info": a Project Link set to Source=GitHub. */
export const GITHUB_LINK = {
  label: 'Figma Thumbnail / Project Link',
  key: '00cd41797bc9c340764931dc7117cae668d94491', // component set
  properties: {
    source: 'Source', // variant: Figma, Slack, Web, GitHub, None
  },
  // Layers of the Source=GitHub variant.
  layers: {
    label: '3576:1723',
    url: '3576:1726',
  },
} as const satisfies LibraryComponent;

/** Components whose overrides come from the form, so capture doesn't warn about them. */
export const FILLED_COMPONENTS: LibraryComponent[] = [THUMBNAIL, PRODUCT, GITHUB_LINK];

// ---- Loading from the library ----

/** How long loading a library component may take before giving up (e.g. offline). */
const LIBRARY_TIMEOUT = 15_000;

/** `promise`, or an error if it takes longer than LIBRARY_TIMEOUT, so a stuck library load never hangs the plugin. */
export function withLibraryTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Loading from the library timed out')), LIBRARY_TIMEOUT);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

// ---- What the thumbnail can show ----

/** Form fields filled into thumbnail properties, and the properties each needs. */
const THUMBNAIL_FIELD_PROPERTIES = {
  description: [THUMBNAIL.properties.description, THUMBNAIL.properties.showDescription],
  contributors: [THUMBNAIL.properties.contributors, THUMBNAIL.properties.showContributors],
  externalAccess: [THUMBNAIL.properties.accessibleExternally],
} as const;

/** Form fields the thumbnail fills: its properties, and the product pill inside it. */
export type ThumbnailField = keyof typeof THUMBNAIL_FIELD_PROPERTIES | 'products';

/**
 * The form fields the published thumbnail component can't show, so the form
 * disables them: fields whose properties it doesn't have (e.g. after Contributors
 * was removed from it in the library), and products when it has no product pill.
 * null when the component can't be loaded from the library at all (no access,
 * offline, timed out): then the plugin can't create anything (see availability.ts).
 */
export async function missingThumbnailFields(): Promise<ThumbnailField[] | null> {
  let thumbnail: ComponentNode;
  let definitions: ComponentPropertyDefinitions;
  try {
    thumbnail = await withLibraryTimeout(figma.importComponentByKeyAsync(THUMBNAIL.key));
    definitions = thumbnail.componentPropertyDefinitions;
  } catch {
    try {
      const set = await withLibraryTimeout(figma.importComponentSetByKeyAsync(THUMBNAIL.key));
      thumbnail = set.defaultVariant;
      definitions = set.componentPropertyDefinitions;
    } catch {
      return null;
    }
  }
  const keys = Object.keys(definitions);
  const has = (id: string) => keys.some((key) => key === id || key.endsWith(`#${id}`));
  const missing: ThumbnailField[] = (Object.keys(THUMBNAIL_FIELD_PROPERTIES) as (keyof typeof THUMBNAIL_FIELD_PROPERTIES)[])
    .filter((field) => !THUMBNAIL_FIELD_PROPERTIES[field].every(has));
  if ((await findInstances(thumbnail, PRODUCT)).length === 0) missing.push('products');
  return missing;
}

/** Whether a GitHub link (a Project Link set to Source=GitHub) is in `root`, which the link filler fills. */
export async function hasGithubLink(root: SceneNode): Promise<boolean> {
  return (await findInstances(root, GITHUB_LINK)).some(
    (link) => link.componentProperties[GITHUB_LINK.properties.source]?.value === 'GitHub',
  );
}

// ---- Finding instances ----

/** The key that identifies an instance's component: its component set's key if it has one. */
async function componentKeyOf(instance: InstanceNode): Promise<string | null> {
  const main = await instance.getMainComponentAsync();
  if (!main) return null;
  return main.parent?.type === 'COMPONENT_SET' ? main.parent.key : main.key;
}

export async function isInstanceOf(node: SceneNode, component: LibraryComponent): Promise<boolean> {
  return node.type === 'INSTANCE' && (await componentKeyOf(node)) === component.key;
}

/** `root` itself and every instance inside it of `component`. */
export async function findInstances(root: SceneNode, component: LibraryComponent): Promise<InstanceNode[]> {
  const candidates = [root, ...('findAllWithCriteria' in root ? root.findAllWithCriteria({ types: ['INSTANCE'] }) : [])];
  const found: InstanceNode[] = [];
  for (const node of candidates) {
    if (node.type === 'INSTANCE' && (await isInstanceOf(node, component))) found.push(node);
  }
  return found;
}

/** Whether `root` contains (not is) an instance of `component`. */
export async function containsInstanceOf(root: SceneNode, component: LibraryComponent): Promise<boolean> {
  return (await findInstances(root, component)).some((node) => node !== root);
}
