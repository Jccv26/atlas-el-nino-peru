import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {archivoSectores,actualizarSectores} from '../lib/sectores-senamhi.mjs';
import {distritosDelVisor} from '../lib/distritos-senamhi.mjs';

const atlas = new URL('../public/atlas/territorios/',import.meta.url);
const json = async name=>JSON.parse(await readFile(new URL(name,atlas),'utf8'));

test('todas las unidades UBIGEO tienen un solo padre y un punto dentro de su contorno',async()=>{
  const catalog=await json('catalogo.json');
  assert.equal(catalog.departments.length,25);
  assert.equal(catalog.provinces.filter(p=>p.id.startsWith('15')).length,10);
  assert.equal(catalog.districts.filter(d=>d.id.startsWith('1501')).length,43);
  assert.equal(catalog.districts.filter(d=>d.id.startsWith('0701')).length,7);
  const places=[...catalog.provinces,...catalog.districts];
  const seen=new Set();
  for (const {id} of [...catalog.departments,...catalog.provinces]) {
    const layer=await json(id+'.json'); assert.equal(layer.parent,id);
    for (const feature of layer.features) {
      assert.ok(!seen.has(feature.id) && feature.id.slice(0,-2)===id);
      seen.add(feature.id);
      const place=places.find(x=>x.id===feature.id);
      assert.equal(feature.name,place.name);
      const {x,y,width,height}=feature.box, [cx,cy]=place.center;
      assert.ok(x<=cx && cx<=x+width && y<=cy && cy<=y+height);
      let inside=false;
      for (const [,path] of feature.d.matchAll(/M([^MZ]+)Z/g)) {
        const points=path.split('L').map(pair=>pair.split(',').map(Number));
        for (let i=0,j=points.length-1;i<points.length;j=i++) {
          const [a,b]=points[j],[c,d]=points[i];
          if ((b>cy)!==(d>cy) && cx<(c-a)*(cy-b)/(d-b)+a) inside=!inside;
        }
      }
      assert.ok(inside,'Punto de referencia fuera de '+feature.id);
    }
  }
  assert.equal(seen.size,places.length);
});

test('un distrito requiere su provincia en el mismo nivel y puede abarcar dos niveles',()=>{
  const section=(level,province,slug,district)=>`<div id="ubicacionProv${level}"><a id="${province}" class="dep_${province.split('_')[0]} depTotales">PROVINCIA</a></div><div id="ubicacionDist${level}"><a id="${slug}_${district}" class="prov_${slug} distTotales">DISTRITO</a></div>`;
  const html=section(2,'lima_lima','lima','miraflores')+section(3,'lima_lima','lima','miraflores')+section(4,'lima_yauyos','lima','miraflores');
  const r=distritosDelVisor(html);assert.deepEqual(r.districtLevels,{'150122':['AMARILLO','NARANJA']}); assert.deepEqual(r.districtUnmatchedCounts,{ROJO:1});
  assert.equal(distritosDelVisor(section(3,'lambayeque_ferreÃ±afe','ferreÃ±afe','caÃ±aris')).districtLevels['140202'][0],'NARANJA');
});

const kind='senamhi-lluvias', date='2026-11-26', number='330';
const row=(date,n,url)=>`<tr><td>${date}</td><td>${n}</td><td><a href="${url}">Descargar</a></td></tr>`;
const sourceUrl='https://www.senamhi.gob.pe/load/file/02249SENA-3534.zip';
const validFrom=date+'T18:00:00.000Z', validUntil='2026-11-27T18:00:00.000Z';

test('el ZIP proviene de la misma fila, edición y fuente',()=>{
  const html=row('2026-11-25','329',sourceUrl)+row(date,'330',sourceUrl);
  assert.equal(archivoSectores(html,kind,date,number),sourceUrl);
  assert.equal(archivoSectores(html,kind,date,'329'),null);
  assert.equal(archivoSectores(html.replaceAll('www.senamhi.gob.pe','example.org'),kind,date,number),null);
  assert.equal(archivoSectores(html,'senamhi-quebradas',date,number),null);
});

test('solo vincula la cartografía con el producto, edición e intervalo vigentes',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'sectores-prueba-'));
  try {
    const now='2026-11-27T02:00:00.000Z';
    const record={sourceId:kind,noticeNumber:number,validFrom,validUntil};
    const seed={...record,date,sourceUrl,checkedAt:now,features:[{level:'ROJO',d:'M25,12L25,13L26,12Z'}]};
    const file=join(dir,'sectores-lluvias.json'); await writeFile(file,JSON.stringify(seed));
    await actualizarSectores([record],dir,now); assert.equal(record.sectorMap.url,'data/sectores-lluvias.json');
    await actualizarSectores([record],dir,validUntil); assert.equal(record.sectorMap,undefined);
    for(const change of [{sourceId:'senamhi-quebradas'},{noticeNumber:'329'},{validUntil:'2026-11-27T18:01:00.000Z'},{date:'2026-11-25'}]) {
      await writeFile(file,JSON.stringify({...seed,...change}));await actualizarSectores([record],dir,now);assert.equal(record.sectorMap,undefined);
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('la navegación se detiene en provincia mientras el catálogo conserva distritos y su región', async()=>{
  const {territoryIndex}=await import('../public/territorios.mjs');
  const data=await json('catalogo.json'),index=territoryIndex(data);
  const regions=[...data.departments.map(r=>r.name),'Lima Metropolitana'];
  const offered=regions.flatMap(r=>index.children(r).map(p=>p.id));
  assert.equal(offered.length,196);
  assert.equal(new Set(offered).size,196);
  assert.deepEqual(index.children('Lima Metropolitana').map(p=>p.id),['1501']);
  assert.equal(index.children('Lima').length,9);
  for(const p of data.provinces) {
    assert.ok(p.box.width>0 && p.box.height>0);
    assert.deepEqual(index.children(index.regionOf(p.id),p.id),[]);
    assert.ok(offered.includes(p.id));
  }
  for(const d of data.districts) {
    assert.equal(index.regionOf(d.id),index.regionOf(d.id.slice(0,4)));
    assert.deepEqual(index.children(index.regionOf(d.id),d.id),[]);
  }
});

test('la vista provincial conserva los anillos oficiales y sus huecos cercanos',async()=>{
  const {provincialHazardPath}=await import('../public/mapa-local.mjs');
  const near='M20,10L21,10L21,11L20,11Z',hole='M20.1,10.1L20.2,10.1L20.2,10.2Z';
  const far='M32,15L33,15L33,16Z',feature={d:near+hole+far},box={x:20,y:10,width:1,height:1};
  assert.equal(provincialHazardPath(feature,box),near+hole);
  assert.equal(provincialHazardPath(feature),feature.d);
  assert.equal(provincialHazardPath({d:'M3 2h2v2Z'},box),'M3 2h2v2Z');
});

test('cada círculo regional cabe dentro del polígono, sin cruzar una costa, un enclave o una isla',async()=>{
  const {regions}=JSON.parse(await readFile(new URL('../public/atlas/geografia.json',import.meta.url),'utf8'));
  assert.equal(regions.length,26);
  for(const {name,d,labelCircle} of regions) {
    const [x,y,r]=labelCircle;
    assert.ok(r>0 && [x,y,r].every(Number.isFinite),name);
    let inside=false,nearest=Infinity;
    for(const [,contour] of d.matchAll(/M([^MZ]+)Z/g)) {
      const ring=contour.split('L').map(p=>p.split(',').map(Number));
      for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
        const [ax,ay]=ring[j],[bx,by]=ring[i];
        const dx=bx-ax,dy=by-ay,length=dx*dx+dy*dy;
        if((ay>y)!==(by>y) && x<ax+dx*(y-ay)/dy)inside=!inside;
        const t=length ? Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/length)) : 0;
        nearest=Math.min(nearest,Math.hypot(x-ax-t*dx,y-ay-t*dy));
      }
    }
    assert.ok(inside,name+' debe tener el centro en tierra de la propia región');
    assert.ok(r<=nearest+1e-10 && nearest-r<0.000011,name+' debe aprovechar el radio interior hasta el borde más próximo');
  }
});
