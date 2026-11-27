// The public link works when the current page is a preview, localhost or a file.
// Rebuild from the selected map state so unrelated query parameters stay local.
import {publicAddress} from './publicacion.mjs';
const layers = new Set(['todo', 'lluvias', 'rios', 'mar']);
const placeName = /^[\p{L}\p{M}][\p{L}\p{M}\d .’'()-]{0,79}$/u;
const oneLine = (value, length) => typeof value === 'string'
  ? value.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, length)
  : '';

export function shareUrl({region, ubigeo, ciudad, capa, vista, peligro, aviso} = {}) {
  const url = new URL(publicAddress());
  if (placeName.test(region || '')) url.searchParams.set('region', region.trim());
  if (/^\d{4}(?:\d{2})?$/.test(ubigeo || '')) url.searchParams.set('ubigeo', ubigeo);
  else if (placeName.test(ciudad || '')) url.searchParams.set('ciudad', ciudad.trim());
  const hasPlace = url.searchParams.size > 0;
  if (layers.has(capa) || hasPlace) url.searchParams.set('capa', layers.has(capa) ? capa : 'lluvias');
  if (vista === 'ahora' || vista === 'pronostico') url.searchParams.set('vista', vista);
  if (vista === 'pronostico' && capa === 'lluvias' && peligro === 'quebradas') url.searchParams.set('peligro', peligro);
  if (typeof aviso === 'string' && /^[\w.:-]{1,160}$/.test(aviso)) url.searchParams.set('aviso', aviso);
  return url.href;
}

const dayFormatter = new Intl.DateTimeFormat('es-PE', {
  day:'numeric', month:'long', year:'numeric', timeZone:'America/Lima',
});
const timeFormatter = new Intl.DateTimeFormat('es-PE', {
  hour:'2-digit', minute:'2-digit', hourCycle:'h23', timeZone:'America/Lima',
});
function shareDate(raw) {
  if (typeof raw !== 'string') return '';
  if (/^\d{4}-\d\d-\d\d$/.test(raw)) {
    const fixed = new Date(raw+'T12:00:00-05:00');
    return Number.isFinite(+fixed) && fixed.toISOString().startsWith(raw) ? dayFormatter.format(fixed) : '';
  }
  if (!/^\d{4}-\d\d-\d\dT.+(?:Z|[+-]\d\d:\d\d)$/i.test(raw)) return '';
  const date = new Date(raw);
  if (!Number.isFinite(+date)) return '';
  return dayFormatter.format(date)+' a las '+timeFormatter.format(date)+' (hora de Perú)';
}

// The caller supplies the source's issue/observation date (or edition date for
// an area). A reshare must never make old conditions appear to have happened now.
export function sharePayload(options = {}) {
  const place = oneLine(options.place || options.ciudad || options.region || 'Todo el Perú', 160);
  const title = oneLine(options.title, 220) || 'Perú al Día · '+place;
  const situation = oneLine(options.situation, 420);
  const source = oneLine(options.source, 150);
  const date = shareDate(options.at);
  const lines = options.aviso ? [title] : [];
  if (!title.includes(place)) lines.push(place);
  if (situation && situation !== title) lines.push(situation);
  if (source && date) lines.push(source+' · '+date);
  else if (source || date) lines.push(source || date);
  return {title, text:lines.join('\n'), url:shareUrl(options)};
}

function clipboardText(payload) {
  const includesTitle = payload.text.split('\n')[0] === payload.title;
  return [includesTitle ? '' : payload.title,payload.text,payload.url].filter(Boolean).join('\n');
}

// Keep the native call within the click's user activation. Cancellation is a
// deliberate decision and must not copy data or display another share prompt.
export async function shareOrCopy(payload, {navigator: browser = globalThis.navigator, manual} = {}) {
  if (typeof browser?.share === 'function') {
    try {
      if (!browser.canShare || browser.canShare(payload)) {
        await browser.share(payload);
        return 'shared';
      }
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    if (typeof browser?.clipboard?.writeText === 'function') {
      await browser.clipboard.writeText(clipboardText(payload));
      return 'copied';
    }
  } catch { /* Sandboxed previews and private modes may block the clipboard. */ }
  manual?.(payload);
  return 'manual';
}

export function shareControl(getPayload, {label='Compartir', document: doc = globalThis.document, navigator: browser = globalThis.navigator} = {}) {
  const control = doc.createElement('div');
  control.className = 'share-control';
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'share-button outline-btn';
  button.textContent = label;
  const status = doc.createElement('span');
  status.className = 'share-status';
  status.setAttribute('role','status');
  status.setAttribute('aria-live','polite');
  status.setAttribute('aria-atomic','true');
  const manual = doc.createElement('div');
  manual.className = 'share-manual';
  const copyLink = doc.createElement('button');
  copyLink.type = 'button';
  copyLink.className = 'share-copy';
  copyLink.textContent = 'Copiar solo el enlace';
  copyLink.hidden = true;
  let busy = false;

  function selectManually(payload) {
    const caption = doc.createElement('label');
    caption.textContent = 'Enlace público para copiar';
    const input = doc.createElement('input');
    input.type = 'url';
    input.readOnly = true;
    input.value = payload.url;
    input.addEventListener('click', () => input.select());
    caption.append(input);
    manual.replaceChildren(caption);
    input.focus();
    input.select();
  }
  copyLink.addEventListener('click', async () => {
    const payload = getPayload();
    try {
      if (typeof browser?.clipboard?.writeText !== 'function') throw Error('Sin portapapeles');
      await browser.clipboard.writeText(payload.url);
      status.textContent = 'Enlace copiado.';
    } catch {
      selectManually(payload);
      status.textContent = 'Enlace seleccionado. Usa la opción Copiar de tu dispositivo.';
    }
  });
  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    button.setAttribute('aria-busy','true');
    status.textContent = '';
    manual.replaceChildren();
    copyLink.hidden = true;
    try {
      const payload = getPayload();
      const result = await shareOrCopy(payload, {navigator:browser, manual:selectManually});
      status.textContent = {
        shared:'Consulta lista en la aplicación elegida.', cancelled:'Se cerró el menú de compartir.',
        copied:'Resumen y enlace copiados.', manual:'Enlace seleccionado. Usa la opción Copiar de tu dispositivo.',
      }[result];
      // Some systems also return AbortError when no native targets exist.
      // A new explicit click lets the visitor copy without reopening it.
      copyLink.hidden = result !== 'cancelled';
    } catch {
      status.textContent = 'No se pudo preparar el enlace. Inténtalo nuevamente.';
    } finally {
      busy = false;
      button.removeAttribute('aria-busy');
    }
  });
  control.append(button, status, manual, copyLink);
  return control;
}
