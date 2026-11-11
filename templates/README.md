# File templates

Each JSON file in this folder is one template in the plugin's **File type** list. The file name is the template's id (`project-discovery.json` → `project-discovery`). Files starting with `_` aren't templates: [`_shared.json`](_shared.json) holds the parts several templates use.

```
templates/
  _shared.json              shared library components (e.g. "Start") and pages
  blank.json
  project-discovery.json
  project-hand-off.json
  living-feature-file.json
```

**To add a template**, add a JSON file here (copy an existing one, or capture a Figma file, see below). **To remove one**, delete its file. No code changes either way. After a change, rebuild (`npm run build`, or let `npm run watch` pick it up) and reload the plugin in Figma.

VS Code autocompletes and checks these files against the schemas in [`../schemas/`](../schemas/). The plugin checks them again when it opens and shows a message if something's wrong.

## A template file

```json
{
  "$schema": "../schemas/template.schema.json",
  "order": 2,
  "label": "Product Design: Project discovery",
  "heading": "Project discovery",
  "nameLabel": "Project name",
  "fields": ["contributors", "githubIssueUrl", "products", "externalAccess"],
  "pages": ["thumbnail", { "name": "🔎  Research", "content": [ … ] }]
}
```

| Field | |
|---|---|
| `order` | Position in the File type list, lowest first. Templates without one come last, by label. |
| `label` | Text in the File type list. |
| `heading` | Heading of the details step. Defaults to `label`. |
| `nameLabel` | Label of the name field, e.g. "Title" or "Feature name". The name is always asked for. |
| `fields` | Other form fields to show: `description`, `contributors`, `githubIssueUrl`, `products`, `externalAccess`. |
| `pages` | Pages to build, in order: names of pages in `_shared.json`, or full page definitions. |

## `_shared.json`

```json
{
  "components": {
    "start": { "key": "…", "fill": "thumbnail" }
  },
  "pages": {
    "thumbnail": { "name": "📷  Thumbnail", … }
  }
}
```

- **`components`**: library components by name, used in content as `{ "component": "start" }`.
  - `key`: in the library file, select the published component and run `figma.currentPage.selection[0].key` in the console (Plugins → Development → Show/Hide console).
  - `fill`: the code that puts the form data into the component, from [`src/create/fillers/`](../src/create/fillers/). This is the one part that is code, because it maps form fields onto specific layers. Fillers find layers by name, so renaming a layer in the component means updating its filler. Filled components are always detached.
  - `detach`: detach instances after placing them.
- **`pages`**: page definitions that templates refer to by name.

## Pages

```json
{
  "name": "🔎  Research",
  "background": "#F4F4F4",
  "renameFrom": ["Page 1", "Research"],
  "content": [ … ]
}
```

| Field | |
|---|---|
| `name` | Page name. `{name}` is replaced with the name entered in the form. |
| `background` | Canvas color, `#RRGGBB`. |
| `renameFrom` | Existing pages with one of these names are renamed to `name` instead of a new page being added. A new file's "Page 1" is handled this way. |
| `content` | What to place on the page (see below). |
| `gap`, `direction` | How the content is laid out: `"horizontal"` (default) or `"vertical"`, with `gap` (default 200) between items. |

For each page, the plugin uses, in order of preference:
1. an existing page with the same name,
2. a page named like one of `renameFrom`,
3. a new page.

Pages end up in the order listed, before any other pages in the file. Content is added next to whatever is already on a page.

## Content

Each item is one of three kinds. Items are laid out one after another unless they have a fixed `x`/`y`. `name` sets the layer name, and `{name}` works there too.

**Component:** a name from `_shared.json` `components`, or a published component key.
```json
{ "component": "start", "setAsThumbnail": "Thumbnail" }
{ "component": "c05481d896cdd2bde6a5fd0658621751b7764fa8", "detach": true }
```
`setAsThumbnail`: `true` uses the placed (detached) component as the file thumbnail. A layer name uses the frame with that name inside it.

**Section** and **frame:** containers, optionally with `children`.
```json
{ "section": "Interviews", "children": [
  { "frame": "Notes", "width": 400, "height": 300, "fill": "#FFF8E1" },
  { "section": "{name} flows", "direction": "vertical" }
] }
```
Without `width`/`height`, a container fits its children. `fill` is `#RRGGBB` or `"none"` (Figma's default is white). `padding` (default 100), `gap` (default 100) and `direction` control the children's layout. Figma doesn't allow sections inside frames.

## Capturing a template file

Instead of writing a template by hand, build it in Figma and capture it:

1. Set `CAPTURE = true` in [`code.ts`](../code.ts) and rebuild.
2. Open the template file in Figma, run the plugin, and click **Capture** at the bottom of the File type step.
3. Copy the JSON and save it in this folder under the suggested name (from the Figma file's name), or replace an existing template's file.
4. Adjust `label`, `heading`, `nameLabel`, `fields` and `order`, check the warnings, and move pages that several templates share into `_shared.json`.

What's captured: every page (name, background), and on them sections, frames and library component instances, with names, positions, sizes and fills. Instances of a component in `_shared.json` `components` (e.g. "Start") refer to it by name, so they get filled. Add its key there before capturing. An item is marked `setAsThumbnail` if the file thumbnail is set on it or a frame inside it. The first page gets `"renameFrom": ["Page 1"]`.

What isn't captured, and shows up as a warning: text, shapes, groups, auto layout, instance overrides, and non-solid fills. Instances of local (unpublished) components are captured but flagged, since the plugin can only place published ones. So build template files from published components, sections and frames.

Turn `CAPTURE` off again before publishing the plugin.

## Library components

The plugin can only bring in **published** components: a plugin can't read frames or unpublished components from other files. To use a frame-based layout (like "Start"), make it a component and publish it. The plugin detaches it after placing it, so the new file gets plain frames. Components on a library branch become available once the branch is merged and published.
