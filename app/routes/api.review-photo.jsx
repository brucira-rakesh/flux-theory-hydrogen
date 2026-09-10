import {data} from 'react-router';
import {uploadReviewPhotoToShopify} from '~/lib/shopify-admin-files.server';

/**
 * Resource route — review photo → Shopify Files CDN URL.
 * Returns JSON only; never leaks Admin tokens.
 *
 * @param {Route.ActionArgs} args
 */
export async function action({request, context}) {
  if (request.method !== 'POST') {
    return data({ok: false, error: 'Method not allowed.'}, {status: 405});
  }

  const formData = await request.formData();
  const photo = formData.get('photo');

  if (!(photo instanceof File) || photo.size <= 0) {
    return data({ok: false, error: 'No photo provided.'}, {status: 400});
  }

  const result = await uploadReviewPhotoToShopify({
    env: context.env,
    file: photo,
    filename: photo.name,
    mimeType: photo.type,
  });

  if (!result.ok) {
    console.error('[review-photo] action failed', {error: result.error});
    return data({ok: false, error: result.error}, {status: 400});
  }

  return data({ok: true, url: result.url});
}

/**
 * @param {Route.LoaderArgs} _args
 */
export async function loader(_args) {
  return data({ok: false, error: 'Method not allowed.'}, {status: 405});
}
