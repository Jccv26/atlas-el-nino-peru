import {validatedOriginal} from '../public/enlaces-aviso.mjs';

const comercio='https://elcomercio.pe/arc/outboundfeeds/rss/';
const channels = {
  rpp: [
    {url:'https://rpp.pe/rss',type:'rss'},
    {url:'https://rpp.pe/sitemap/news',type:'sitemap'},
  ],
  'el-comercio': [
    {url:comercio+'?outputType=xml',type:'rss'},
    {url:comercio+'category/peru/?outputType=xml',type:'rss'},
    {url:comercio+'category/lima/?outputType=xml',type:'rss'},
  ],
};
export const nationalFeeds=[
  ['rpp','RPP',channels.rpp[0].url,10],
  ['el-comercio','El Comercio',channels['el-comercio'][0].url,10],
];
const maxAge=3*86400000;
const domestic = /\b(?:peru|peruana?s?|peruanos?|senamhi|indeci|enfen|sutran|cenepred|coen|sierra (?:norte|central|sur)|costa (?:norte|central|sur))\b/;
export function coversPeru(section,headline) {
  return !/\b(?:internacional(?:es)?|mundo)\b/.test(section) || domestic.test(headline);
}
// Reapply the section rule to older RSS records, which did not retain the
// publisher's section, even when serving a cached or inaccessible feed.
export function nationalArchiveEligible(item) {
  if (!Object.hasOwn(channels,item?.sourceId)) return true;
  const address=validatedOriginal(item.url);
  if (!address) return false;
  const url=new URL(address), host=new URL(channels[item.sourceId][0].url).hostname;
  if (url.hostname.replace(/^www\./,'')!==host) return false;
  const headline=String(item.title || '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase();
  return coversPeru(url.pathname.split('/')[1],headline);
}
function xmlText(xml,tag) {
  const body=xml.match(new RegExp('<'+tag+'(?:\\s[^>]*)?>([\\s\\S]*?)</'+tag+'>','i'))?.[1];
  return body?.replace(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/,'$1').trim() || '';
}
function rppSitemap(xml) {
  if (!/<urlset\b[^>]*xmlns:news=/i.test(xml) || !/<\/urlset>\s*$/i.test(xml))
    throw Error('Sitemap periodístico de RPP incompleto');
  const result=[];
  for (const [,entry] of xml.matchAll(/<url(?:\s[^>]*)?>([\s\S]*?)<\/url>/gi)) {
    const news=xmlText(entry,'news:news');
    const publisher=xmlText(news,'news:publication');
    if (!/^RPP(?: Noticias)?$/i.test(xmlText(publisher,'news:name')) || !/^es$/i.test(xmlText(publisher,'news:language'))) continue;
    result.push({link:xmlText(entry,'loc'),title:xmlText(news,'news:title'),published:xmlText(news,'news:publication_date'),
      updated:xmlText(entry,'lastmod')});
  }
  return result;
}
async function read(channel,fetchImpl,parseRss) {
  const res=await fetchImpl(channel.url,{
    headers:{accept:'application/rss+xml, application/xml, text/xml', 'user-agent':'Peru-al-Dia/0.1 (lector de titulares publicos)'},
    signal:AbortSignal.timeout(9500),redirect:'error',
  });
  const max=3*1024*1024;
  if (!res.ok || !/\bxml\b/i.test(res.headers.get('content-type') || '') || Number(res.headers.get('content-length'))>max) {
    await res.body?.cancel();throw Error('Índice editorial no disponible');
  }
  const decoder=new TextDecoder();
  let bytes=0, xml='';
  for await (const chunk of res.body) {
    bytes+=chunk.length;
    if (bytes>max) throw Error('Índice editorial demasiado grande');
    xml+=decoder.decode(chunk,{stream:true});
  }
  xml+=decoder.decode();
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('Índice editorial inesperado');
  return channel.type==='sitemap' ? rppSitemap(xml) : parseRss(xml);
}

function timestamp(value) {
  if (typeof value!=='string' || !/(?:Z|GMT|UTC|[+-]\d{2}:?\d{2})$/i.test(value.trim())) return NaN;
  return Date.parse(value);
}

// A rolling RSS front page can drop an important note within an hour. Discover
// additional headlines in the publishers' own public regional indexes. The
// caller applies the same Peru, hazard, privacy and retention rules as regional press.
export async function readNationalEntries(source,{now=new Date(),fetchImpl=fetch,onReading}={},parseRss) {
  if (!Object.hasOwn(channels,source.id) || typeof parseRss!=='function') throw Error('Medio nacional sin configurar');
  const list=channels[source.id];
  const results=await Promise.allSettled(list.map(c=>read(c,fetchImpl,parseRss)));
  const available=results.filter(r=>r.status==='fulfilled');
  if (!available.length) throw Error('Ningún índice público disponible para '+source.name);
  onReading?.({nationalPressCoverage:{channelsRead:available.length,totalChannels:list.length}});
  const entries=new Map(), current=+now;
  const expectedHost=new URL(list[0].url).hostname;
  for (const result of available) for (const row of result.value) {
    const link=validatedOriginal(row.link?.trim()), published=timestamp(row.pubDate || row.published);
    if (!link || new URL(link).hostname.replace(/^www\./,'')!==expectedHost || !row.title?.trim() ||
        !Number.isFinite(published) || published>current || published<current-maxAge) continue;
    const updated=timestamp(row.updated);
    const modified=updated>published && updated<=current ? new Date(updated).toISOString() : null;
    if (entries.has(link)) {
      const old=entries.get(link);
      if (modified && (!old.updated || modified>old.updated) && Date.parse(modified)>Date.parse(old.published)) old.updated=modified;
      continue;
    }
    const path=new URL(link).pathname;
    const section=path.split('/')[1];
    const category=[row.category || '',section].join(' ').trim();
    entries.set(link,{title:row.title,link,published:new Date(published).toISOString(),category,...(modified && {updated:modified})});
  }
  return [...entries.values()];
}
