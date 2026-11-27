"""Genera el índice UBIGEO y una capa SVG por padre desde el servicio INEI de SERFOR."""
import argparse
import collections
import json
import math
import re
import urllib.parse
import urllib.request
from pathlib import Path

BASE = 'https://geo.serfor.gob.pe/geoservicios/rest/services/Visor/Limites_Politicos_Administrativos/MapServer'
ROOT = Path(__file__).resolve().parents[1] / 'public' / 'atlas' / 'territorios'
DEPARTMENTS = 'Amazonas|Áncash|Apurímac|Arequipa|Ayacucho|Cajamarca|Callao|Cusco|Huancavelica|Huánuco|Ica|Junín|La Libertad|Lambayeque|Lima|Loreto|Madre de Dios|Moquegua|Pasco|Piura|Puno|San Martín|Tacna|Tumbes|Ucayali'.split('|')


def load(layer, raw):
    number = 1 if layer == 'provincias' else 2
    fields = 'IDDPTO,NOMBDEP,IDPROV,NOMBPROV' + (',IDDIST,NOMBDIST' if number == 2 else '')
    query = urllib.parse.urlencode(dict(where='1=1', outFields=fields, outSR=4326, f='json', maxAllowableOffset=0.0015 if number == 1 else 0.00085, geometryPrecision=5, returnGeometry='true'))
    if raw:
        data = json.loads((raw / ('perualdia-territorio-' + layer + '.json')).read_text())
    else:
        with urllib.request.urlopen(f'{BASE}/{number}/query?{query}', timeout=90) as response:
            data = json.load(response)
    if data.get('exceededTransferLimit') or data.get('spatialReference', {}).get('wkid') != 4326:
        raise ValueError('Capa incompleta o sistema de coordenadas inesperado')
    return data['features']


def compact(n):
    return f'{n:.4f}'.rstrip('0').rstrip('.')


def point_inside(rings, bounds):
    # Longest horizontal interval wholly inside the boundaries (including holes).
    x0, y0, x1, y1 = bounds
    best = None
    for fraction in [.5, .375, .625, .25, .75, .125, .875]:
        y = y0 + (y1-y0) * fraction
        intersections = []
        for ring in rings:
            for (a,b),(c,d) in zip(ring, ring[1:] + [ring[0]]):
                if (b > y) != (d > y):
                    intersections.append(a + (y-b)*(c-a)/(d-b))
        ordered = sorted(intersections)
        for left,right in zip(ordered[::2], ordered[1::2]):
            if right > left and (best is None or right-left > best[0]):
                best = (right-left, (left+right)/2, y)
    if not best:
        raise ValueError(f'No se encontró punto interior en {bounds}')
    return [round(best[1],5),round(best[2],5)]


def geometry(source):
    rings = []
    for ring in source['rings']:
        points = [(round(105+x,4),round(6-y,4)) for x,y in ring]
        if not all(math.isfinite(a) and 20<a<40 and 5<b<26 for a,b in points):
            raise ValueError('Coordenada fuera de Perú')
        if points[-1] == points[0]:
            points.pop()
        if len(set(points)) >= 3:
            rings.append(points)
    xs, ys = zip(*(point for ring in rings for point in ring))
    bounds = [min(xs),min(ys),max(xs),max(ys)]
    path = ''.join('M'+'L'.join(f'{compact(x)},{compact(y)}' for x,y in r)+'Z' for r in rings)
    box = dict(x=bounds[0],y=bounds[1],width=round(bounds[2]-bounds[0],4),height=round(bounds[3]-bounds[1],4))
    return path,box,point_inside(rings,bounds)


def display_name(raw):
    return ' '.join(word.lower() if i and word in {'DE','DEL','LA','LAS','LOS','Y'} else word.title() for i,word in enumerate(raw.split()))


def save(name, data):
    (ROOT / name).write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--raw-dir', type=Path, help='Carpeta de las dos consultas ArcGIS previamente descargadas')
    raw = parser.parse_args().raw_dir
    catalog = {'source': {'name':'INEI · Límites censales referenciales 2024 (SERFOR)', 'url':BASE}, 'departments':[{'id':f'{i:02}', 'name':n} for i,n in enumerate(DEPARTMENTS,1)], 'provinces':[], 'districts':[]}
    groups = collections.defaultdict(list)
    parents = {x['id'] for x in catalog['departments']}
    for layer, key, id_field, name_field in [('provincias','provinces','IDPROV','NOMBPROV'), ('distritos','districts','IDDIST','NOMBDIST')]:
        codes = set()
        for row in load(layer, raw):
            a = row['attributes']; code = a[id_field]; parent = code[:-2]
            if not re.fullmatch(r'\d{4}' if layer=='provincias' else r'\d{6}',code) or code in codes or parent not in parents or a['IDDPTO'] != code[:2] or a['IDPROV'] != code[:4]:
                raise ValueError(f'UBIGEO incompatible: {code}')
            name = display_name(a[name_field]); d,box,center = geometry(row['geometry'])
            groups[parent].append(dict(id=code,name=name,d=d,box=box))
            catalog[key].append(dict(id=code,name=name,center=center)); codes.add(code)
        if {code[:-2] for code in codes} != parents or len(codes) < (196 if layer=='provincias' else 1891):
            raise ValueError('Faltan unidades de la cartografía nacional')
        catalog[key].sort(key=lambda x:x['id']); parents=codes
    ROOT.mkdir(parents=True,exist_ok=True)
    for parent, features in groups.items():
        save(parent+'.json',dict(parent=parent,features=sorted(features,key=lambda x:x['id'])))
    save('catalogo.json',catalog)


if __name__ == '__main__':
    main()
