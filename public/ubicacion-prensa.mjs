// Correcciones editoriales comprobadas en la nota original. La URL identifica
// el hecho, incluso en ediciones anteriores que sólo conservaban el titular.
const locations=new Map([
  ["https://elcomercio.pe/lima/sucesos/ante-fuertes-oleajes-municipalidad-de-lima-dispone-restriccion-vehicular-en-la-costa-verde-apuesplan-ultimas-noticia/",
    {sourceId:"el-comercio",region:"Lima Metropolitana",province:"Lima",district:"Miraflores",ubigeo:"150122"}],
]);
export function applyVerifiedPressLocations(edition) {
  for(const record of [...(edition.items || []),...(edition.impacts?.events || [])]) {
    if(record.kind!=="prensa")continue;
    const verified=locations.get(record.url);
    if(!verified || record.sourceId!==verified.sourceId)continue;
    const {region,province,district,ubigeo}=verified;
    Object.assign(record,{region,province,district,ubigeo});
    if(!record.itemId)Object.assign(record,{regions:[region],regionOrigin:"nota-original-prensa",provincesByRegion:{[region]:[province]}});
  }
}
