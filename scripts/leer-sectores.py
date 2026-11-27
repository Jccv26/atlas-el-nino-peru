"""Convierte un ZIP SHP fechado de SENAMHI a trazos en la proyección del atlas."""
import datetime
import io
import json
import re
import struct
import sys
import zipfile
from collections import defaultdict

LEVELS = {'2':'AMARILLO','3':'NARANJA','4':'ROJO'}


def simplify(points, tolerance):
    if len(points) < 7:
        return points
    # Closed polygons need two distinct ends for Douglas–Peucker.
    x,y = points[0]
    opposite = max(range(1,len(points)-1),key=lambda i:(points[i][0]-x)**2+(points[i][1]-y)**2)
    keep = {0,opposite,len(points)-1}
    intervals = [(0,opposite),(opposite,len(points)-1)]
    while intervals:
        start,end = intervals.pop()
        x,y = points[start]; dx,dy = points[end][0]-x,points[end][1]-y
        denom = dx*dx+dy*dy
        best = tolerance*tolerance
        idx = None
        for i in range(start+1,end):
            px,py = points[i][0]-x,points[i][1]-y
            t = min(1,max(0,(px*dx+py*dy)/denom)) if denom else 0
            dd = (px-t*dx)**2+(py-t*dy)**2
            if dd > best:
                idx,best = i,dd
        if idx is not None:
            keep.add(idx); intervals.extend([(start,idx),(idx,end)])
    return [points[i] for i in sorted(keep)] if len(keep) >= 4 else points


def read_shapes(archive, date):
    members = archive.infolist()
    if len(members)>50 or sum(m.file_size for m in members)>72_000_000:
        raise ValueError('Archivo fuera de límites')
    stems = [m.filename[:-4] for m in members if m.filename.lower().endswith('.shp')]
    if len(stems)!=1:
        raise ValueError('Se requiere una sola capa')
    parts = {m.filename.lower():m for m in members}
    read = lambda ext: archive.read(parts[stems[0].lower()+ext])
    prj = read('.prj').decode('ascii').upper()
    if not prj.startswith('GEOGCS[') or 'WGS' not in prj or 'DEGREE' not in prj:
        raise ValueError('Sistema geográfico inesperado')
    shape, dbf = read('.shp'), read('.dbf')
    count,header,entry = struct.unpack_from('<IHH',dbf,4)
    if not 0<count<=25000 or header+count*entry>len(dbf) or struct.unpack_from('>I',shape)[0]!=9994 or struct.unpack_from('<I',shape,32)[0]!=5:
        raise ValueError('Capa incompleta o no poligonal')
    fields = {}; offset = 1
    for i in range(32,header-1,32):
        name = dbf[i:i+11].split(b'\0')[0].decode('ascii').lower()
        length = dbf[i+16]; fields[name] = (offset,offset+length); offset += length
    if not {'nivel','fecha'}<=fields.keys() or offset!=entry:
        raise ValueError('Campos de fecha y nivel no reconocibles')
    grouped = defaultdict(list); pos = 100
    for i in range(count):
        rowid,words = struct.unpack_from('>II',shape,pos); pos += 8; end = pos+words*2
        if end>len(shape) or rowid!=i+1 or words<22 or struct.unpack_from('<I',shape,pos)[0]!=5:
            raise ValueError('Polígono incompleto')
        record = dbf[header+i*entry:header+(i+1)*entry]
        get = lambda name: record[slice(*fields[name])].decode('ascii').strip()
        raw_date = get('fecha')
        if raw_date.replace('-','')!=date.replace('-','') or record[:1]!=b' ':
            raise ValueError('Geometría de otra edición')
        raw_level = re.fullmatch(r'(?:Nivel\s+)?([1234])',get('nivel'),re.I)
        if not raw_level:
            raise ValueError('Nivel oficial desconocido')
        # El nivel 1 es la zona blanca sin peligro indicado en el visor.
        if raw_level[1]=='1':
            pos=end
            continue
        nr, np = struct.unpack_from('<II',shape,pos+36)
        point_offset = pos+44+4*nr
        if nr<1 or np<3 or point_offset+16*np!=end:
            raise ValueError('Anillos inválidos')
        breaks = list(struct.unpack_from('<'+'I'*nr,shape,pos+44))+[np]
        if breaks[0]!=0 or any(a>=b for a,b in zip(breaks,breaks[1:])):
            raise ValueError('Índices inválidos')
        paths=[]
        for a,b in zip(breaks,breaks[1:]):
            points=list(struct.iter_unpack('<dd',shape[point_offset+16*a:point_offset+16*b]))
            if not all(-87<x<-64 and -22<y<4 for x,y in points) or points[0]!=points[-1]:
                raise ValueError('Coordenadas inválidas')
            reduced=simplify(points,0.0015)
            points=[(round(x+105,4),round(6-y,4)) for x,y in reduced[:-1]]
            if len(set(points))>=3:
                paths.append('M'+'L'.join(f'{x:g},{y:g}' for x,y in points)+'Z')
        grouped[raw_level[1]].extend(paths); pos=end
    if pos!=len(shape) or not any(grouped.values()):
        raise ValueError('No se pudo validar el total de geometrías')
    return [{'level':LEVELS[n], 'd':''.join(grouped[n])} for n in sorted(grouped) if grouped[n]]


if __name__=='__main__':
    try:
        date = sys.argv[1]; datetime.date.fromisoformat(date)
        with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read(16_000_001))) as archive:
            print(json.dumps(read_shapes(archive,date),separators=(',',':')))
    except (ValueError,KeyError,struct.error,zipfile.BadZipFile,OverflowError,IndexError,RuntimeError):
        sys.exit('Archivo SENAMHI sin geometría y fecha verificadas')
