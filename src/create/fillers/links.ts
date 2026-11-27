// Filler "links": puts the GitHub issue into the cover's GitHub project link
// (a Project Link set to Source=GitHub), if the placed content has one.
//
// Components and layers are found by id (see src/library.ts).

import { findInstances, GITHUB_LINK, variantValue } from '../../library';
import { setLink, setText, textLayerById } from '../helpers';
import type { Filler } from '.';

export const fillLinks: Filler = async (root, data) => {
  if (!data.githubIssueUrl) return {}; // Keep the placeholder to fill in later.

  for (const link of await findInstances(root, GITHUB_LINK)) {
    if ((await variantValue(link, GITHUB_LINK.properties.source)) !== 'GitHub') continue;
    const label = textLayerById(link, GITHUB_LINK.layers.label);
    const url = textLayerById(link, GITHUB_LINK.layers.url);

    const [, repo, number] = data.githubIssueUrl.match(/github\.com\/[^/]+\/([^/]+)\/issues\/(\d+)/) ?? [];
    await setText(label, 'GitHub issue');
    await setText(url, repo ? `${repo}#${number}` : data.githubIssueUrl);
    setLink(url, data.githubIssueUrl);
    break; // Only the first GitHub link.
  }
  return {};
};
