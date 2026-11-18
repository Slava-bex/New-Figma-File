// Filler "thumbnail": puts the form data into the shared thumbnail (title,
// description, product, external access), wherever it is in what the plugin
// placed: inside a template's cover, or on its own in a frame (Blank). The
// frame directly around the thumbnail becomes the file thumbnail.
//
// Components, properties and layers are found by id (see src/library.ts).

import { findInstances, PRODUCT, THUMBNAIL } from '../../library';
import { hasProperty, hide, setProperties, variantOptions } from '../helpers';
import type { Filler } from '.';

export const fillThumbnail: Filler = async (root, data) => {
  const [thumbnail] = await findInstances(root, THUMBNAIL);
  if (!thumbnail) return {};

  const { title, description, showDescription, accessibleExternally, showContributors, contributors } =
    THUMBNAIL.properties;
  // Description and contributors, only for templates whose form asks for them
  // (otherwise the value is undefined and the thumbnail's own stays exactly as the
  // template has it): filled in → shown with that text; empty → hidden, text left as it is.
  const descriptionText = data.description?.trim() ?? '';
  const asksDescription = data.description !== undefined;
  const contributorNames = data.contributors?.trim() ?? '';
  const asksContributors = data.contributors !== undefined;
  const optional = {
    ...(asksDescription && { [showDescription]: Boolean(descriptionText) }),
    ...(descriptionText && { [description]: descriptionText }),
    [accessibleExternally]: data.externallyAccessible,
    ...(asksContributors && { [showContributors]: Boolean(contributorNames) }),
    ...(contributorNames && { [contributors]: contributorNames }),
  };
  // Only the title is required. Properties the component no longer has are left out:
  // the form disables their fields (see missingThumbnailFields).
  await setProperties(thumbnail, {
    [title]: data.name,
    ...Object.fromEntries(Object.entries(optional).filter(([id]) => hasProperty(thumbnail, id))),
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
    await setProperties(pill, { [product]: known });
  } else {
    await setProperties(pill, { [product]: 'Custom', [customName]: products.join(', ') });
  }
}
