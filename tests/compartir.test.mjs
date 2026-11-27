import test from 'node:test';
import assert from 'node:assert/strict';
import {shareUrl, sharePayload, shareOrCopy, shareControl} from '../public/compartir.mjs';

const context={region:'Áncash', ubigeo:'020101', capa:'lluvias', vista:'pronostico', peligro:'quebradas'};
const opts={...context, aviso:'i-51f6d0', place:'Huaraz · Áncash', title:'Activación de quebradas',
  situation:'Hay sectores en nivel naranja.',source:'SENAMHI',at:'2026-11-27T02:00:00Z'};

test('el enlace público reproduce territorio y vista, incluso desde archivo o vista previa',()=>{
  const url=new URL(shareUrl({...context,ciudad:'Huaraz',q:'dato privado',origin:'file:///Users/e/Desktop',aviso:'i-51f6d0'}));
  assert.equal(url.origin,'https://jccv26.github.io');
  assert.equal(url.pathname,'/atlas-el-nino-peru/');
  assert.deepEqual(Object.fromEntries(url.searchParams),{...context,aviso:'i-51f6d0'});
  assert.equal(new URL(shareUrl({region:'Piura'})).searchParams.get('capa'),'lluvias');
  assert.deepEqual(Object.fromEntries(new URL(shareUrl({aviso:'e_8098'})).searchParams),{aviso:'e_8098'});
  assert.equal(shareUrl({ubigeo:'2',aviso:'https://example.org/?secret=hello',region:'<x>'}), 'https://jccv26.github.io/atlas-el-nino-peru/');
});
test('una zona sin UBIGEO puede compartirse por ciudad y el filtro de quebradas solo pertenece al pronóstico de lluvia',()=>{
  const url=new URL(shareUrl({region:'Piura',ciudad:'Piura',capa:'rios',vista:'ahora',peligro:'quebradas'}));
  assert.equal(url.searchParams.get('ciudad'),'Piura');
  assert.equal(url.searchParams.has('peligro'),false);
});
test('el resumen lleva la situación y la fuente con la hora peruana, y una fecha sin hora conserva su día',()=>{
  const msg=sharePayload(opts);
  assert.equal(msg.title,opts.title);
  assert.match(msg.text,/Huaraz/);assert.match(msg.text,/nivel naranja/);assert.match(msg.text,/SENAMHI/);
  assert.match(msg.text,/26 de noviembre de 2026 a las 21:00/);
  assert.match(sharePayload({...opts,at:'2026-11-27'}).text,/27 de noviembre de 2026/);
  assert.doesNotMatch(sharePayload({...opts,at:'2026-02-30'}).text,/marzo|febrero/);
  assert.equal(sharePayload({}).title,'Perú al Día · Todo el Perú');
});
test('el envío nativo recibe el mismo titular, texto y enlace y cancelar no copia nada',async()=>{
  const data=sharePayload(opts);
  let shared;
  assert.equal(await shareOrCopy(data,{navigator:{share:payload=>{shared=payload;}}}),'shared');assert.deepEqual(shared,data);
  const cancelled=Object.assign(new Error('Cancelado'),{name:'AbortError'});
  const navigator={share:()=>Promise.reject(cancelled),clipboard:{writeText(){assert.fail('no debe copiar');}}};
  assert.equal(await shareOrCopy(data,{navigator,manual(){assert.fail('no debe abrir');}}),'cancelled');
});
test('navegadores sin soporte y errores de permisos copian el resumen y el enlace o muestran selección manual',async()=>{
  const payload=sharePayload(opts);
  let copied;
  const clipboard={writeText:async text=>{copied=text;}};
  const navigator={canShare:()=>false,share(){assert.fail('no debe abrir');},clipboard};
  assert.equal(await shareOrCopy(payload,{navigator}),'copied');assert.ok(copied.endsWith(payload.url));assert.ok(copied.includes('SENAMHI'));
  const denied={share:async()=>{throw Object.assign(new Error(),{name:'NotAllowedError'});},clipboard};
  assert.equal(await shareOrCopy(payload,{navigator:denied}),'copied');
  let selected;
  const blocked={clipboard:{writeText:async()=>{throw Error('sin permisos');}}};
  assert.equal(await shareOrCopy(payload,{navigator:blocked,manual:val=>{selected=val.url;}}),'manual');assert.equal(selected,payload.url);
});
class Element {
  constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.listeners={};}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=children;}
  setAttribute(k,v){this.attrs[k]=v;}
  removeAttribute(k){delete this.attrs[k];}
  addEventListener(k,cb){this.listeners[k]=cb;}
  focus(){this.focused=true;}
  select(){this.selected=true;}
}
test('la selección manual es accesible y cada pulsación consulta la ubicación actual',async()=>{
 const doc={createElement:tag=>new Element(tag)};
 let region='Áncash';
 const control=shareControl(()=>sharePayload({region}),{document:doc,navigator:{},label:'Compartir ubicación'});
 const [button,status,manual]=control.children;
 assert.equal(button.textContent,'Compartir ubicación');assert.equal(status.attrs.role,'status');
 await button.listeners.click();
 assert.equal(manual.children[0].tag,'label');let input=manual.children[0].children[0];
 assert.ok(input.readOnly && input.focused && input.selected);assert.equal(new URL(input.value).searchParams.get('region'),region);
 region='Piura';await button.listeners.click();
 input=manual.children[0].children[0];assert.equal(new URL(input.value).searchParams.get('region'),region);
 assert.match(status.textContent,/seleccionado/);assert.equal(button.attrs['aria-busy'],undefined);
});
test('si el sistema cierra el menú, copiar el enlace necesita una segunda acción explícita',async()=>{
 const doc={createElement:tag=>new Element(tag)};
 const copied=[];
 const browser={share:async()=>{throw Object.assign(new Error(),{name:'AbortError'});},clipboard:{writeText:async s=>copied.push(s)}};
 const payload=sharePayload(opts);
 const [button,status,,copy]=shareControl(()=>payload,{document:doc,navigator:browser}).children;
 await button.listeners.click();
 assert.deepEqual(copied,[]);assert.equal(copy.hidden,false);
 await copy.listeners.click();
 assert.deepEqual(copied,[payload.url]);assert.equal(status.textContent,'Enlace copiado.');
});
test('un destino que descarta el título todavía recibe el titular del aviso y la copia lo contiene una sola vez',async()=>{
 const msg=sharePayload(opts);
 assert.equal(msg.text.split('\n')[0],opts.title);
 let copied;
 await shareOrCopy(msg,{navigator:{clipboard:{writeText:text=>{copied=text;}}}});
 assert.equal(copied.split('\n').filter(line=>line===opts.title).length,1);
 assert.match(copied,/SENAMHI/);
});
