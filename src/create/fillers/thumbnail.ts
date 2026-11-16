// Filler "thumbnail": puts the form data into the shared thumbnail (title,
// description, product, external access), wherever it is in what the plugin
// placed: inside a template's cover, or on its own in a frame (Blank). The
// frame directly around the thumbnail becomes the file thumbnail.
//
// Components, properties and layers are found by id (see src/library.ts).

import { findInstances, PRODUCT, THUMBNAIL } from '../../library';
import { hide, setProperties, variantOptions } from '../helpers';
import type { Filler } from '.';

export const fillThumbnail: Filler = async (root, data) => {
  const [thumbnail] = await findInstances(root, THUMBNAIL);
  if (!thumbnail) return {};

  const { title, description, showDescription, accessibleExternally, showContributors, contributors } =
    THUMBNAIL.properties;
  const contributorNames = data.contributors?.trim() ?? '';
  // Description, only for templates whose form asks for it (otherwise data.description
  // is undefined and the thumbnail's description is left exactly as the template has it):
  // filled in → shown with that text; empty → hidden, its text left as it is.
  const descriptionText = data.description?.trim() ?? '';
  const asksDescription = data.description !== undefined;
  setProperties(thumbnail, {
    [title]: data.name,
    ...(asksDescription && { [showDescription]: Boolean(descriptionText) }),
    ...(descriptionText && { [description]: descriptionText }),
    [accessibleExternally]: data.externallyAccessible,
    [showContributors]: Boolean(contributorNames),
    ...(contributorNames && { [contributors]: contributorNames }),
  });

  const [product] = await findInstances(thumbnail, PRODUCT);
  const products = data.products ?? [];
  if (product) await fillProduct(product, products);
  else if (products.length) {
    throw new Error(`Couldn't set the product on "${thumbnail.name}": it has no ${PRODUCT.label} (see src/library.ts)`);
  }

  // Figma only takes a frame as file thumbnail, not the instance itself.
  return thumbnail.parent?.type === 'FRAME' ? { thumbnail: thumbnail.parent } : {};
};

/**
 * One known product uses its own variant. Anything else (an "Other" name,
 * or several products) uses the "Custom" variant with the names as its label.
 * No product hides the pill (the "None" variant still draws an empty outline).
 */
async function fillProduct(pill: InstanceNode, products: string[]) {
  if (products.length === 0) {
    hide(pill);
    return;
  }
  const { product, customName } = PRODUCT.properties;
  const options = await variantOptions(pill, product);
  const known = products.length === 1 ? options.find((o) => o.toLowerCase() === products[0].toLowerCase()) : undefined;
  if (known) {
    setProperties(pill, { [product]: known });
  } else {
    setProperties(pill, { [product]: 'Custom', [customName]: products.join(', ') });
  }
}
