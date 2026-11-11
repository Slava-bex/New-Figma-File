// Filler "thumbnail": puts the form data into the "Start" template, i.e. the
// cover (title, contributors, product, privacy) and the info section below it
// (links, project team). Source: Libraries - Touchpoints Overview, node 2204:11574.
// The component's key is set in templates/_shared.json ("start").
//
// The plugin finds layers by the names below, so renaming them in the
// template means updating them here too.

import type { NewFileData } from '../../types';
import {
  hide,
  instanceLayer,
  setLink,
  setProperties,
  setText,
  show,
  textLayer,
  variantOptions,
} from '../helpers';

export async function fillThumbnailTemplate(template: FrameNode, data: NewFileData) {
  await fillCover(instanceLayer(template, 'Figma / Thumbnail Design File'), data);
  await fillLinks(template, data);
  // Project team (layer "Team Master") keeps its placeholders: the UI doesn't collect roles yet.
}

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

async function fillLinks(template: FrameNode, data: NewFileData) {
  if (!data.githubIssueUrl) return; // Keep the placeholder to fill in later.
  const [label, link] = instanceLayer(template, 'Link Item').findAll(
    (n): n is TextNode => n.type === 'TEXT' && n.name === 'Link Text',
  ) as TextNode[];
  if (!label || !link) throw new Error('Template "Link Item" is missing its "Link Text" layers');

  const [, repo, number] = data.githubIssueUrl.match(/github\.com\/[^/]+\/([^/]+)\/issues\/(\d+)/) ?? [];
  await setText(label, 'GitHub issue');
  await setText(link, repo ? `${repo}#${number}` : data.githubIssueUrl);
  setLink(link, data.githubIssueUrl);
}
