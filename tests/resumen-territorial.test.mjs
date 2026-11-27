import test from 'node:test';
import assert from 'node:assert/strict';
import {territorialBrief,signalDates} from '../public/resumen-territorial.mjs';
import {noticeForRegionDay} from '../public/avisos-mapa.mjs';

const index={byId:new Map([['1505',{name:'Cañete'}],['200108',{name:'El Tallan'}],['200111',{name:'Las Lomas'}]]),regionOf:()=> 'Lima'};
const links={event:'https://portal.indeci.gob.pe/emergencias/a/',pdf:'https://portal.indeci.gob.pe/a.pdf',forecast:'https://www.senamhi.gob.pe/?p=aviso'};
const jan2='2026-01-02T22:00:00-05:00',jan3='2026-01-03T00:00:00-05:00';

test('la vigencia provincial se calcula por día y no se extiende a días intermedios ni a distritos sin respaldo',()=>{
  const item={validFrom:'2026-01-02',validUntil:'2026-01-05',coverageDaysComplete:true,
    coverageDays:['02','03','04','05'].map((d,i)=>({date:'2026-01-'+d,regions:['Lima'],provincesByRegion:{Lima:i%2 ? ['Cañete'] : ['Huaral']}}))};
  const t=Date.parse(jan2);
  assert.equal(noticeForRegionDay(item,'Lima',t).applicableDates.length,4);
  const forProvince=noticeForRegionDay(item,'Lima',t,'1505',index);
  assert.deepEqual(forProvince.applicableDates,['2026-01-03','2026-01-05']);
  const label=signalDates({mode:'pronostico',item:forProvince});
  assert.match(label,/3 ene/);assert.match(label,/5 ene/);assert.doesNotMatch(label,/4 ene|00:00|23:59/);
  assert.equal(noticeForRegionDay(item,'Lima',t,'150501',index),null);
});

test('un resumen conserva el momento del hecho y del parte y reúne los originales al pie',()=>{
  const event={kind:'oficial',occurredAt:'2026-01-01T00:45:00-05:00',reportedAt:jan2,summary:'El huaico interrumpió la carretera.',recovery:{text:'El tránsito quedó restablecido.',url:links.pdf},evidence:[{url:links.pdf,label:'PDF'}, {url:'javascript:void(0)'}]};
  const signal={type:'impacto',mode:'ahora',mark:'restablecido',title:event.recovery.text,at:jan2,district:'Paimas',source:'COEN',url:links.event,event};
  const forecast={type:'aviso',mode:'pronostico',layer:'lluvias',title:'Aviso de lluvia.',at:jan2,from:jan2,expiresAt:jan3,source:'SENAMHI',url:links.forecast,item:{districtLevels:{'200108':['AMARILLO'],'200111':['ROJO'],'200205':['NARANJA']}}};
  const result=territorialBrief([signal,forecast],{region:'Piura',area:'2001',index});
  assert.match(result.highlights[0].text,/huaico.*restablecido/);
  assert.match(result.highlights[0].date,/Hecho · 1 ene.*00:45.*Parte · 2 ene.*22:00/);
  assert.match(result.highlights[1].text,/2 distritos.*El Tallan \(amarillo\).*Las Lomas \(rojo\)/);
  assert.match(result.highlights[1].date,/2 ene.*22:00 al 3 ene.*00:00/);
  assert.deepEqual(new Set(result.sources.map(s=>s.url)),new Set(Object.values(links)));
  assert.equal(result.highlights.filter(s=>s.label?.includes('Impacto')).length,0);
});

test('dos estaciones del mismo intervalo comparten una idea y un PDF; una estación no hereda la fecha de otro parte',()=>{
  const base={type:'observacion',mode:'ahora',source:'SENAMHI',url:links.forecast,from:jan2,at:jan3};
  const signals=['San Miguel','El Chira'].map((place,i)=>({...base,locality:place,title:(i+1)+' mm en '+place}));
  const r=territorialBrief([...signals,{...base,at:jan2,locality:'Estación anterior',title:'4 mm en Estación anterior'}],{region:'Piura'});
  assert.equal(r.highlights.length,1);assert.equal(r.sources.length,1);
  assert.match(r.highlights[0].text,/San Miguel.*El Chira/);
  assert.doesNotMatch(r.highlights[0].text,/Estación anterior/);
  assert.deepEqual(territorialBrief([],{region:'Lima Metropolitana',area:'1501'}),{sources:[],highlights:[]});
});
