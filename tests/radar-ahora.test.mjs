import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRadarReport, radarIndex, refreshRadar} from '../lib/radar-ahora.mjs';

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
