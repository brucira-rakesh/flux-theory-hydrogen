/** Staging / production homepage (Hydrogen app may live on a different host). */
export const HOME_URL = 'https://dev.flux-theory.pages.dev/';

export function isExternalUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}
