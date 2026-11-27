import test from 'node:test';
import assert from 'node:assert/strict';
import {renderRegionalPress, selectPressGroups} from '../public/prensa-regional.mjs';

const now=Date.parse('2026-11-27T03:00:00Z');
const sources=[
  ['walac','Walac Noticias','walac.pe','Piura'],['radio-uno','Radio Uno','radiouno.pe','Tacna'],
  ['pachamama-radio','Pachamama Radio','pachamamaradio.org','Puno'],
  ['el-tiempo-piura','El Tiempo de Piura','eltiempo.pe'],['rpp','RPP','rpp.pe'],['andina','Andina','andina.pe'],['el-comercio','El Comercio','elcomercio.pe'],
].map(([id,name,host,publisherRegion])=>({id,name,kind:'prensa',url:'https://'+host+'/feed/',publisherRegion}));
function selected(panel, options) {
 const {regional,national}=selectPressGroups(panel,options);
 return [...regional,...national];
}
function article(sourceId,title,regions=[],age=0,num=1) {
  const url=new URL('notas/'+num,sources.find(s=>s.id===sourceId).url).href;
  return {id:sourceId+':'+num,url,sourceId,title,kind:'prensa',regions,publishedAt:new Date(now-age).toISOString()};
}
test('prioriza redacciones regionales y diversos lugares antes de repetir medio',()=>{
 const items=[
   article('rpp','Piura registra anegamientos',['Piura']),
   article('walac','Piura revisa el drenaje',['Piura'],360000,1),
   article('walac','Piura habilita otra ruta tras la lluvia',['Piura'],3600000,2),
   article('radio-uno','Tacna se prepara ante granizadas',['Tacna'],180000),
   article('pachamama-radio','Lluvias dañan caminos de Puno',['Puno'],600000),
 ];
 const rows=selected({sources,items},{now});
 assert.equal(rows.length,4);assert.deepEqual(rows.slice(0,3).map(r=>r.publisher).sort(),['Piura','Puno','Tacna']);
 assert.equal(rows[0].source,'Radio Uno');
});
test('la ubicación del medio no se presenta como ubicación del hecho y los filtros respetan el titular',()=>{
 const generic=article('el-tiempo-piura','Oleaje alcanza todo el litoral');
 const elsewhere=article('walac','Lluvias intensas en Tumbes',['Tumbes']);
 const ambiguous=article('andina','Lluvias intensas en Lima sur',['Lima']);
 const info={sources,items:[generic,elsewhere,ambiguous]};
 const local=selected(info,{region:'Piura',now});
 assert.deepEqual(local.map(s=>s.title),[generic.title]);assert.equal(local[0].scope,'Medio de Piura · Cobertura nacional');
 assert.deepEqual(selected(info,{region:'Tumbes',now}).map(s=>s.scope),['La nota menciona Tumbes']);
 assert.equal(selected(info,{region:'Lima Metropolitana',now}).length,0);
});
test('el esquema nuevo permite identificar un lugar citado en el titular y el anterior exige su nombre explícito',()=>{
 const articleByCity=article('rpp','Sullana refuerza su drenaje',['Piura']);
 const old=selected({sources,items:[articleByCity]},{now});
 assert.equal(old.length,0);
 const fresh=selected({sources,items:[{...articleByCity,regionOrigin:'titular-prensa'}]},{now});
 assert.deepEqual(fresh[0].places,['Piura']);
});
test('respeta 72 horas, descarta fechas futuras, publicidad, fuentes ajenas y esquemas de enlace inseguros',()=>{
 const genuine=article('walac','Piura limpia canales de drenaje',['Piura']);
 const bad=[
  {...genuine,url:'http://walac.pe/notas/1'},{...genuine,url:'https://walac.pe.ejemplo.pe/notas/1'},
  {...genuine,url:'https://walac.pe/feed/'},{...genuine,url:'https://walac.pe/notas/1?token=xyz'},
  {...genuine,publishedAt:'ayer'},{...genuine,publishedAt:new Date(now+1000).toISOString()},
  {...genuine,publishedAt:new Date(now-72*3600000-1).toISOString()},{...genuine,kind:'oficial'},
  {...genuine,sourceId:'desconocido'},{...genuine,title:'Publirreportaje de Piura'},
 ];
 assert.deepEqual(selected({sources,items:bad},{now}),[]);
 assert.equal(selected({sources,items:[{...genuine,publishedAt:new Date(now-72*3600000).toISOString()}]},{now}).length,1);
});
test('agrupa URL con seguimiento, titulares repetidos y corroboraciones explícitas de una misma emergencia',()=>{
 const a=article('walac','Piura: cierran temporalmente un puente por lluvias',['Piura']);
 const b=article('rpp','Cierran temporalmente un puente por lluvias [VIDEO]',['Piura']);
 const c=article('andina','Cierre vial por desborde en Piura',['Piura']);
 const panel={sources,items:[a,b,c,{...a,url:a.url+'?utm_source=red'}],impacts:{events:[
   {id:'caso',corroborated:true,url:a.url,evidence:[{type:'documento',url:c.url}]}
 ]}};
 assert.equal(selected(panel,{now}).length,1);
});
class Element {
  constructor(tag='div'){this.tag=tag;this.children=[];this.attrs={};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=nodes;}
  addEventListener(type,fn){this[type]=fn;}
  setAttribute(name,value){this.attrs[name]=value;}
}
test('la sección ofrece el enlace al original, fecha y ficha, conserva foco durante actualizaciones y explica un corte vacío',()=>{
 const ids=new Map(['regionalPressList','regionalPressState','regionalPressScope','nationalPressList','nationalPressState'].map(id=>[id,new Element()]));
 const doc={getElementById:id=>ids.get(id),createElement:tag=>new Element(tag)};
 const a=article('walac','Lluvias en Piura',['Piura']);const panel={items:[a],sources};let opened=null;
 const props={panel,now,document:doc,showRecord:r=>{opened=r;}};
 renderRegionalPress(props);
 const list=ids.get('regionalPressList'),[row]=list.children;
 assert.equal(row.children[1].href,a.url);assert.equal(row.children[0].children[1].dateTime,a.publishedAt);
 row.children[2].children[1].click();assert.equal(opened,a);
 renderRegionalPress(props);assert.equal(list.children[0],row);
 renderRegionalPress({...props,region:'Loreto'});assert.equal(list.children.length,0);assert.equal(ids.get('regionalPressState').hidden,false);
 assert.match(ids.get('regionalPressState').textContent,/72 horas/);
});

test('RPP y El Comercio tienen espacio propio en la vista nacional junto con las redacciones regionales',()=>{
 const items=[
   article('walac','Piura registra lluvias',['Piura']),
   article('radio-uno','Tacna refuerza su drenaje',['Tacna']),
   article('pachamama-radio','Lluvias en Puno',['Puno']),
   article('rpp','ENFEN explica la evolución del fenómeno El Niño',[],5*3600000),
   article('el-comercio','Fenómeno El Niño en Perú: perspectivas del próximo verano',[],14*3600000),
   article('andina','Oleaje en el litoral peruano',[],30000),
 ];
 const panel={sources,items};
 const groups=selectPressGroups(panel,{now});
 assert.equal(groups.regional.length,3);
 assert.deepEqual(groups.national.slice(0,2).map(r=>r.sourceId),['rpp','el-comercio']);
 assert.ok(groups.national.every(r=>!r.places.length && r.scope.includes('Sin región precisada')));
 assert.equal(selectPressGroups(panel,{region:'Piura',now}).national.length,0);
 const expired=items.map(i=>i.sourceId==='rpp' ? {...i,publishedAt:new Date(now-96*3600000).toISOString()} : i);
 assert.ok(!selectPressGroups({sources,items:expired},{now}).national.some(r=>r.sourceId==='rpp'));
});
test('la sección no muestra deportes, lluvia metafórica, sucesos internacionales o titulares sin evidencia temática y peruana',()=>{
 const items=[
   article('rpp','Piura recibe una lluvia de goles en la final',['Piura']),
   article('el-comercio','SENAMHI patrocina el torneo de fútbol de Tacna',['Tacna']),
   article('rpp','Florida espera lluvias de El Niño'),
   article('rpp','Tormentas, inundaciones y nieve azotan a EE. UU.'),
   {...article('andina','Lluvias asociadas a El Niño en Perú'),url:'https://andina.pe/mundo/temporal'},
   article('rpp','El fenómeno El Niño en el Pacífico'),
   article('walac','Piura estrena un teatro',['Piura']),
 ];
 const {regional,national}=selectPressGroups({sources,items},{now});
 assert.deepEqual([regional,national],[[],[]]);
});
