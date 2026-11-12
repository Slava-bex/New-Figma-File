# File templates

Each JSON file in this folder is one template in the plugin's **File type** list. The file name is the template's id. Templates are generated from Figma files by the plugin's capture tool, so you don't write them by hand.

## Adding or updating a template

1. Build the template file in Figma (see the requirements below).
2. Set `CAPTURE = true` in [`code.ts`](../code.ts) and rebuild.
3. Open the template file in Figma, run the plugin and click **Capture** at the bottom of the File type step.
4. Copy the JSON into this folder under the suggested file name, or over the template it replaces.
5. Set the form details at the top of the file:
   - `templateName`: name in the File type list
   - `order`: position in the list
   - `thumbnailTitleLabel`: label of the name field, e.g. "Project name"
   - `fields`: which other form fields to show
   - `requiredFields`: which of those must be filled in, e.g. `["products"]` for at least one product
   - `fileName`: the file name suggested after creating, e.g. `[Product] - [Project name]`. Placeholders: the `thumbnailTitleLabel` in brackets, and `[Product]` (only filled when exactly one product is selected). Empty ones are left out together with their separator.
   - `mainDesignPage`: the page that takes over the file's existing "Page 1", keeping its content. Leave it empty if the template has no main design page.
6. Rebuild (`npm run build`, or let `npm run watch` pick it up) and reload the plugin.

Turn `CAPTURE` off again before publishing the plugin.

To remove a template, delete its file.

## Requirements for the Figma template file

- **Build it from sections, frames and published library components only.** Auto layout is captured. Text, shapes, groups and changes made to instances aren't captured due to simplicity of the plugin choice. The capture lists them as warnings.
- **Thumbnail instnance must be wrapped in a regular frame.** The plugin uses wrapper frame as the file thumbnail, since Figma can't use instances as thumbnails.
