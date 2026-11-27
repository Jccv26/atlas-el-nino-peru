// Public feeds are used for discovery. Only titles, attribution, dates and links
// leave this module. A publisher's story never becomes an official warning.
import {coversPeru, nationalFeeds, readNationalEntries} from './medios-nacionales.mjs';

const nationalIds = new Set(nationalFeeds.map(([id]) => id));
// The public WordPress REST collection can omit article bodies and image fields.
const wpFields = 'id,date_gmt,modified_gmt,link,title';
function wordpress(host, internationalSection) {
  const excluded = internationalSection ? '&categories_exclude=' + internationalSection : '';
  return 'https://' + host + '/wp-json/wp/v2/posts?per_page=60&orderby=date&order=desc&_fields=' + wpFields + excluded;
}
const definitions = [
  ['andina', 'Andina', 'https://andina.pe/agencia/rss.aspx', 10],
  ...nationalFeeds,
  ['el-tiempo-piura', 'El Tiempo de Piura', 'https://eltiempo.pe/feed/', 20, 'Piura'],
  ['cutivalu', 'Cutivalú', 'https://www.cutivalu.pe/wp-json/wp/v2/posts?per_page=50&orderby=modified&order=desc&_fields=' + wpFields, 20, 'Piura'],
  ['el-buho', 'El Búho', 'https://elbuho.pe/feed/', 30, 'Arequipa'],
  ['voz-selva', 'Radio La Voz de la Selva', 'https://radiolavozdelaselva.org/feed/', 30, 'Loreto'],
  ['walac', 'Walac Noticias', wordpress('walac.pe'), 20, 'Piura'],
  ['pachamama-radio', 'Pachamama Radio', wordpress('pachamamaradio.org', 22), 30, 'Puno'],
  ['diario-voces', 'Diario Voces', wordpress('diariovoces.com.pe'), 30, 'San Martín'],
  ['radio-uno', 'Radio Uno', wordpress('radiouno.pe', 15), 30, 'Tacna'],
  ['newstrujillo', 'NewsTrujillo', wordpress('newstrujillo.com'), 30, 'La Libertad'],
  ['senamhi-youtube', 'SENAMHI Perú · YouTube', 'https://www.youtube.com/feeds/videos.xml?channel_id=UCSy_etV_nlGLFlq7KTx1e9Q', 30],
];

const names = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ',
  hellip: '…', ndash: '–', mdash: '—', ldquo: '“', rdquo: '”', rsquo: '’', lsquo: '‘' };
function decode(value = '') {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (original, token) => {
    if (token[0] !== '#') return names[token] ?? original;
    const point = token[1].toLowerCase() === 'x' ? parseInt(token.slice(2), 16) : Number(token.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : '';
  });
}
function textOnly(value = '') {
  return decode(decode(value)).replace(/<\/?[a-z][^>]*>/gi, ' ').replace(/\s+/g, ' ').trim();
}
function plain(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Read the direct fields of RSS items / Atom entries. Descriptions, full articles,
// encoded HTML and nested media markup are deliberately ignored.
export function parseFeed(xml) {
  if (!/<(?:rss|feed)(?=[\s>])/i.test(xml)) throw new Error('El canal no entregó RSS ni Atom.');
  const entries = [];
  const stack = [];
  let entry, depth;
  const tokens = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[^>]*\?>|<![^>]+>|<(\/)?([\w:.-]+)\b((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/g;
  for (const match of xml.matchAll(tokens)) {
    const [, cdata, closing, tagName, attrs, words] = match;
    if (tagName) {
      if (closing) {
        if (stack.pop() !== tagName) throw new Error('El canal entregó XML incompleto.');
        if (entry && stack.length < depth) { entries.push(entry); entry = null; }
        continue;
      }
      if (!entry && (tagName === 'item' || tagName === 'entry')) {
        entry = { category: '' }; depth = stack.length + 1;
      } else if (entry && stack.length === depth) {
        if (tagName === 'category') entry.category += ' ';
        if (tagName === 'link') {
          const href = attrs.match(/\bhref\s*=\s*(["'])(.*?)\1/i)?.[2];
          const rel = attrs.match(/\brel\s*=\s*(["'])(.*?)\1/i)?.[2];
          if (href && (!rel || rel === 'alternate')) entry.link = decode(href);
        }
      }
      if (!/\/\s*$/.test(attrs)) stack.push(tagName);
    } else if (entry && stack.length === depth + 1 && (words || cdata)) {
      const field = stack[stack.length - 1];
      if (['title', 'link', 'pubDate', 'published', 'updated', 'category', 'yt:videoId'].includes(field)) {
        entry[field] = (entry[field] ?? '') + (cdata ?? words);
      }
    }
  }
  if (stack.length) throw new Error('El canal entregó XML incompleto.');
  return entries;
}

const areas = [
  ['Amazonas', 'chachapoyas|bagua'], ['Áncash', 'huaraz|chimbote'], ['Apurímac', 'abancay|andahuaylas'],
  ['Arequipa', 'camana'], ['Ayacucho', 'huamanga'], ['Cajamarca', 'jaen'], ['Callao', 'ventanilla'],
  ['Cusco', 'urubamba'], ['Huancavelica', 'pampas de tayacaja'], ['Huánuco', 'tingo maria'],
  ['Ica', 'chincha|pisco|nazca|nasca'], ['Junín', 'huancayo|chanchamayo'],
  ['La Libertad', 'trujillo|huanchaco'], ['Lambayeque', 'chiclayo|ferrenafe'],
  ['Lima', 'chosica|chaclacayo|lurigancho|rimac|lurin|chillon'], ['Loreto', 'iquitos|nauta|yurimaguas'],
  ['Madre de Dios', 'puerto maldonado'], ['Moquegua', 'ilo'], ['Pasco', 'oxapampa'],
  ['Piura', 'sullana|talara|paita|sechura|catacaos|tambogrande|bajo piura|colan'],
  ['Puno', 'juliaca|azangaro|ilave'], ['San Martín', 'tarapoto|moyobamba|soritor'], ['Tacna', 'tarata'],
  ['Tumbes', 'zarumilla'], ['Ucayali', 'pucallpa'],
].map(([name, aliases]) => [name, new RegExp('\\b(?:' + plain(name) + '|' + aliases + ')\\b')]);
const childEvent = /\b(?:fenomeno (?:de )?(?:el |del )?nino|el nino costero|enfen|(?:efectos?|impactos?|riesgos?|consecuencias?) (?:del |de el )nino|(?:ante|frente a|ante la llegada de) el nino|enso)\b/;
const seaChange = /\b(?:oleajes?|mar de fondo|anomalia(?:s)? (?:termica(?:s)?|del mar)|calentamiento (?:del mar|marino|del pacifico)|temperatura superficial del mar|nivel del mar|mar (?:esta|se encuentra) mas alto)\b/;
const rivers = /\b(?:crecidas?|desbord(?:es?|o|a(?:n|ron)?)|caudal(?:es)?|estiaje|nivel(?:es)? (?:del|de los) rios?)\b/;
const rains = /\b(?:lluvias?|lloviznas?|precipitaci(?:on|ones)|tormentas? electricas?|huaicos?|huaycos?|anegamientos?|inundaci(?:on|ones)|inundad[oa]s?|inund(?:a|an|o|aron)|activacion de quebradas?)\b/;
const extremes = /\b(?:sequias?|deficit hidrico|olas? de calor|avisos? (?:meteorologicos?|hidrologicos?)|pronostico del tiempo)\b/;
const foreign = /\b(?:argentina|bolivia|brasil|caribe|chile|china|colombia|ecuador|espana|estados unidos|mexico|centroamerica|filipinas|indonesia|australia|venezuela|miami|california|florida|india|pakistan|francia|italia|banglades[h]?|vietnam|japon|guatemala|honduras|el salvador|paraguay|uruguay|turquia)\b/;
const metaphor = /\blluvia(?:s)? de (?:goles|estrellas|criticas|elogios|aplausos|ofertas|premios|memes|comentarios|meteoritos|balas|balazos|denuncias)\b/;
const months = 'enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre'.split(' ');
function forecastDate(title, date) {
  const match = title.match(/pronostico del tiempo\s+(?:del?\s+)?(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?/);
  if (!match) return null;
  const month = months.indexOf(match[2].replace(/^setiembre$/, 'septiembre'));
  const day = Number(match[1]);
  if (month < 0 || day < 1 || day > 31) return null;
  const published = new Date(date);
  const years = match[3] ? [Number(match[3])] : [-1, 0, 1].map(delta => published.getUTCFullYear() + delta);
  const candidates = years.map(year => new Date(Date.UTC(year, month, day, 12))).filter(d => d.getUTCMonth() === month);
  candidates.sort((a, b) => Math.abs(a - published) - Math.abs(b - published));
  if (!candidates.length || (!match[3] && Math.abs(candidates[0] - published) > 31 * 86400000)) return null;
  return candidates[0].toISOString().slice(0, 10);
}
function iso(value) {
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : null;
}

function normalize(raw, source, now) {
  const title = textOnly(raw.title);
  const searchable = plain(title);
  const placeNames = searchable.replace(/\b(?:rio amazonas|san martin de porres|(?:jiron|avenida|calle|plaza) san martin)\b/g, ' ');
  const regions = areas.filter(([, pattern]) => pattern.test(placeNames)).map(([name]) => name);
  const categories = plain(textOnly(raw.category));
  if (!title || metaphor.test(searchable)) return null;
  if (foreign.test(searchable) && !/\b(?:peru|peruan[ao]s?|indeci|enfen|cenepred|coen)\b/.test(searchable)) return null;
  if (!coversPeru(categories,searchable)) return null;
  const category = childEvent.test(searchable) ? 'Fenómeno El Niño' : seaChange.test(searchable) ? 'Mar'
    : rivers.test(searchable) ? 'Ríos' : rains.test(searchable) ? 'Lluvias' : extremes.test(searchable) ? 'Clima' : null;
  if (!category) return null;
  let url;
  try { url = new URL(textOnly(raw.link)); } catch { return null; }
  const host = new URL(source.url).hostname.replace(/^www\./, '');
  if (url.protocol !== 'https:' || url.hostname.replace(/^www\./, '') !== host ||
      url.port || url.username || url.password || (url.pathname === '/' && !url.search) ||
      [...url.searchParams.keys()].some(key => /^(?:access_token|api_key|apikey|client_secret|password|authorization|signature|x-amz-signature)$/i.test(key))) return null;
  const publishedAt = iso(raw.pubDate || raw.published || '');
  if (!publishedAt || Date.parse(publishedAt) > now) return null;
  url.hash = '';
  const id = source.id + ':' + (raw.id || raw['yt:videoId'] || url.href);
  const result = { id, title, url: url.href, source: source.name, sourceName: source.name,
    sourceId: source.id, publishedAt, category, kind: source.kind };
  const updatedAt = iso(raw.updated || '');
  if (updatedAt && updatedAt > publishedAt && Date.parse(updatedAt) <= now) result.updatedAt = updatedAt;
  if (source.publisherRegion) result.publisherRegion = source.publisherRegion;
  if (regions.length) {
    result.region = regions[0];
    result.regions = regions;
    if (source.kind === 'prensa') result.regionOrigin = 'titular-prensa';
  }
  if (source.kind === 'video') {
    const day = forecastDate(searchable, publishedAt);
    if (day) result.forecastDate = day;
  }
  return result;
}

async function readMediaEntries(source) {
  const response = await fetch(source.url, {
    headers: { 'User-Agent': 'Peru-al-Dia/0.1 (lector de titulares publicos)', Accept: 'application/rss+xml, application/atom+xml, application/json, text/xml, */*;q=0.5' },
    signal: AbortSignal.timeout(14000),
  });
  if (!response.ok) throw new Error('La fuente respondió HTTP ' + response.status + '.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, body = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 3 * 1024 * 1024) { await reader.cancel(); throw new Error('El canal excedió el tamaño previsto.'); }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  if (new URL(source.url).pathname === '/wp-json/wp/v2/posts') {
    const posts = JSON.parse(body);
    if (!Array.isArray(posts) || posts.some(post => !Number.isSafeInteger(post?.id) || typeof post.title?.rendered !== 'string'))
      throw new Error(source.name + ' no devolvió un listado de titulares.');
    return posts.map(({id, title, link, date_gmt, modified_gmt}) => ({
      id, title: title?.rendered, link, published: date_gmt ? date_gmt + 'Z' : '', updated: modified_gmt ? modified_gmt + 'Z' : '',
    }));
  }
  return parseFeed(body);
}

async function fetchMedia(source, context) {
  const entries = nationalIds.has(source.id)
    ? await readNationalEntries(source, context, parseFeed)
    : await readMediaEntries(source);
  const now = +(context.now ?? new Date());
  return entries.map(entry => normalize(entry, source, now)).filter(Boolean);
}

export const mediaSources = definitions.map(([id, name, url, intervalMinutes, publisherRegion]) => {
  const source = { id, name, url, intervalMinutes, kind: id === 'senamhi-youtube' ? 'video' : 'prensa',
    ...(publisherRegion && {publisherRegion}) };
  return { ...source, fetchItems: (context = {}) => fetchMedia(source, context) };
});
