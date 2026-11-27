// The organization site reads each edition from the same GitHub Pages publisher.
const publisher = 'https://jccv26.github.io/atlas-el-nino-peru/';
const brand = 'https://perualdia.github.io';

export function editionBase(page = location.href) {
  const url = new URL(page);
  return url.origin === brand ? new URL(publisher) : new URL('./', url);
}

export function editionAsset(path, page = location.href) {
  const base = editionBase(page);
  const result = new URL(path, base);
  if (result.origin !== base.origin || !result.pathname.startsWith(base.pathname) || result.username || result.password) {
    throw new Error('Recurso fuera del publicador de Perú al Día');
  }
  return result;
}

export function publicAddress(page = globalThis.location?.href) {
  return page && new URL(page).origin === brand ? brand+'/' : publisher;
}
