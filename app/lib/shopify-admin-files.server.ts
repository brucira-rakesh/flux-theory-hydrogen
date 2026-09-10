/**
 * Shopify Admin Files API — staged upload → fileCreate → public CDN URL.
 * Server-only. Authenticated via `getAdminAccessToken` (client credentials).
 *
 * Requires app scope `write_files` (and typically `read_files` for polling).
 */

import {
  adminShopOrigin,
  getAdminAccessToken,
  type AdminTokenEnv,
} from './shopify-admin-token.server';

export const ADMIN_API_VERSION = '2025-10';

const STAGED_UPLOADS_CREATE = `#graphql
  mutation StagedUploadsCreate($input: [StagedUploadInput!]!) {
    stagedUploadsCreate(input: $input) {
      stagedTargets {
        url
        resourceUrl
        parameters {
          name
          value
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const FILE_CREATE = `#graphql
  mutation FileCreate($files: [FileCreateInput!]!) {
    fileCreate(files: $files) {
      files {
        id
        fileStatus
        alt
        ... on MediaImage {
          image {
            url
          }
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const FILE_BY_ID = `#graphql
  query FileById($id: ID!) {
    node(id: $id) {
      ... on MediaImage {
        id
        fileStatus
        image {
          url
        }
      }
      ... on GenericFile {
        id
        fileStatus
        url
      }
    }
  }
`;

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const MAX_BYTES = 8 * 1024 * 1024;
const POLL_ATTEMPTS = 12;
const POLL_DELAY_MS = 400;

/**
 * @param {AdminTokenEnv} env
 * @param {string} query
 * @param {Record<string, unknown>} [variables]
 * @param {string} [stepLabel]
 */
async function adminGraphql(
  env: AdminTokenEnv,
  query: string,
  variables = {},
  stepLabel = 'graphql',
) {
  const token = await getAdminAccessToken(env);
  const storeDomain = env.PUBLIC_STORE_DOMAIN?.trim();
  if (!storeDomain) {
    throw new Error('PUBLIC_STORE_DOMAIN is required for Admin GraphQL.');
  }

  const url = `${adminShopOrigin(storeDomain)}/admin/api/${ADMIN_API_VERSION}/graphql.json`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({query, variables}),
  });

  if (!response.ok) {
    throw new Error(
      `Admin GraphQL HTTP ${response.status} at step=${stepLabel}`,
    );
  }

  const payload = (await response.json()) as {
    data?: Record<string, unknown>;
    errors?: Array<{message?: string; extensions?: {code?: string}}>;
  };

  if (payload.errors?.length) {
    const message = payload.errors
      .map((error) => {
        const code = error.extensions?.code
          ? ` [${error.extensions.code}]`
          : '';
        return `${error.message || 'Unknown GraphQL error'}${code}`;
      })
      .join('; ');
    throw new Error(`Admin GraphQL at step=${stepLabel}: ${message}`);
  }

  return payload.data ?? {};
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Upload one review photo to Shopify Files and return a public CDN URL.
 *
 * @returns {{ok: true, url: string} | {ok: false, error: string}}
 */
export async function uploadReviewPhotoToShopify({
  env,
  file,
  filename,
  mimeType,
}: {
  env: AdminTokenEnv;
  file: Blob;
  filename?: string;
  mimeType?: string;
}): Promise<{ok: true; url: string} | {ok: false; error: string}> {
  let step = 'validate';

  try {
    const name =
      (filename || (file instanceof File ? file.name : '') || 'review.jpg')
        .replace(/[^\w.\-]+/g, '_')
        .slice(0, 120) || 'review.jpg';
    const type =
      mimeType ||
      (file instanceof File ? file.type : '') ||
      'image/jpeg';

    if (!ALLOWED_MIME.has(type)) {
      return {
        ok: false,
        error: 'Use a JPEG, PNG, WebP, or GIF image.',
      };
    }
    if (typeof file.size === 'number' && file.size > MAX_BYTES) {
      return {ok: false, error: 'Photo must be 8 MB or smaller.'};
    }
    if (typeof file.size === 'number' && file.size <= 0) {
      return {ok: false, error: 'Empty file.'};
    }

    step = '1_token_exchange';
    await getAdminAccessToken(env);

    step = '2_stagedUploadsCreate';
    const stagedData = (await adminGraphql(
      env,
      STAGED_UPLOADS_CREATE,
      {
        input: [
          {
            filename: name,
            mimeType: type,
            httpMethod: 'POST',
            resource: 'IMAGE',
            fileSize: String(file.size),
          },
        ],
      },
      step,
    )) as {
      stagedUploadsCreate?: {
        stagedTargets?: Array<{
          url?: string;
          resourceUrl?: string;
          parameters?: Array<{name?: string; value?: string}>;
        }>;
        userErrors?: Array<{message?: string}>;
      };
    };

    const stagedErrors = stagedData.stagedUploadsCreate?.userErrors ?? [];
    if (stagedErrors.length) {
      console.error('[review-photo]', {step, stagedErrors});
      return {
        ok: false,
        error: stagedErrors[0]?.message || 'Could not start photo upload.',
      };
    }

    const target = stagedData.stagedUploadsCreate?.stagedTargets?.[0];
    if (!target?.url || !target.resourceUrl) {
      console.error('[review-photo]', {
        step,
        detail: 'stagedUploadsCreate returned no url/resourceUrl',
      });
      return {ok: false, error: 'Could not start photo upload.'};
    }

    step = '3_staged_url_upload';
    const form = new FormData();
    for (const param of target.parameters ?? []) {
      if (param?.name != null && param?.value != null) {
        form.append(param.name, param.value);
      }
    }
    form.append('file', file, name);

    const uploadResponse = await fetch(target.url, {
      method: 'POST',
      body: form,
    });

    if (!uploadResponse.ok) {
      const bodyText = await uploadResponse.text().catch(() => '');
      console.error('[review-photo]', {
        step,
        status: uploadResponse.status,
        body: bodyText.slice(0, 300),
      });
      return {
        ok: false,
        error: `Photo upload failed (${uploadResponse.status}).`,
      };
    }

    step = '4_fileCreate';
    const createData = (await adminGraphql(
      env,
      FILE_CREATE,
      {
        files: [
          {
            alt: 'Customer review photo',
            contentType: 'IMAGE',
            originalSource: target.resourceUrl,
          },
        ],
      },
      step,
    )) as {
      fileCreate?: {
        files?: Array<{
          id?: string;
          fileStatus?: string;
          image?: {url?: string | null} | null;
        }>;
        userErrors?: Array<{message?: string}>;
      };
    };

    const createErrors = createData.fileCreate?.userErrors ?? [];
    if (createErrors.length) {
      console.error('[review-photo]', {step, createErrors});
      return {
        ok: false,
        error: createErrors[0]?.message || 'Could not register photo.',
      };
    }

    const created = createData.fileCreate?.files?.[0];
    if (!created?.id) {
      console.error('[review-photo]', {
        step,
        detail: 'fileCreate returned no file id',
      });
      return {ok: false, error: 'Could not register photo.'};
    }

    if (created.fileStatus === 'READY' && created.image?.url) {
      return {ok: true, url: created.image.url};
    }

    step = '5_poll_cdn_url';
    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
      await sleep(POLL_DELAY_MS);
      const pollData = (await adminGraphql(
        env,
        FILE_BY_ID,
        {id: created.id},
        `${step}_attempt_${attempt + 1}`,
      )) as {
        node?: {
          fileStatus?: string;
          image?: {url?: string | null} | null;
          url?: string | null;
        } | null;
      };

      const node = pollData.node;
      if (!node) continue;

      if (node.fileStatus === 'FAILED') {
        console.error('[review-photo]', {
          step,
          detail: `fileStatus=FAILED id=${created.id}`,
        });
        return {ok: false, error: 'Shopify could not process this photo.'};
      }

      const url = node.image?.url || node.url || null;
      if (node.fileStatus === 'READY' && url) {
        return {ok: true, url};
      }
    }

    console.error('[review-photo]', {
      step,
      detail: `Timed out polling file ${created.id}`,
    });
    return {
      ok: false,
      error: 'Photo is still processing. Try again in a moment.',
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);
    console.error('[review-photo]', {
      step,
      error,
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });

    if (/ACCESS_DENIED|access denied|permission/i.test(message)) {
      return {
        ok: false,
        error:
          'Photo upload is unavailable (Admin app may be missing write_files).',
      };
    }

    return {ok: false, error: 'Photo upload failed. Please try again.'};
  }
}
