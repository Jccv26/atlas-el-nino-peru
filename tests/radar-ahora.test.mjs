import test from 'node:test';
import assert from 'node:assert/strict';
import {mergedRadar, parseRadarReport, radarIndex, refreshRadar} from '../lib/radar-ahora.mjs';
import {enrichEdition} from '../lib/edicion-local.mjs';

const base=radarIndex.split('?')[0];
const stamp='2026-11-26';
const earlier=new Date('2026-11-27T01:20:00Z');
function row(id,time='20:00',radar='PIURA') {
  return {id,location:radar,locationName:radar==='ICA'?'Ica':'Piura',type:'PDF',file:true,
    category:'NOWCASTING_RADAR',date:stamp,time,fileUrl:base+'/'+id+'/file'};
}
function page(text,start='20:00',end='22:00') {
  return 'PRONÓSTICO A MUY CORTO PLAZO\nVIGENCIA DE '+start+' A '+end+' HORAS DEL 26 DE NOVIEMBRE 2026\n'+
    'Precipitación estimada para la 2da hora    1.0 - 5.0      > 15.0\n\n'+text+'\n\f';
}
const rain='Durante la última hora, se registraron precipitaciones en el departamento de Piura, específicamente en la provincia de Piura (estación Piura: 3.8 mm) y en la provincia de Sullana (estación El Chira: 26.2 mm). Asimismo, en el departamento de Lambayeque, se registraron precipitaciones en la provincia de Lambayeque (estación Tongorape: 9.7 mm).';
const outlook='Para las próximas horas, se prevén precipitaciones en las provincias de Paita y Sechura. Asimismo, se esperan precipitaciones en zonas interiores del departamento de Tumbes.';
const negative='En las próximas horas, no se preven lluvias significativas en el departamento de Ica y parte oriental del departamento de Huancavelica y Ayacucho.';
const docs=[row(12),row(11,'20:00','ICA'),row(10,'19:00')];
const content=new Map([
  [12,page(rain+' '+outlook)], [11,page(negative)],
  [10,page('Durante la última hora se registraron precipitaciones en la ciudad de Piura con 44.5 mm, El Chira 13.4 mm, San Miguel 10.0 mm. Para las próximas horas, se prevén lluvias en la provincia de Talara.','19:00','21:00')],
]);
function source(rows=docs,pages=content) {
  const requests=[];
  async function fetchImpl(url) {
    requests.push(url);
    if(url===radarIndex) return Response.json({status:true,data:rows});
    const id=Number(url.match(/\/(\d+)\/file$/)?.[1]);
    if(!pages.has(id)) return new Response('Sin PDF',{status:503});
    return new Response('%PDF-'+pages.get(id),{headers:{'content-type':'application/pdf'}});
  }
  return {fetchImpl,requests,extract:async buffer=>buffer.toString().slice(5)};
}

test('publica lecturas en su lugar e intervalo, conserva la sede como cobertura y separa el pronóstico',async()=>{
  const result=await refreshRadar(null,{now:earlier,...source()});
  assert.equal(result.status,'ok');
  assert.deepEqual(result.coverage.map(c=>c.name),['Ica','Piura']);
  assert.deepEqual(result.observations.filter(r=>r.reportId===12).map(r=>[r.station,r.province,r.mm]),[
    ['Piura','Piura',3.8],['El Chira','Sullana',26.2],['Tongorape','Lambayeque',9.7]]);
  const chira=result.observations.find(r=>r.station==='El Chira');
  assert.equal(chira.from,'2026-11-27T00:00:00.000Z');
  assert.equal(chira.until,'2026-11-27T01:00:00.000Z');
  assert.equal(chira.url,docs[0].fileUrl);
  assert.deepEqual(chira.coordinates,[-80.73433,-4.85519]);
  assert.ok(chira.coordinateSource);
  assert.ok(!result.observations.find(r=>r.station==='Tongorape').coordinates);
  assert.deepEqual(result.forecasts.map(r=>r.province||r.region),['Paita','Sechura','Tumbes']);
  assert.ok(!result.observations.some(r=>r.region==='Tumbes'));
  assert.ok(!result.forecasts.some(r=>r.region==='Ica'));
  const old=result.reports.find(r=>r.id===10);
  assert.deepEqual(old.observations.map(r=>[r.locality||r.station,r.mm]),[['Piura',44.5],['El Chira',13.4]]);
  assert.match(old.observationText,/San Miguel 10.0 mm/);
  assert.equal(result.reports.find(r=>r.id===11).forecastText,negative);
});

test('la caducidad usa el reloj incluso con el servicio caído y el archivo conserva las lecturas hasta 24 horas',async()=>{
  const initial=await refreshRadar(null,{now:earlier,...source()});
  const unreachable=async()=>{throw Error('sin conexión');};
  const expired=await refreshRadar(initial,{now:new Date('2026-11-27T03:00:00Z'),fetchImpl:unreachable});
  assert.equal(expired.status,'stale');
  assert.equal(expired.lastSuccessAt,initial.lastSuccessAt);
  assert.equal(expired.observations.length,0);
  assert.equal(expired.forecasts.length,0);
  assert.ok(expired.reports.find(r=>r.id===12).observations.some(r=>r.mm===26.2));
  assert.equal(expired.coverage[0].status,'stale');
  const old=await refreshRadar(expired,{now:new Date('2026-11-28T01:01:00Z'),fetchImpl:unreachable});
  assert.equal(old.reports.length,0);
});

test('acepta un cambio de día y rechaza vigencia, documento o identidad incoherentes',()=>{
  const midnight=parseRadarReport(row(15,'23:00'),page(outlook,'23:00','01:00'));
  assert.equal(midnight.validUntil,'2026-11-27T06:00:00.000Z');
  assert.throws(()=>parseRadarReport(row(12),page(rain,'19:00','21:00')));
  assert.throws(()=>parseRadarReport({...row(12),fileUrl:'https://example.com/a.pdf'},page(rain)));
  assert.throws(()=>parseRadarReport(row(12),'Documento con lluvias en otros contextos'));
});

test('verifica ambas fechas impresas al cruzar la medianoche, el fin de mes o el de año',()=>{
  function check(date,dates) {
    return parseRadarReport({...row(1731,'22:00','ICA'),date},page(negative,'22:00','00:00').replace('26 DE NOVIEMBRE 2026',dates));
  }
  assert.equal(check('2026-11-26','26 Y 27 DE NOVIEMBRE 2026').validUntil,'2026-11-27T05:00:00.000Z');
  assert.equal(check('2026-11-30','30 DE NOVIEMBRE Y 1 DE DICIEMBRE DE 2026').validUntil,'2026-12-01T05:00:00.000Z');
  assert.equal(check('2026-12-31','31 DE DICIEMBRE 2026 Y 1 DE ENERO DEL 2027').validUntil,'2027-01-01T05:00:00.000Z');
  for (const dates of ['26 Y 28 DE NOVIEMBRE 2026','25 Y 27 DE NOVIEMBRE 2026','26 Y 27 DE OCTUBRE 2026',
    '26 Y 00 DE NOVIEMBRE 2026','26 DE NOVIEMBRE 2026 Y 31 DE NOVIEMBRE 2026']) {
    assert.throws(()=>check('2026-11-26',dates));
  }
  assert.throws(()=>check('2026-11-30','30 Y 1 DE DICIEMBRE 2026'));
  assert.throws(()=>parseRadarReport(row(44),page(rain).replace('26 DE NOVIEMBRE 2026','26 Y 27 DE NOVIEMBRE 2026')));
});

test('reconoce cada estación del parte 1732 y conserva regiones sin inferir provincias homónimas',async()=>{
  const body='Durante la última hora, se registraron precipitaciones en el departamento de Piura, en las provincias de Piura (estación San Miguel: 12.4 mm) y Sullana (estación La Ardilla: 32.3 mm); en Tumbes (estación Campamento Sede: 11.5 mm) y en Lambayeque (estación Vista Florida: 1.7 mm).';
  const doc=page(body,'22:00','00:00').replace('26 DE NOVIEMBRE','26 Y 27 DE NOVIEMBRE');
  const result=await refreshRadar(null,{now:new Date('2026-11-27T03:20:00Z'),...source([row(1732,'22:00')],new Map([[1732,doc]]))});
  assert.deepEqual(result.observations.map(o=>[o.region,o.province,o.station,o.mm]),[
    ['Piura','Piura','San Miguel',12.4],['Piura','Sullana','La Ardilla',32.3],['Tumbes',undefined,'Campamento Sede',11.5],['Lambayeque',undefined,'Vista Florida',1.7]]);
  assert.equal(result.observations[0].from,'2026-11-27T02:00:00.000Z');
  assert.equal(result.observations[0].until,'2026-11-27T03:00:00.000Z');
});

test('no atribuye lluvia a toda una región por proximidad, a ubicaciones desconocidas ni por negaciones',async()=>{
  const phrase='Durante la última hora no se registraron precipitaciones en la región Tumbes. Asimismo, se observaron lluvias en el sector Nuevo. Para las próximas horas, se esperan lluvias en la provincia de Ferreñafe, en el límite con la región Cajamarca.';
  const result=await refreshRadar(null,{now:earlier,...source([row(1)],new Map([[1,page(phrase)]]))});
  assert.equal(result.observations.length,0);
  assert.deepEqual(result.forecasts.map(r=>r.region),['Lambayeque']);
  assert.match(result.reports[0].observationText,/sector Nuevo/);
});

test('recupera en orden equitativo, obedece el máximo de 6 PDFs, y no vuelve a descargarlos',async()=>{
  const rows=[], pages=new Map();
  for(let h=20;h>15;h--) for(const [i,code] of ['PIURA','ICA'].entries()) {
    const itm=row(2*h+i,h+':00',code); rows.push(itm); pages.set(itm.id,page(outlook,h+':00',(h+2)+':00'));
  }
  const one=source(rows,pages);
  const initial=await refreshRadar(null,{now:earlier,...one});
  assert.equal(one.requests.length,7);
  assert.equal(initial.reports.length,6);
  assert.deepEqual(initial.reports.filter(r=>r.radar==='PIURA').map(r=>r.id),[40,38,36]);
  const skip=source(rows,pages);
  await refreshRadar(initial,{now:new Date('2026-11-27T01:23:00Z'),...skip});
  assert.equal(skip.requests.length,0);
  const two=source(rows,pages);
  const later=await refreshRadar(initial,{now:new Date('2026-11-27T01:30:00Z'),...two});
  assert.equal(two.requests.length,5);
  assert.equal(later.reports.length,10);
});

test('una corrección ilegible desactiva el pronóstico sustituido y se reintenta sin perder otras observaciones',async()=>{
  const first=await refreshRadar(null,{now:earlier,...source()});
  const corrected=row(20);
  const next=await refreshRadar(first,{now:new Date('2026-11-27T01:30:00Z'),...source([corrected,...docs],content)});
  assert.equal(next.status,'partial');
  assert.ok(!next.forecasts.some(r=>r.radar==='PIURA'));
  assert.ok(!next.reports.some(r=>r.id===12));
  assert.ok(next.reports.some(r=>r.id===10));
  assert.equal(next.coverage.find(c=>c.code==='PIURA').status,'unavailable');
  assert.equal(next.lastSuccessAt,first.lastSuccessAt);
  const newer=await refreshRadar(next,{now:new Date('2026-11-27T01:40:00Z'),
    ...source([corrected,...docs],new Map([...content,[20,page(rain+' '+outlook)]]))});
  assert.equal(newer.status,'ok');
  assert.ok(newer.observations.some(r=>r.reportId===20));
});

test('cada estación de una lista conserva su propia medida y la unidad común solo cuando el grupo la indica',async()=>{
  const body='Durante la última hora se registraron precipitaciones en la provincia de Sullana (estación El Chira: 33.8 mm, estación Alamor: 11.8 y estación La Ardilla: 15.4 mm) y en la provincia de Piura (estación Piura: 17.1 mm y estación San Miguel: 13.5 mm).';
  const result=await refreshRadar(null,{now:earlier,...source([row(1)],new Map([[1,page(body)]]))});
  assert.deepEqual(result.observations.map(r=>[r.province,r.station,r.mm]),[
    ['Sullana','El Chira',33.8],['Sullana','Alamor',11.8],['Sullana','La Ardilla',15.4],['Piura','Piura',17.1],['Piura','San Miguel',13.5]]);
  assert.equal(result.observations[1].unitFromGroup,true);
  assert.ok(!result.observations[1].coordinates);
  assert.deepEqual(result.observations[2].coordinates,[-80.38819,-4.49094]);
  assert.equal(result.reports[0].observations.length,5);
});

test('identifica el distrito por UBIGEO, conserva homónimos sin ubicar y acepta una provincia explícita',async()=>{
  const text='Durante la última hora se registraron lluvias en los distritos de Huarmaca y Salitral. Para las próximas horas, se esperan lluvias en el distrito de Salitral, provincia de Morropón.';
  const result=await refreshRadar(null,{now:earlier,...source([row(1)],new Map([[1,page(text)]]))});
  assert.deepEqual(result.observations.map(r=>[r.district,r.ubigeo]),[['Huarmaca','200304']]);
  assert.equal(result.forecasts.find(r=>r.district==='Salitral').ubigeo,'200406');
});

test('la edición conserva los PDF exclusivos de cada copia, la revisión vigente y la última lectura exitosa',async t=>{
  const previous=await refreshRadar(null,{now:earlier,...source()});
  const seedTime=new Date('2026-11-27T03:04:00Z');
  const pages=new Map([[21,page(rain+' '+outlook,'22:00','24:00')],[13,page(rain)]]);
  const seed=await refreshRadar(null,{now:seedTime,...source([row(21,'22:00'),row(13)],pages)});
  const failedTime=new Date('2026-11-27T03:08:00Z');
  const unreachable=async()=>{throw Error('fuente sin conexión');};
  const failed=await refreshRadar(previous,{now:failedTime,fetchImpl:unreachable});
  const now=new Date('2026-11-27T03:09:00Z');
  const http=t.mock.method(globalThis,'fetch',unreachable);
  const edition=await enrichEdition({items:[],sources:[],updatedAt:now.toISOString()}, {radar:failed}, {
    readSeed:async filename=>filename==='radar-semilla.json' ? seed : null,
  });
  assert.equal(http.mock.callCount(),0); // The failed attempt is still inside the polling interval.
  const {radar}=edition;
  assert.equal(radar.status,'stale');
  assert.equal(radar.checkedAt,failedTime.toISOString());
  assert.equal(radar.lastSuccessAt,seedTime.toISOString());
  assert.deepEqual(radar.reports.map(r=>r.id),[21,13,11,10]);
  assert.deepEqual(radar.coverage.map(d=>[d.code,d.latestReportId]),[['ICA',11],['PIURA',21]]);
  assert.ok(radar.forecasts.length && radar.forecasts.every(f=>f.reportId===21));
  assert.ok(radar.reports.find(r=>r.id===10).observations.length);
  assert.ok(!radar.observations.some(r=>r.reportId===10));
  assert.deepEqual(edition.sources.map(s=>[s.status,s.lastSuccessAt]),[['stale',seedTime.toISOString()]]);
  const retried=await refreshRadar(radar,{now:new Date('2026-11-27T03:20:00Z'),fetchImpl:unreachable});
  assert.deepEqual(retried.reports.map(r=>r.id),[21,13,11,10]);
  assert.equal(retried.lastSuccessAt,radar.lastSuccessAt);
});

test('un PDF corregido y pendiente de lectura no reaparece por una copia con la siguiente hora',async()=>{
  const initial=await refreshRadar(null,{now:earlier,...source()});
  const corrected=await refreshRadar(initial,{now:new Date('2026-11-27T01:30:00Z'),
    ...source([row(20),...docs],content)});
  const now=new Date('2026-11-27T03:05:00Z');
  const later=await refreshRadar(null,{now,...source([row(42,'22:00'),...docs],new Map([
    ...content,[42,page(rain,'22:00','24:00')],
  ]))});
  const merged=mergedRadar(corrected,later,now);
  assert.deepEqual(merged.reports.map(r=>r.id),[42,11,10]);
  assert.equal(merged.coverage.find(d=>d.code==='PIURA').latestReportId,42);
});

test('un índice atrasado no vuelve a descargar ni declara vigente una versión anterior de la misma hora',async()=>{
  const correctedAt=new Date('2026-11-27T01:25:00Z');
  const current=await refreshRadar(null,{now:correctedAt,
    ...source([row(20),...docs],new Map([...content,[20,page(rain+' '+outlook)]]))});
  const older=source();
  const next=await refreshRadar(current,{now:new Date('2026-11-27T01:40:00Z'),...older});
  assert.deepEqual(older.requests,[radarIndex]);
  assert.deepEqual(next.reports.map(r=>r.id),[20,11,10]);
  assert.equal(next.coverage.find(d=>d.code==='PIURA').latestReportId,20);
  assert.equal(next.status,'partial');
  assert.equal(next.lastSuccessAt,correctedAt.toISOString());
});
