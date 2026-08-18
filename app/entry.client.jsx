import {HydratedRouter} from 'react-router/dom';
import {startTransition, StrictMode} from 'react';
import {hydrateRoot} from 'react-dom/client';
import {NonceProvider} from '@shopify/hydrogen';

// Take over scroll restoration app-wide, once, before anything mounts.
// Left on 'auto' the browser keeps re-applying a saved offset as async
// content (preloaded frame sequences, video, images) grows page height
// after mount — a single scrollTo(0,0) in a page effect can't outrace that.
if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

if (!window.location.origin.includes('webcache.googleusercontent.com')) {
  startTransition(() => {
    // Extract nonce from existing script tags
    const existingNonce = document.querySelector('script[nonce]')?.nonce;

    hydrateRoot(
      document,
      <StrictMode>
        <NonceProvider value={existingNonce}>
          <HydratedRouter />
        </NonceProvider>
      </StrictMode>,
    );
  });
}
