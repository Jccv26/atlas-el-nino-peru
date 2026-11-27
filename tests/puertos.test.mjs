import test from 'node:test';
import assert from 'node:assert/strict';
import {portStatus} from '../lib/puertos-dicapi.mjs';

const rows = [
  {portId:89,port:'CALETA CHALA',captaincy:'San Juan',level:'Nivel V',levelName:'Cierre Total del Puerto'},
  {portId:85,port:'PUERTO SAN JUAN',captaincy:'San Juan',level:'Nivel III',levelName:'Cierre Parcial del Puerto'},
  {portId:127,port:'PUERTO NAUTA',captaincy:'Iquitos',level:'Nivel I',levelName:'Puerto Abierto'},
  {portId:94,port:'MUELLE PUNO',captaincy:'Puno',level:'Nivel I',levelName:'Puerto Abierto'},
];
const summary={status:0,data:[
  {name:'Cierre Total del Puerto',total:1},
  {name:'Cierre Parcial del Puerto',total:1},
  {name:'Puerto Abierto',total:2},
]};

test('el alcance marítimo y el departamento corresponden a cada instalación',()=>{
  const stats=portStatus({status:0,data:rows},summary);
  assert.deepEqual(stats.coastal,{total:2,open:0,partial:1,closed:1});
  assert.equal(stats.areas.Fluvial.open,1);
  assert.equal(stats.areas.Lacustre.open,1);
  assert.deepEqual(stats.ports.map(port=>port.region),['Arequipa','Ica','Loreto','Puno']);
});

test('un puerto nuevo conserva su capitanía sin heredar el departamento de la sede',()=>{
  const newPort={...rows[0],portId:999,port:'Nuevo terminal',resolution_url:'https://example.com/no-oficial.pdf'};
  const stats=portStatus({status:0,data:[newPort,...rows.slice(1)]},summary);
  assert.equal(stats.coastal.total,2);
  assert.equal(stats.ports[0].region,undefined);
  assert.equal(stats.ports[0].url,undefined);
  assert.equal(stats.ports[0].date,undefined);
});

test('se rechaza una lectura parcial o duplicada aunque tenga el formato habitual',()=>{
  assert.throws(()=>portStatus({status:0,data:rows.slice(1)},summary));
  assert.throws(()=>portStatus({status:0,data:[...rows,rows[0]]},summary));
});
