import {validatedOriginal} from './enlaces-aviso.mjs';

// These publishers provide a photo inside their own WordPress oEmbed card.
const publishers = new Map([['walac','walac.pe'],['diario-voces','diariovoces.com.pe'],['newstrujillo','newstrujillo.com']]);
export function visualArticle(record) {
  const article=validatedOriginal(record?.url);
  return article && new URL(article).hostname===publishers.get(record.sourceId) ? article : null;
}
export function publisherFrame(article) {
  const url=new URL(article);
  url.pathname=url.pathname.replace(/\/?$/,'/embed/');
  return url.href;
}
const localDay=new Intl.DateTimeFormat('es-PE',{dateStyle:'long',timeZone:'America/Lima'});
function dateLabel(date,kind) {
  const parsed=Date.parse(/^\d{4}-\d\d-\d\d$/.test(date)?date+'T12:00:00-05:00':date);
  if(!Number.isFinite(parsed))return '';
  const label=kind==='anexo'?'Fecha indicada en el anexo':kind==='captura'?'Fecha de toma':'Publicado';
  return label+' · '+localDay.format(parsed);
}

export function visualMaterials(record) {
  const entry=record?.item || record;
  const item=record?.event || entry;
  if(!item)return [];
  const result=[];
  const article=visualArticle(item);
  const proof=item.pressVisual || (entry?.url===article && entry.sourceId===item.sourceId && entry.pressVisual);
  const published=item.publishedAt || item.reportedAt;
  if(article && proof?.url===article && proof?.type==='oembed-photo') {
    result.push({label:'Imagen en la nota de '+(item.sourceName || item.source),
      detail:dateLabel(published),origin:article,frame:publisherFrame(article),type:'press'});
  }
  const annexes=item.sourceId==='coen' && !item.evidence && Array.isArray(item.localEvidence?.evidence)
    ? item.localEvidence.evidence.map(e=>({...e,type:'fotos',page:Number(/#page=(\d+)$/.exec(e.url)?.[1])})) : [];
  for(const e of item.evidence || annexes) {
    const url=validatedOriginal(e.url);
    if(!url || !['fotos','video'].includes(e.type))continue;
    if(item.sourceId==='coen' && e.type==='fotos' && Number.isInteger(e.page) &&
       new URL(url).hostname==='portal.indeci.gob.pe' && url.endsWith('.pdf#page='+e.page)) {
      result.push({label:'Anexo fotográfico de COEN · INDECI · pág. '+e.page,
        detail:[e.caption,dateLabel(e.date,e.dateKind)].filter(Boolean).join(' · '),origin:url,type:'link'});
    } else if(url===validatedOriginal(item.url)) {
      result.push({label:(e.type==='fotos'?'Fotografía':'Video')+' en '+(e.source || item.source || 'la publicación original'),
        detail:dateLabel(e.date,e.dateKind),origin:url,type:'link'});
    }
  }
  if(item.sourceId==='senamhi-youtube' && item.kind==='video') {
    const original=validatedOriginal(item.url);
    const video=original && new URL(original).searchParams.get('v');
    if(video && /^[\w-]{11}$/.test(video) && item.id==='senamhi-youtube:'+video)
      result.push({label:'Video publicado por SENAMHI en YouTube',detail:dateLabel(published),origin:original,
        frame:'https://www.youtube-nocookie.com/embed/'+video,type:'video'});
  }
  return result;
}

// Keep each publisher in control of its own media. Selecting a place alone
// does not contact any news, social or document server.
export function visualPanel(record,{document:doc=globalThis.document,addSource}={}) {
  const materials=visualMaterials(record);
  if(!materials.length)return null;
  const section=doc.createElement('section');
  section.className='visual-evidence';
  for(const m of materials) {
    if(addSource)addSource(m.label,m.origin,m.detail);
    if(m.frame) {
      const disclosure=doc.createElement('details');
      const title=doc.createElement('summary');
      title.textContent=m.label;
      disclosure.append(title);
      if(m.detail) {
        const caption=doc.createElement('small');caption.textContent=m.detail;disclosure.append(caption);
      }
      disclosure.addEventListener('toggle',()=>{
        if(!disclosure.open || disclosure.querySelector('iframe'))return;
        const frame=doc.createElement('iframe');
        frame.className='visual-frame visual-'+m.type;
        frame.title=m.label;
        frame.referrerPolicy=m.type==='video'?'strict-origin-when-cross-origin':'no-referrer';
        // The publisher's card renders its own photo as ordinary HTML.
        if(m.type==='press')frame.setAttribute('sandbox','');
        if(m.type==='video')frame.allowFullscreen=true;
        frame.src=m.frame;
        disclosure.append(frame);
      });
      section.append(disclosure);
    }
    if(!addSource) {
      const a=doc.createElement('a');
      a.textContent=m.label+' ↗';a.href=m.origin;a.target='_blank';a.rel='noopener noreferrer';
      section.append(a);
    }
  }
  return section.childElementCount ? section : null;
}
