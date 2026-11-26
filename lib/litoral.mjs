// DHN's forecast boundaries are landmarks on the mainland coast. A region
// may meet two different forecasts on either side of the same port.
const points = ['tumbes', 'salaverry', 'chancay', 'san juan de marcona', 'tacna'];
const segments = [
  { zone: 'litoral norte', regions: ['Tumbes', 'Piura', 'Lambayeque', 'La Libertad'] },
  { zone: 'litoral centro', regions: ['La Libertad', 'Áncash', 'Lima'] },
  { zone: 'litoral centro', regions: ['Lima', 'Lima Metropolitana', 'Callao', 'Ica'] },
  { zone: 'litoral sur', regions: ['Ica', 'Arequipa', 'Moquegua', 'Tacna'] },
];
const mappingSource = {
  name: 'INEI · cartografía departamental y provincial',
  url: 'https://ide.inei.gob.pe/',
  note: 'El atlas identifica qué jurisdicciones tienen litoral dentro del tramo descrito por Hidrografía. Lima corresponde a Lima Provincias; Lima Metropolitana, a la provincia de Lima. El Callao tiene jurisdicción propia.',
  references: [
    {
      name: 'Ositrán · Salaverry, provincia de Trujillo, La Libertad',
      url: 'https://www.ositran.gob.pe/puertos/terminal-portuario-multiproposito-de-salaverry/',
    },
    {
      name: 'FONDEPES · jurisdicciones marítimas de las capitanías',
      url: 'https://www.gob.pe/institucion/fondepes/noticias/945928-capitanias-de-puerto-cuales-son-y-donde-se-ubican',
    },
    {
      name: 'SUNAT · Salaverry en La Libertad y Chancay en Huaral, Lima',
      url: 'https://www.sunat.gob.pe/institucional/quienessomos/dependenciasoficinas_ad.html',
    },
    {
      name: 'INEI · mapa provincial de la región Lima',
      url: 'https://www.inei.gob.pe/media/MenuRecursivo/publicaciones_digitales/Est/Lib1541/tomo4.pdf',
    },
    {
      name: 'Municipalidad de Virú · litoral de La Libertad al sur de Salaverry',
      url: 'https://www.gob.pe/institucion/muniviru/normas-legales/5607249-025-2008-mpv',
    },
    {
      name: 'ProInversión · San Juan de Marcona en Nasca, Ica',
      url: 'https://www.gob.pe/institucion/proinversion/noticias/925401-comunicado-proinversion',
    },
    {
      name: 'SERNANP · circuito de playas de Marcona al sur de Punta San Juan',
      url: 'https://visitaareasnaturales.sernanp.gob.pe/wp-content/uploads/2022/01/RNIIPG_San-Fernando-y-San-Juan_compressed_compressed.pdf',
    },
  ],
};
const normalize = (text) =>
  String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
const pointPattern = '(' + points.join('|') + ')';
const rangePattern = new RegExp(
  '^(?:zona )?(?:(?:al sur de|desde|de) )?' +
    pointPattern +
    ' (?:hasta|a) (?:la zona de )?' +
    pointPattern +
    '$',
);

function matchRange(label, zone) {
  const pair = rangePattern.exec(normalize(label));
  if (!pair) return null;
  const start = points.indexOf(pair[1]),
    end = points.indexOf(pair[2]);
  if (start >= end || !segments.slice(start, end).every((s) => s.zone === zone)) return null;
  return { start, end };
}

// A condition with its own geographical qualifier must never be applied
// to the whole parent section. Unrecognized prose remains in coastalScope.
function unqualified(condition) {
  const text = normalize(condition);
  if (
    !/^(?:persiste[n]?|se|continua[n]?|continuara[n]?|oleajes?|condiciones|disminuye|incrementa|ligero|moderado|fuerte|normal)\b/.test(
      text,
    )
  )
    return false;
  if (
    /\b(?:tramos?|sectores?|excepto|salvo|exceptuando|solo|unicamente|solamente|zonas?|litoral|caletas?|playas?|bahias?|puertos?|puntas?|cabo|frente a|al (?:sur|norte) de)\b/.test(
      text,
    )
  )
    return false;
  const time =
    /^(?:(?:el|la|los|las)\s+)?(?:primeras? horas?|mism[oa]s? (?:dia|noche)|madrugada|tarde|manana|noche|medianoche|mediodia|horas?|dias?|mediados|fines|inicios|lunes|martes|miercoles|jueves|viernes|sabado|domingo|\d{1,2}\b)/;
  for (const qualifier of text.matchAll(/\b(?:desde|hasta|entre|a partir de|en)\s+/g)) {
    const tail = text.slice(qualifier.index + qualifier[0].length);
    if (!time.test(tail) && !/^direccion (?:hacia|al)\b/.test(tail)) return false;
  }
  return !points.some((place) => text.includes(place));
}

export function agregarCoberturaLitoral(item) {
  const byRegion = {};
  if (item?.sourceId === 'marina' && Array.isArray(item.coastalScope)) {
    for (const section of item.coastalScope) {
      const zone = normalize(section?.zone);
      const parent = matchRange(section?.stretch, zone);
      if (!parent || !Array.isArray(section.conditions)) continue;
      for (const raw of section.conditions) {
        if (typeof raw !== 'string' || !raw.trim()) continue;
        const colon = raw.search(/(?<!\d):|:(?!\d)/);
        const stretch = (colon < 0 ? section.stretch : raw.slice(0, colon)).trim();
        const condition = (colon < 0 ? raw : raw.slice(colon + 1)).trim();
        const range = colon < 0 ? parent : matchRange(stretch, zone);
        if (
          !range ||
          range.start < parent.start ||
          range.end > parent.end ||
          !condition ||
          !unqualified(condition)
        )
          continue;
        const regions = new Set(segments.slice(range.start, range.end).flatMap((s) => s.regions));
        for (const region of regions) {
          const entries = (byRegion[region] ??= []);
          let entry = entries.find((e) => e.zone === section.zone && e.stretch === stretch);
          if (!entry) {
            entry = { zone: section.zone, stretch, conditions: [] };
            entries.push(entry);
          }
          if (!entry.conditions.includes(condition)) entry.conditions.push(condition);
        }
      }
    }
  }
  const coastalRegions = Object.keys(byRegion);
  return {
    coastalRegions,
    coastalByRegion: byRegion,
    coastalMappingSource: coastalRegions.length ? mappingSource : null,
  };
}
