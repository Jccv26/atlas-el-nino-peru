import test from 'node:test';
import assert from 'node:assert/strict';
import {layerRecords, noticeForRegionDay} from '../public/avisos-mapa.mjs';
import {fechaParteCoen, tiemposLluviaInmediata} from '../lib/oficiales.mjs';

const june26 = Date.parse('2026-06-26T19:00:00-05:00');
const rain = {
  id:'senamhi-meteo:2026-12', sourceId:'senamhi-meteo', category:'Lluvias', noticeNumber:'12',
  validFrom:'2026-06-25', validUntil:'2026-06-27', regions:['Callao','Ica','Piura'],
  coverageDaysComplete:true,
  coverageDays:[
    {date:'2026-06-25', regions:['Callao']},
    {date:'2026-06-26', regions:['Ica'], provincesByRegion:{Ica:['Nasca']}},
    {date:'2026-06-27', regions:['Piura'], provincesByRegion:{Piura:['Sechura']}},
  ],
};

test('la fecha en Perú delimita la cobertura del aviso en cada región', () => {
  const [national] = layerRecords([rain], june26);
  assert.deepEqual(national.regions, ['Ica','Piura']);
  assert.equal(noticeForRegionDay(national,'Callao',june26), null);
  assert.deepEqual(noticeForRegionDay(national,'Ica',june26).applicableDates, ['2026-06-26']);
  const piura = noticeForRegionDay(national,'Piura',june26);
  assert.deepEqual(piura.provincesByRegion, {Piura:['Sechura']});
  assert.ok(Date.parse(piura.validFrom) > june26);
  assert.deepEqual(layerRecords([rain],Date.parse('2026-06-28T05:00Z')), []);
});

test('un mapa diario incompleto no permite descartar regiones del aviso', () => {
  const partial = {...rain, coverageDaysComplete:false, coverageDays:rain.coverageDays.slice(-1)};
  assert.deepEqual(layerRecords([partial],june26)[0].regions, rain.regions);
});

test('la copia del COEN no duplica ni reactiva un aviso hidrológico retirado', () => {
  const river = {id:'senamhi-rios:2026-12', sourceId:'senamhi-rios', category:'Ríos',
    title:'Río de prueba', regions:['Loreto'], url:'https://www.senamhi.gob.pe/'};
  const copy = {id:'coen:1', sourceId:'coen', category:'Ríos', title:'Boletín de aviso hidrológico',
    url:'https://portal.indeci.gob.pe/', regions:['Loreto'],
    originNotice:{sourceId:'senamhi-rios',year:'2026',number:'12'}};
  assert.equal(layerRecords([river,copy],june26).length, 1);
  assert.deepEqual(layerRecords([{...river,withdrawnAt:'2026-06-26T14:00:00Z'},copy],june26), []);
});

test('las fechas del parte y el pronóstico provienen de la publicación oficial', () => {
  assert.equal(fechaParteCoen('REPORTE del 26/11/2026 / COEN-INDECI / 17:21 HORAS'), '2026-11-26T22:21:00.000Z');
  assert.equal(fechaParteCoen('REPORTE del 26/11/2026'), null);
  const html = ['txtFecha2A','txtFecha2P','txtFecha2P_2H'].map((id,i) =>
    '<span id="'+id+'">2026-06-26&nbsp;&nbsp;'+(17+i)+':50</span>').join('');
  assert.equal(tiemposLluviaInmediata(html).forecast2h,'2026-06-27T00:50:00.000Z');
  assert.throws(() => tiemposLluviaInmediata('<p>Sin pronóstico</p>'));
});
