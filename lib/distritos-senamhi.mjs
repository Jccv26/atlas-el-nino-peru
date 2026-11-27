import {readFileSync} from 'node:fs';

const catalog = JSON.parse(readFileSync(new URL('../public/atlas/territorios/catalogo.json',import.meta.url),'utf8'));
const levels = {2:'AMARILLO',3:'NARANJA',4:'ROJO'};
const slug = text => text.replace(/Ã±/gi,'ñ').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
function byParent(entries) {
  const index = new Map();
  for (const {id,name} of entries) {
    const key = id.slice(0,-2)+'/'+slug(name);
    index.set(key, index.has(key) ? null : id);
  }
  return index;
}
const departments = byParent(catalog.departments);
const provinces = byParent(catalog.provinces);
const districts = byParent(catalog.districts);

function links(block, requiredClass) {
  const result = [];
  for (const [,attrs] of block.matchAll(/<a\b([^>]+)>/gi)) {
    const classes = attrs.match(/\bclass=["']([^"']+)["']/i)?.[1]?.split(/\s+/) ?? [];
    const id = attrs.match(/\bid=["']([^"']+)["']/i)?.[1];
    if (id && classes.includes(requiredClass)) result.push({id,classes});
  }
  return result;
}
function section(html, type, level) {
  return html.match(new RegExp(`<div\\b[^>]*\\bid=["']ubicacion${type}${level}["'][^>]*>([\\s\\S]*?)</div>`, 'i'))?.[1] || '';
}
export function distritosDelVisor(html) {
  const districtLevels = {}, districtUnmatchedCounts = {};
  for (const [number,level] of Object.entries(levels)) {
    const provinceIds = new Map();
    for (const {id,classes} of links(section(html,'Prov',number),'depTotales')) {
      const dep = classes.find(c=>c.startsWith('dep_'))?.slice(4);
      if (!dep || !id.startsWith(dep+'_')) continue;
      const name = id.slice(dep.length+1);
      const department = departments.get('/'+slug(dep));
      const province = provinces.get(department+'/'+slug(name));
      if (province) {
        const list = provinceIds.get(name) || new Set();
        list.add(province); provinceIds.set(name,list);
      }
    }
    const seen = new Set();
    for (const {id,classes} of links(section(html,'Dist',number),'distTotales')) {
      const prov = classes.find(c=>c.startsWith('prov_'))?.slice(5);
      if (seen.has(id)) continue;
      seen.add(id);
      const scope = provinceIds.get(prov);
      const district = scope?.size === 1 && id.startsWith(prov+'_') && districts.get([...scope][0]+'/'+slug(id.slice(prov.length+1)));
      if (district) (districtLevels[district] ??= []).push(level);
      else districtUnmatchedCounts[level]=(districtUnmatchedCounts[level] ?? 0)+1;
    }
  }
  return {districtLevels,districtUnmatchedCounts};
}
