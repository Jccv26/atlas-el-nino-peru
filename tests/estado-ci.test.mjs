import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {mergePanorama,mirrorPublic,publicationFor,regionalBudgetCents,bulletinGrantsPerSlot} from '../scripts/estado-ci.mjs';
import {refreshRadar,materialize,radarIndex} from '../lib/radar-ahora.mjs';

import {parseTemperatureSeries} from '../lib/temperatura.mjs';

function weeklyFixture() {
  const first=Date.UTC(1981,8,2),last=Date.UTC(1982,0,6);
  const rows=['Weekly SST data starts week centered on 2Sept1981','Nino1+2 Nino3 Nino34 Nino4','Week SST SSTA SST SSTA SST SSTA SST SSTA'];
  for(let t=first;t<=last;t+=7*86400000){
    const d=new Date(t), m='JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ')[d.getUTCMonth()];
    rows.push(String(d.getUTCDate()).padStart(2,'0')+m+d.getUTCFullYear()+'     24.0 1.0     25.0 1.0     26.0 1.0     27.0 1.0');
  }
  return parseTemperatureSeries(rows.join('\n'),last+86400000);
}
const temperature=weeklyFixture();
const iso=t=>new Date(t).toISOString();
const at=Date.parse('2026-11-27T01:20:00Z'), later=iso(at+60000), now=at+120000;
const sourceId='senamhi-lluvias';
const archive='https://www.senamhi.gob.pe/load/file/02249SENA-3534.zip';
const rain={id:sourceId+':2026-330',sourceId,noticeNumber:'330',title:'Lluvias',level:'ROJO',
  validFrom:'2026-11-26T18:00:00.000Z',validUntil:'2026-11-27T18:00:00.000Z',regions:['Piura'],
  regionOrigin:'mapa-senamhi',coverageUrls:['https://www.senamhi.gob.pe/mapas/mapa-24H/index.php'],
  districtLevels:{'200111':['NARANJA','ROJO']},shapeArchiveUrl:archive};
const seedReport={id:123,radar:'PIURA',radarName:'Piura',issuedAt:'2026-11-27T01:00:00.000Z',
  validFrom:'2026-11-27T01:00:00.000Z', validUntil:'2026-11-27T03:00:00.000Z',url:radarIndex.split('?')[0]+'/123/file',
  observationText:'Durante la última hora, se registraron precipitaciones en la provincia de Sullana (estación El Chira: 26.2 mm).',forecastText:''};
const stored={updatedAt:iso(at), radar:materialize([seedReport],new Date(at),{checkedAt:iso(at),lastSuccessAt:iso(at),status:'ok',desks:{}})};
const polygon={sourceId,date:'2026-11-26',noticeNumber:rain.noticeNumber,validFrom:rain.validFrom,validUntil:rain.validUntil,sourceUrl:archive,
  checkedAt:iso(at),features:[{d:'M25,12L26,12L26,11Z',level:'ROJO'}]};
const minimal=(when,records=[],sources=[])=>({schemaVersion:2,updatedAt:when,items:records,sources});
const source=(when,count)=>({id:sourceId,name:'Lluvias',status:'ok',checkedAt:when,lastSuccessAt:when,count});

function dataPair(){
  const seed=minimal(stored.updatedAt,[rain],[source(stored.updatedAt,1)]);
  const newer={...rain,regionOrigin:'texto-senamhi',regions:['Piura']};
  for(const key of ['districtLevels','districtUnmatchedCounts','shapeArchiveUrl','regionLevels','coverageUrls','sectorMap','districtCounts','provincesByRegion'])delete newer[key];
  const published=minimal(later,[newer],[source(later,1)]);
  seed.radar=stored.radar;
  published.radar={...structuredClone(stored.radar),status:'partial',checkedAt:later,reports:[],observations:[],forecasts:[]};
  const e={id:'test-case',checkedAt:stored.updatedAt,reportedAt:stored.updatedAt,revision:'A',title:'Parte',pdfVerified:true,evidence:[{label:'Reporte oficial en PDF',url:'https://portal.indeci.gob.pe/a.pdf'}]};
  seed.impacts={schemaVersion:1,checkedAt:stored.updatedAt,events:[e]};
  published.impacts={schemaVersion:1,checkedAt:later,events:[{...e,checkedAt:later,pdfVerified:false,evidence:[]}]};
  return {seed,published,newer};
}

test('una edición posterior con índices parciales conserva los detalles verificables durante una caída',async()=>{
  const {seed,published}=dataPair();const merged=mergePanorama(seed,published,now);
  const item=merged.items.find(i=>i.id===rain.id);
  assert.deepEqual(item.districtLevels,rain.districtLevels);assert.equal(item.shapeArchiveUrl,rain.shapeArchiveUrl);
  assert.equal(merged.sources.find(s=>s.id===sourceId).checkedAt,later);
  assert.ok(merged.impacts.events[0].pdfVerified);assert.equal(merged.impacts.events[0].checkedAt,stored.updatedAt);
  assert.equal(merged.radar.status,'partial');assert.ok(merged.radar.reports.some(r=>r.id===seedReport.id));
  const radar=await refreshRadar(merged.radar,{now:new Date(now+6*60000),force:true,fetchImpl:async()=>{throw Error('fuente sin conexión');}});
  assert.equal(radar.status,'stale');assert.equal(radar.lastSuccessAt,stored.radar.lastSuccessAt);assert.ok(radar.reports.some(r=>r.id===seedReport.id));
  assert.equal(merged.sources.find(s=>s.id==='senamhi-radar').count,merged.items.filter(r=>r.sourceId==='senamhi-radar').length);
});

test('una corrección o el retiro oficial del aviso invalidan el detalle antiguo',()=>{
  const {seed,published}=dataPair();published.items[0]={...published.items[0],shapeArchiveUrl:'https://www.senamhi.gob.pe/load/file/02249SENA-9.zip'};
  assert.equal(mergePanorama(seed,published,now).items.find(r=>r.id===rain.id).districtLevels,undefined);
  published.items=[];published.sources[0].count=0;
  assert.ok(!mergePanorama(seed,published,now).items.some(r=>r.id===rain.id));
  published.impacts.events[0].revision='B';
  assert.equal(mergePanorama(seed,published,now).impacts.events[0].pdfVerified,false);
  const desk=published.radar.coverage.find(r=>r.code===seedReport.radar);
  desk.latestIssuedAt=seedReport.issuedAt;desk.latestReportId=seedReport.id+100;
  assert.ok(!mergePanorama(seed,published,now).radar.reports.some(r=>r.id===seedReport.id));
});

test('la restauración coteja el intervalo de un polígono y conserva el histórico semanal',async()=>{
  const {seed,published}=dataPair();const tmp=await mkdtemp(join(tmpdir(),'perualdia-restaurar-'));
  try{
    const local=join(tmp,'local'),branch=join(tmp,'ediciones');
    for(const dir of [local,branch]) await mkdir(join(dir,'public/data'),{recursive:true});
    const write=(dir,file,doc)=>writeFile(join(dir,'public/data',file),JSON.stringify(doc));
    const read=async file=>JSON.parse(await readFile(join(local,'public/data',file),'utf8'));
    const shape=polygon;
    await write(local,'panorama.json',seed);await write(branch,'panorama.json',published);
    await write(local,'sectores-lluvias.json',shape);
    await write(branch,'sectores-lluvias.json',{...shape,noticeNumber:'9999',checkedAt:later});
    await write(local,'temperatura.json',temperature);
    const legacy={...temperature,checkedAt:later};delete legacy.comparison;await write(branch,'temperatura.json',legacy);
    await mirrorPublic(local,branch,now,true,seed);
    assert.equal((await read('sectores-lluvias.json')).noticeNumber,rain.noticeNumber);
    assert.deepEqual((await read('temperatura.json')).comparison,temperature.comparison);
  }finally{await rm(tmp,{recursive:true,force:true});}
});

test('solo dos corridas automáticas distintas cercanas dejan constancia de continuidad',()=>{
  const event=(id,mode='schedule',attempt='1')=>({GITHUB_ACTIONS:'true',GITHUB_EVENT_NAME:mode,GITHUB_RUN_ATTEMPT:attempt,GITHUB_RUN_ID:String(id)});
  const one=publicationFor(null,iso(at),event(1));assert.ok(!one.priorScheduled);
  const two=publicationFor(one,iso(at+10*60000),event(2));assert.equal(two.priorScheduled.runId,'1');
  const after=publicationFor(two,iso(at+70*60000),event(3));assert.ok(!after.priorScheduled);
  const manual=publicationFor(after,iso(at+80*60000),event(4,'workflow_dispatch'));assert.equal(manual.lastScheduled.runId,'3');assert.ok(!manual.priorScheduled);
  const retried=publicationFor(after,iso(at+90*60000),event(3,'schedule','2'));assert.equal(retried.event,'rerun');assert.ok(!retried.priorScheduled);
  assert.equal(regionalBudgetCents(60),600);assert.equal(regionalBudgetCents('bad'),0);
  for(const [budget,grants] of [[0,0],[6,0],[22.31,0],[22.32,1],[35,1],[44.63,1],[44.64,2],[60,2],[80,2]]) {
    assert.equal(bulletinGrantsPerSlot(budget),grants);
    assert.ok(grants*2232+regionalBudgetCents(budget)<=Math.min(6000,Math.round(budget*100)));
  }
});
