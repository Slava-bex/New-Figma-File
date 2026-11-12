// Filler "thumbnail": puts the form data into the thumbnail cover (title,
// description, contributors, product, privacy) and the GitHub "Link Item",
// wherever they are in what the plugin placed. The frame directly around the
// cover becomes the file thumbnail.
//
// The plugin finds layers by the names below, so renaming them in the library
// means updating them here too.

import type { NewFileData } from '../../types';
import { hide, instanceLayer, setLink, setProperties, setText, show, textLayer, variantOptions } from '../helpers';
import type { Filler } from '.';

export const COVER = 'Figma / Thumbnail Design File';
export const LINK_ITEM = 'Link Item';

/** `root` itself or the first layer inside it that is an instance named `name`. */
function findInstance(root: SceneNode, name: string): InstanceNode | null {
  if (root.type === 'INSTANCE' && root.name === name) return root;
  if (!('findOne' in root)) return null;
  return root.findOne((n) => n.type === 'INSTANCE' && n.name === name) as InstanceNode | null;
}

export const fillThumbnail: Filler = async (root, data) => {
  const cover = findInstance(root, COVER);
  if (cover) await fillCover(cover, data);

  const linkItem = findInstance(root, LINK_ITEM);
  if (linkItem) await fillLink(linkItem, data);
  // Project team (layer "Team Master") keeps its placeholders: the UI doesn't collect roles yet.

  // Figma only takes a frame as file thumbnail, not the cover instance itself.
  return cover?.parent?.type === 'FRAME' ? { thumbnail: cover.parent } : {};
};

// ---- Cover ----

async function fillCover(cover: InstanceNode, data: NewFileData) {
  setProperties(cover, {
    Title: data.name,
    Description: data.description ?? '',
    'Show Description': Boolean(data.description),
    'Accessible Externally': data.externallyAccessible,
  });

  // Newer versions of the cover hide these layers by default (no property for it).
  const contributorLayers = [textLayer(cover, 'Contributors Label'), textLayer(cover, 'Contributors')];
  const contributors = data.contributors?.trim();
  if (contributors) {
    await setText(contributorLayers[1], contributors);
    show(...contributorLayers);
  } else {
    hide(...contributorLayers);
  }

  await fillProduct(instanceLayer(cover, '.Figma / Thumbnail Product'), data.products ?? []);
}

/**
 * One known product uses its own variant. Anything else (an "Other" name,
 * or several products) uses the "Custom" variant with the names as its label.
 * No product hides the pill (the "None" variant still draws an empty outline).
 */
async function fillProduct(product: InstanceNode, products: string[]) {
  if (products.length === 0) {
    hide(product);
    return;
  }
  const options = await variantOptions(product, 'Product');
  const known = products.length === 1 ? options.find((o) => o.toLowerCase() === products[0].toLowerCase()) : undefined;
  if (known) {
    setProperties(product, { Product: known });
  } else {
    setProperties(product, { Product: 'Custom' });
    await setText(textLayer(product, 'Name'), products.join(', '));
  }
}

// ---- Links ----

async function fillLink(linkItem: InstanceNode, data: NewFileData) {
  if (!data.githubIssueUrl) return; // Keep the placeholder to fill in later.
  const [label, link] = linkItem.findAll(
    (n): n is TextNode => n.type === 'TEXT' && n.name === 'Link Text',
  ) as TextNode[];
  if (!label || !link) throw new Error('"Link Item" is missing its "Link Text" layers');

  const [, repo, number] = data.githubIssueUrl.match(/github\.com\/[^/]+\/([^/]+)\/issues\/(\d+)/) ?? [];
  await setText(label, 'GitHub issue');
  await setText(link, repo ? `${repo}#${number}` : data.githubIssueUrl);
  setLink(link, data.githubIssueUrl);
}
