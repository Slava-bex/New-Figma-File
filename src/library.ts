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
