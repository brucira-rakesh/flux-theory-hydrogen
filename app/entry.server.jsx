import {ServerRouter} from 'react-router';
import {isbot} from 'isbot';
import {renderToReadableStream} from 'react-dom/server';
import {createContentSecurityPolicy} from '@shopify/hydrogen';

/**
 * @param {Request} request
 * @param {number} responseStatusCode
 * @param {Headers} responseHeaders
 * @param {EntryContext} reactRouterContext
 * @param {HydrogenRouterContextProvider} context
 */
export default async function handleRequest(
  request,
  responseStatusCode,
  responseHeaders,
  reactRouterContext,
  context,
) {
  const {nonce, header, NonceProvider} = createContentSecurityPolicy({
    shop: {
      checkoutDomain: context.env.PUBLIC_CHECKOUT_DOMAIN,
      storeDomain: context.env.PUBLIC_STORE_DOMAIN,
    },
    // Draco/Basis: same-origin decoder scripts + WASM compile + blob workers.
    // Merged with Hydrogen defaults (cdn.shopify.com, nonce, localhost HMR).
    //
    // 'unsafe-eval' is required for Basis/KTX2: KTX2Loader inlines
    // public/basis/basis_transcoder.js into a blob Worker, and that
    // Worker's Emscripten embind glue (craftInvokerFunction /
    // __embind_register_function → newFunc(Function, …)) calls
    // Function() at init. Chromium applies this document's script-src
    // to the Worker, so 'wasm-unsafe-eval' (WASM compile only) is not
    // enough. CSP cannot scope eval to /basis/ or one origin — it is
    // document-wide. Keep Hydrogen's nonce on every other script.
    scriptSrc: [
      "'self'",
      "'unsafe-eval'",
      "'wasm-unsafe-eval'",
      'https://cdn.shopify.com',
      'https://shopify.com',
    ],
    workerSrc: ["'self'", 'blob:'],
    connectSrc: ['blob:'],
    mediaSrc: [
      "'self'",
      context.env.PUBLIC_STORE_DOMAIN,
      'https://cdn.shopify.com',
      'https://shopify.com',
      'http://localhost:*',
    ],
    styleSrc: ['https://fonts.googleapis.com'],
    fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://fonts.googleapis.com'],
  });

  const body = await renderToReadableStream(
    <NonceProvider>
      <ServerRouter
        context={reactRouterContext}
        url={request.url}
        nonce={nonce}
      />
    </NonceProvider>,
    {
      nonce,
      signal: request.signal,
      onError(error) {
        console.error(error);
        responseStatusCode = 500;
      },
    },
  );

  if (isbot(request.headers.get('user-agent'))) {
    await body.allReady;
  }

  responseHeaders.set('Content-Type', 'text/html');
  responseHeaders.set('Content-Security-Policy', header);

  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}

/** @typedef {import('@shopify/hydrogen').HydrogenRouterContextProvider} HydrogenRouterContextProvider */
/** @typedef {import('react-router').EntryContext} EntryContext */
