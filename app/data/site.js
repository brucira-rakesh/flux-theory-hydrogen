/** In-app homepage path. Prefer this over legacy `/home` or external hosts. */
export const HOME_URL = '/';

export function isExternalUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}
