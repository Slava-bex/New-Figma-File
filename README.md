# New Figma File

Figma plugin that sets up a new design file (pages, thumbnail) based off a chosen template.

1. Open a new Figma file
2. Run **New Figma File** plugin
3. Pick a template and fill in the details. Click **Create file structure**.


## Safe to run on existing files

- Plugin saves a named backup to the file's version history before applying any changes.
- Does not modify or delete existing content.


## Changing templates

Templates are built manually as Figma files. Run the plugin with feature flag CAPTURE=true and use **Capture** button to convert the Figma file into JSON template. Plugin re-build required. See [templates/README.md](templates/README.md).

- **Add or update a template:** build the file in Figma, capture it, and save the result in `/templates/`. (Configure JSON where needed)
- **Remove a template:** delete its file from `/templates/`.
- **Rename or reorder templates:** edit the template's name and order at the top of its file.
