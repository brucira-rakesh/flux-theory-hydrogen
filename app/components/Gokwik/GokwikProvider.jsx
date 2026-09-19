import {createContext, useCallback, useContext, useLayoutEffect, useMemo, useState} from 'react';
import {useRouteLoaderData} from 'react-router';
import {useNonce} from '@shopify/hydrogen';
import {
  GOKWIK_SCRIPT_ID,
  GOKWIK_SDK_POLL_MS,
  GOKWIK_SDK_TIMEOUT_MS,
  getGokwikMerchantInfo,
  getGokwikCheckoutPayload,
  getGokwikPublicConfig,
  getGokwikSdkSrc,
  installGokwikCustomCheckoutTrigger,
  installGokwikScriptNonceStamp,
  installGokwikSdkStub,
  isGokwikMerchantConfigured,
  isShopifyCartGid,
} from '~/lib/gokwik';

const GokwikContext = createContext(null);

/**
 * Sets public merchant config on window. Never writes cart or PII.
 * @param {ReturnType<typeof getGokwikPublicConfig>} config
 */
function applyMerchantInfo(config) {
  window.merchantInfo = getGokwikMerchantInfo(config);
}

/**
 * Loads the GoKwik SDK after merchantInfo is on window, tracks ready/error,
 * and listens for order-complete so Scenario 2 can rotate the Hydrogen cart.
 * @param {{children: React.ReactNode}} props
 */
export function GokwikProvider({children}) {
  const nonce = useNonce();
  const root = useRouteLoaderData('root');
  const gokwikConfig = root?.gokwik ?? getGokwikPublicConfig();
  const environment = gokwikConfig.environment;

  const [isGokwikReady, setIsGokwikReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loadGeneration, setLoadGeneration] = useState(0);

  const retryGokwikLoad = useCallback(() => {
    setLoadError(false);
    setIsGokwikReady(false);
    setLoadGeneration((value) => value + 1);
  }, []);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') return undefined;

    applyMerchantInfo(gokwikConfig);
    const restoreAppend = installGokwikScriptNonceStamp(nonce);

    if (window.gokwikCheckoutApp) {
      if (!window.gokwikSdk) installGokwikSdkStub();
      installGokwikCustomCheckoutTrigger();
      setIsGokwikReady(true);
      setLoadError(false);
      return restoreAppend;
    }

    // v4 only mounts its UI when gokwikSdk is missing (`if (!window.gokwikSdk)`).
    try {
      delete window.gokwikSdk;
    } catch {
      window.gokwikSdk = undefined;
    }

    let cancelled = false;
    let intervalId = 0;
    let timeoutId = 0;

    const stopWaiting = () => {
      window.clearInterval(intervalId);
      window.clearTimeout(timeoutId);
    };

    const markReady = () => {
      if (cancelled || !window.gokwikCheckoutApp) return false;
      stopWaiting();
      if (!window.gokwikSdk) installGokwikSdkStub();
      installGokwikCustomCheckoutTrigger();
      setIsGokwikReady(true);
      setLoadError(false);
      return true;
    };

    const fail = () => {
      if (cancelled || window.gokwikCheckoutApp) return;
      stopWaiting();
      console.error('GoKwik SDK failed to load');
      setIsGokwikReady(false);
      setLoadError(true);
    };

    document.querySelectorAll('#gokwik-sdk, #gokwik-sdk-script').forEach((node) => {
      node.remove();
    });

    const script = document.createElement('script');
    script.id = GOKWIK_SCRIPT_ID;
    script.src = getGokwikSdkSrc(environment);
    script.async = true;
    if (nonce) {
      script.nonce = nonce;
      script.setAttribute('nonce', nonce);
    }
    script.addEventListener('load', markReady);
    script.addEventListener('error', fail);
    document.body.appendChild(script);

    intervalId = window.setInterval(markReady, GOKWIK_SDK_POLL_MS);
    timeoutId = window.setTimeout(fail, GOKWIK_SDK_TIMEOUT_MS);

    return () => {
      cancelled = true;
      stopWaiting();
      script.removeEventListener('load', markReady);
      script.removeEventListener('error', fail);
      restoreAppend();
    };
  }, [environment, gokwikConfig, loadGeneration, nonce]);

  useLayoutEffect(() => {
    if (!isGokwikReady || typeof window === 'undefined') return undefined;

    const sdk = window.gokwikSdk;
    if (!sdk || typeof sdk.on !== 'function') return undefined;

    const onOrderComplete = () => {
      if (window.location.pathname === '/thank-you') return;
      window.location.assign('/thank-you');
    };

    sdk.on('order-complete', onOrderComplete);
    return undefined;
  }, [isGokwikReady]);

  const triggerCheckout = useCallback(
    (cartId) => {
      if (!isShopifyCartGid(cartId)) {
        const message =
          'GoKwik checkout requires a Storefront Cart GID in the format gid://shopify/Cart/<CARTID>.';
        console.error(message);
        throw new Error(message);
      }

      if (typeof window === 'undefined') {
        const message =
          'GoKwik SDK is not ready. Cannot call triggerGokwikCustomCheckout().';
        console.error(message);
        throw new Error(message);
      }

      installGokwikSdkStub();
      installGokwikCustomCheckoutTrigger();

      if (!isGokwikMerchantConfigured(gokwikConfig)) {
        console.error(
          'GoKwik merchant ID is not configured. Set PUBLIC_GOKWIK_MERCHANT_ID on the Hydrogen environment.',
        );
        throw new Error('Checkout is temporarily unavailable. Please try again.');
      }

      if (typeof window.triggerGokwikCustomCheckout !== 'function') {
        const message =
          'GoKwik SDK loaded but triggerGokwikCustomCheckout() is unavailable.';
        console.error(message);
        throw new Error(message);
      }

      const payload = getGokwikCheckoutPayload(gokwikConfig, cartId);
      try {
        window.localStorage.setItem('shopifyCartId', payload.cart.id);
      } catch {
        // Private mode — GoKwik still gets the GID on merchantInfo.
      }
      window.merchantInfo = payload;
      window.triggerGokwikCustomCheckout();
    },
    [gokwikConfig],
  );

  const value = useMemo(
    () => ({
      isGokwikReady,
      loadError,
      retryGokwikLoad,
      triggerCheckout,
    }),
    [isGokwikReady, loadError, retryGokwikLoad, triggerCheckout],
  );

  return <GokwikContext.Provider value={value}>{children}</GokwikContext.Provider>;
}

/**
 * Shared GoKwik checkout API for cart drawer, cart page, and PDP.
 */
export function useGokwikCheckout() {
  const context = useContext(GokwikContext);
  if (context) return context;

  return {
    isGokwikReady: false,
    loadError: false,
    retryGokwikLoad: () => {},
    triggerCheckout: () => {
      const message =
        'GoKwik checkout was called without GokwikProvider. Cannot start checkout.';
      console.error(message);
      throw new Error(message);
    },
  };
}
