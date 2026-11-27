import assert from 'node:assert/strict';
import test from 'node:test';
import {riverObservationFromText} from '../lib/oficiales.mjs';
import {phisisRiverIndex,riverSource} from '../lib/rios-phisis.mjs';

const title='INCREMENTO DEL CAUDAL DEL RÍO TUMBES - ESTACIÓN CABO INGA';
const summary='Hoy Jueves, 26 de Noviembre de 2026 a las 21:00 hrs, la estación hidrológica CABO INGA, registró un CAUDAL de 608.88 m3/s, ubicándose en el umbral AMARILLO.';
const now=new Date('2026-11-27T04:24:00Z');
const observedAt='2026-11-27T02:00:00.000Z';
const url='https://www.senamhi.gob.pe/?p=avisos-detalle-hidrologicos&ca=70799&ce=47E01126';
const web={id:'senamhi-rios:2026-1719',url,noticeNumber:'1719',sourceStatus:'vigente',
  title,summary,regions:['Tumbes'],region:'Tumbes',publishedAt:'2026-11-27T03:34:00Z',...riverObservationFromText(summary,title)};
const feature={id:'aviso_hidro_pub.47E01126',geometry:{type:'Point',coordinates:[-80.25,-3.73]},
  properties:{num_aviso:1719,id_aviso:70799,titulo:title,nom_estacion:'CABO INGA',nom_provincia:'TUMBES',
    nom_distrito:'SAN JACINTO',nom_departamento:'TUMBES',fecha_hora:observedAt,color_text:'AMARILLO'}};
const response=features=>({body:JSON.stringify({type:'FeatureCollection',totalFeatures:features.length,features})});

test('la ficha de Ríos identifica el caudal o el nivel y la hora de la medición',()=>{
  assert.deepEqual(riverObservationFromText(summary,title),{stationName:'Cabo Inga',observedAt,
    riverMeasurement:{kind:'caudal',value:608.88,unit:'m³/s'}});
  const level=summary.replace('CAUDAL de 608.88 m3/s','NIVEL de 3,5 m.s.n.m');
  assert.equal(riverObservationFromText(level,title.replace('CAUDAL','NIVEL')).riverMeasurement.unit,'m s. n. m.');
  for(const invalid of [summary.replace('26 de','31 de'),summary.replace('21:00','29:00'),
    summary.replace('CABO INGA','OTRA ESTACIÓN'),summary.replace('608.88 m3/s','608 m'),summary.replace('registró','prevé')])
    assert.equal(riverObservationFromText(invalid,title),undefined);
});

test('un WFS vacío que contradice al índice se vuelve a consultar antes de ubicar el aviso',async()=>{
  const checks=[];
  const fetchItems=riverSource({fetchWeb:async()=>[web],read:async(url,opts)=>{
    assert.equal(url,phisisRiverIndex);
    checks.push(opts);
    return response(checks.length===1?[]:[feature]);
  }});
  const [record]=await fetchItems({now});
  assert.equal(checks.length,2);
  assert.equal(checks[1].cache,'no-cache');
  assert.equal(record.stationDistrict,'San Jacinto');
  assert.equal(record.observedAt,observedAt);
  assert.equal(record.publishedAt,web.publishedAt);
});

test('una lectura incompleta conserva la geografía verificada de la misma ficha, sin renovar la verificación',async()=>{
  const listedAt='2026-11-27T03:40:00Z';
  const old={...web,stationProvince:'Tumbes',stationDistrict:'San Jacinto',phisisListedAt:listedAt,
    coordinates:feature.geometry.coordinates,coverageUrls:[phisisRiverIndex+'&CQL_FILTER=id_aviso%3D70799']};
  const different={...web,id:'senamhi-rios:2026-1720',noticeNumber:'1720',url:url.replace('70799','70800')};
  const fetchItems=riverSource({fetchWeb:async()=>[web,different],read:async()=>{throw Error('Sin respuesta');},diagnose:()=>'TIEMPO_AGOTADO'});
  const [known,next]=await fetchItems({now,previousItems:[old]});
  assert.equal(known.phisisListedAt,listedAt);
  assert.deepEqual(known.coordinates,feature.geometry.coordinates);
  assert.equal(next.stationDistrict,undefined);
  assert.equal(next.coordinates,undefined);
});
