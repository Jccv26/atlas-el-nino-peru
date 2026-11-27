import test from 'node:test';
import assert from 'node:assert/strict';
import {refreshPanorama} from '../lib/panorama.mjs';
import {officialSources} from '../lib/oficiales.mjs';
import {mediaSources} from '../lib/medios.mjs';
import {rainTable} from '../lib/cuadro-lluvias-coen.mjs';

test('el publicador conserva los días ya leídos si la misma edición solo devuelve un mapa',async t=>{
  const now=new Date('2026-11-27T00:25:00Z');
  const meteo=officialSources.find(s=>s.id==='senamhi-meteo');
  const original=meteo.fetchItems;
  t.after(()=>{meteo.fetchItems=original;});
  const first={date:'2026-11-26',regions:['Ica'],url:'https://www.senamhi.gob.pe/mapa/1'};
  const second={date:'2026-11-27',regions:['Piura'],url:'https://www.senamhi.gob.pe/mapa/2'};
  const sourceRecord={id:'senamhi-meteo:2026-99',sourceId:meteo.id,noticeNumber:'99',
    title:'Precipitaciones en la costa',url:'https://www.senamhi.gob.pe/',category:'Lluvias',
    validFrom:first.date,validUntil:second.date,level:'AMARILLO',datePrecision:'day'};
  const fresh={...sourceRecord,regions:['Tumbes'],regionOrigin:'mapa-senamhi-parcial',
    coverageDaysComplete:false,coverageDays:[{...second,regions:['Tumbes']}]};
  const old={...sourceRecord,kind:'oficial',regions:['Ica','Piura'],regionOrigin:'mapa-senamhi',
    coverageDaysComplete:true,coverageDays:[first,second],lastChangedAt:'2026-11-26T21:00:00Z'};
  meteo.fetchItems=async()=>[structuredClone(fresh)];
  const previous={schemaVersion:2,sources:[...officialSources,...mediaSources].map(s=>({id:s.id,status:'ok',coenReaderVersion:4,
    checkedAt:s.id===meteo.id?'2026-11-26T11:59:00Z':'2026-11-27T00:24:00Z'})),items:[old]};
  const result=await refreshPanorama(previous,{now});
  const record=result.items.find(r=>r.id===old.id);
  assert.equal(record.coverageDaysComplete,true);
  assert.deepEqual(record.coverageDays,[first,{...second,regions:['Tumbes']}]);
  assert.deepEqual(record.coverageUrls,[first.url,second.url]);
  meteo.fetchItems=async()=>[{...structuredClone(fresh),noticeNumber:'100',id:'senamhi-meteo:2026-100'}];
  const newer=await refreshPanorama(previous,{now});
  assert.equal(newer.items.find(r=>r.noticeNumber==='100').coverageDaysComplete,false);
});

test('el cuadro nacional sustenta la lluvia sin convertir viento ni Lima departamental en aviso local',()=>{
  const page=[
    'AVISOS METEOROLÓGICOS EMITIDOS Y VIGENTES',
    '                                                       AVISO',
    '          DEPARTAMENTO                                                       N°                INICIO        FIN             NIVEL',
    '                                                  METEOROLÓGICO',
    '   ICA Y LIMA.                               LLUVIAS EN LA COSTA             12              26/11/2026   27/11/2026       AMARILLO',
    '                                                                         (Vigente)',
    '',
    '   TACNA.                                    VIENTO EN LA COSTA              13              26/11/2026   27/11/2026       AMARILLO',
    '                                                                         (Vigente)',
    'Fuente: SENAMHI',
  ].join('\n');
  const departments=new Map([['ica','Ica'],['lima','Lima'],['tacna','Tacna']]);
  const date=s=>s.split('/').reverse().join('-');
  const [row,...others]=rainTable(page,7,{pdfUrl:'https://portal.indeci.gob.pe/parte.pdf'},'2026-11-26T20:00:00Z',departments,date);
  assert.equal(others.length,0);
  assert.equal(row.originNotice.number,'12');
  assert.deepEqual(row.regions,['Ica']);
  assert.match(row.summary,/Ica, Lima/);
  assert.equal(row.validUntil,'2026-11-27');
  assert.match(row.url,/#page=7$/);
});
