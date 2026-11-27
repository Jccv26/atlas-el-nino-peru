import {visualArticle,publisherFrame} from '../public/material-visual.mjs';
import {selectPressGroups} from '../public/prensa-regional.mjs';

const hour=3600000;
function matchesPicture(article,raw) {
  try {
    const image=new URL(raw),origin=new URL(article);
    return image.origin===origin.origin && !image.username && !image.password && !image.search && !image.hash &&
      /^\/wp-content\/uploads\/20\d\d\/(?:0[1-9]|1[0-2])\/[^/]+\.(?:png|jpe?g|webp|avif)$/i.test(image.pathname);
  } catch {return false;}
}
export function hasPublisherPhoto(article,data) {
  if(!data || data.type!=='rich' || data.version!=='1.0' || !matchesPicture(article,data.thumbnail_url) ||
      typeof data.html!=='string')return false;
  const frames=[...data.html.matchAll(/<iframe\b[^>]*\ssrc=(["'])([^"']+)\1[^>]*>/gi)];
  if(frames.length!==1)return false;
  try{
    const frame=new URL(frames[0][2]),provider=new URL(data.provider_url);
    frame.hash='';
    return frame.href===publisherFrame(article) && provider.origin===new URL(article).origin;
  } catch {return false;}
}

async function readPhoto(article,fetchImpl) {
  const url=new URL('/wp-json/oembed/1.0/embed',article);
  url.searchParams.set('url',article);
  const res=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(5500),headers:{
    'User-Agent':'Mozilla/5.0 (compatible; Peru-al-Dia/1.0)','Accept':'application/json',
  }});
  if(!res.ok || !/application\/json/i.test(res.headers.get('content-type') || '')) {
    await res.body?.cancel();throw Error('Tarjeta editorial no disponible');
  }
  const chunks=[];let size=0;
  for await(const part of res.body) {
    size+=part.byteLength;
    if(size>60000)throw Error('Tarjeta editorial demasiado grande');
    chunks.push(part);
  }
  return hasPublisherPhoto(article,JSON.parse(Buffer.concat(chunks).toString('utf8')));
}

// A thumbnail alone does not authorize reproducing it. Keep just the check
// that the publisher offered its own photo-bearing iframe for this article.
export async function enrichPressVisuals(snapshot,previous={}, {now=new Date(),fetchImpl=fetch,limit=6}={}) {
  const stamp=new Date(now).toISOString(),time=Date.parse(stamp);
  const old=new Map((previous.items || []).filter(i=>i.visualCheck).map(i=>[i.id,i]));
  const front=selectPressGroups(snapshot,{now:time}).regional.map(r=>r.item.id);
  const queue=[];
  const byUrl=new Map();
  for(const item of snapshot.items || []) {
    const url=visualArticle(item),age=time-Date.parse(item.publishedAt);
    if(!url || item.kind!=='prensa' || item.withdrawnAt || item.supersededBy || !(age>=0 && age<=72*hour))continue;
    byUrl.set(url,item);
    const revision=item.updatedAt || item.publishedAt;
    const cached=[item,old.get(item.id)]
      .filter(p=>p?.visualCheck?.url===url && p.visualCheck.revision===revision && Date.parse(p.visualCheck.at)<=time)
      .sort((a,b)=>Date.parse(b.visualCheck.at)-Date.parse(a.visualCheck.at))[0];
    if(cached) {
      item.visualCheck=cached.visualCheck;
      if(cached.pressVisual?.url===url)item.pressVisual=cached.pressVisual;
      else delete item.pressVisual;
      if(time-Date.parse(cached.visualCheck.at)<(cached.visualCheck.failed?hour:12*hour))continue;
    } else {delete item.pressVisual;delete item.visualCheck;}
    queue.push({item,url,revision});
  }
  const rank=id=>front.includes(id)?front.indexOf(id):front.length;
  queue.sort((a,b)=>rank(a.item.id)-rank(b.item.id) || (Date.parse(a.item.visualCheck?.at)||0)-(Date.parse(b.item.visualCheck?.at)||0) ||
    Date.parse(b.item.publishedAt)-Date.parse(a.item.publishedAt));
  await Promise.all(queue.slice(0,limit).map(async({item,url,revision})=>{
    item.visualCheck={url,revision,at:stamp};
    try {
      if(await readPhoto(url,fetchImpl))item.pressVisual={type:'oembed-photo',url};
      else delete item.pressVisual;
    } catch {item.visualCheck.failed=true;}
  }));
  for(const ev of snapshot.impacts?.events || []) {
    const article=byUrl.get(ev.url);
    if(article?.sourceId===ev.sourceId && article?.pressVisual)ev.pressVisual=article.pressVisual;
    else if(article || (ev.kind==='prensa' && !ev.feedArchived))delete ev.pressVisual;
  }
  return snapshot;
}
