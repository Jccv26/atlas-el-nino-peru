import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {comparisonValid,isTemperatureSnapshot,parseTemperatureSeries} from '../lib/temperatura.mjs';

const seed=JSON.parse(await readFile(new URL('../public/data/temperatura.json',import.meta.url),'utf8'));

test('las anomalías y fechas de cada máximo concuerdan con toda la serie de su ventana',()=>{
  assert.ok(isTemperatureSnapshot(seed));assert.ok(comparisonValid(seed));
  const tampered=structuredClone(seed);
  tampered.comparison[1].anomalies.pop();assert.equal(comparisonValid(tampered),false);
  const peak=structuredClone(seed);peak.comparison[0].peak.date=peak.comparison[0].firstWeek;
  assert.equal(comparisonValid(peak),false);
  const legacy={...seed};delete legacy.comparison;assert.ok(isTemperatureSnapshot(legacy));
});

test('la columna Niño 1+2 preserva máximos empatados y el corte de un período incompleto',()=>{
  const months='JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC'.split(' ');
  const lines=['Weekly SST data starts week centered on 2Sept1981','Nino1+2 Nino3 Nino34 Nino4','Week SST SSTA SST SSTA SST SSTA SST SSTA'];
  const last=Date.UTC(1982,0,20);
  for(let t=Date.UTC(1981,8,2);t<=last;t+=7*86400000){
    const d=new Date(t),date=String(d.getUTCDate()).padStart(2,'0')+months[d.getUTCMonth()]+d.getUTCFullYear();
    lines.push(date+'     24.0 '+(t>=last-7*86400000?'2.5':'1.3')+'     28.0 4.2     26.0 4.0     27.1 3.0');
  }
  const s=parseTemperatureSeries(lines.join('\n'),last+86400000);
  assert.ok(isTemperatureSnapshot(s));assert.equal(s.comparison.length,1);
  assert.deepEqual(s.comparison[0].anomalies,[1.3,2.5,2.5]);
  assert.deepEqual(s.comparison[0].peak.dates,['1982-01-13','1982-01-20']);
});
