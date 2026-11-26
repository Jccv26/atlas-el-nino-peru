const coenUrl = 'https://portal.indeci.gob.pe/emergencias/';
const enfenUrl = 'https://enfen.imarpe.gob.pe/';
const senamhiUrl = 'https://www.senamhi.gob.pe/';
const sunassUrl =
  'https://aplicaciones.sunass.gob.pe/Interrupciones/consultaInterrupcion.html';
const marinaUrl = 'https://www.dhn.mil.pe/portal/avisos-especiales';
const months =
  'enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre'.split(
    ' '
  );
const regions =
  'Amazonas|Áncash|Apurímac|Arequipa|Ayacucho|Cajamarca|Callao|Cusco|Huancavelica|Huánuco|Ica|Junín|La Libertad|Lambayeque|Lima|Loreto|Madre de Dios|Moquegua|Pasco|Piura|Puno|San Martín|Tacna|Tumbes|Ucayali'.split(
    '|'
  );
const names = {
  coen: 'COEN · INDECI',
  enfen: 'ENFEN',
  'senamhi-lluvias': 'SENAMHI · Lluvias',
  'senamhi-rios': 'SENAMHI · Ríos',
  'senamhi-meteo': 'SENAMHI · Meteorología',
  'senamhi-quebradas': 'SENAMHI · Quebradas',
  marina: 'Marina · Hidrografía',
  sunass: 'SUNASS',
};
const entities = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  deg: '°',
  ordm: 'º',
  ntilde: 'ñ',
  Ntilde: 'Ñ',
  aacute: 'á',
  eacute: 'é',
  iacute: 'í',
  oacute: 'ó',
  uacute: 'ú',
  Aacute: 'Á',
  Eacute: 'É',
  Iacute: 'Í',
  Oacute: 'Ó',
  Uacute: 'Ú',
  ndash: '–',
  mdash: '—',
};
function decode(s = '') {
  return s.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (literal, code) => {
    if (!code.startsWith('#')) return entities[code] ?? literal;
    const n =
      code[1].toLowerCase() === 'x'
        ? parseInt(code.slice(2), 16)
        : Number(code.slice(1));
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
}
function clean(s = '') {
  return decode(
    s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}
function fold(s = '') {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
function textOf(block, tag) {
  return clean(
    block.match(
      new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i')
    )?.[1]
  );
}
function regionList(s) {
  const words = ' ' + fold(s).replace(/[^a-z]+/g, ' ') + ' ';
  return regions.filter((r) => words.includes(' ' + fold(r) + ' '));
}
function iso(s) {
  const n = Date.parse(s);
  return Number.isFinite(n) ? new Date(n).toISOString() : null;
}
const pad = (n) => String(n).padStart(2, '0');
function dateEs(day, month, year) {
  const numeric =
    months.indexOf(fold(month).replace('setiembre', 'septiembre')) + 1;
  return numeric ? year + '-' + pad(numeric) + '-' + pad(day) : null;
}
function dateTimeLima(s) {
  const m = s.match(
    /\b(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})\b(?:\s+(\d\d:\d\d(?::\d\d)?))?/
  );
  if (!m) return null;
  const date =
    (m[3].length === 2 ? '20' : '') + m[3] + '-' + pad(m[2]) + '-' + pad(m[1]);
  return m[4] ? iso(date + 'T' + m[4] + '-05:00') : date;
}
function classify(title) {
  const t = fold(title);
  if (/quebrada|huaico|huayco|deslizamiento|movimiento en masa/.test(t))
    return 'Quebradas';
  if (/hidrolog|desborde|nivel del rio|caudal|inundacion/.test(t))
    return 'Ríos';
  if (/oleaje|mar de fondo/.test(t)) return 'Oleajes';
  if (/lluvia|precipitacion|granizada|llovizna|tormenta/.test(t))
    return 'Lluvias';
  if (/temperatura|calor|viento|meteorolog|sequia|deficit hidrico/.test(t))
    return 'Meteorología';
  if (/fenomeno el nino|el nino costero/.test(t)) return 'El Niño';
  return null;
}
function item(sourceId, id, title, url, fields = {}) {
  const places = fields.regions ?? regionList(title);
  return {
    id: sourceId + ':' + id,
    sourceId,
    source: names[sourceId],
    title,
    url,
    publishedAt: null,
    category: classify(title) ?? 'Meteorología',
    regions: places,
    region: places.join(', '),
    ...fields,
  };
}
function boundedUrl(raw, base) {
  try {
    const value = new URL(decode(raw), base);
    return value.origin === new URL(base).origin ? value.href : null;
  } catch {
    return null;
  }
}
async function read(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      'User-Agent': 'PeruAlDia/0.1 (pilot; public climate bulletins)',
      Accept: '*/*',
      ...opts.headers,
    },
    signal: AbortSignal.timeout(28000),
  });
  if (!res.ok) throw new Error('Fuente oficial: HTTP ' + res.status);
  const max = 6_000_000;
  if (Number(res.headers.get('content-length')) > max)
    throw new Error('Respuesta excede límite de lectura');
  const reader = res.body.getReader(),
    parts = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > max) {
        await reader.cancel();
        throw new Error('Respuesta excede límite de lectura');
      }
      parts.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buf = new Uint8Array(bytes);
  let at = 0;
  for (const p of parts) {
    buf.set(p, at);
    at += p.byteLength;
  }
  const charset =
    /charset\s*=\s*([\w-]+)/i.exec(
      res.headers.get('content-type') ?? ''
    )?.[1] ?? 'utf-8';
  return { body: new TextDecoder(charset).decode(buf), headers: res.headers };
}
function rss(xml, sourceId, base) {
  if (!/<rss\b/i.test(xml) || !/<channel>/i.test(xml))
    throw new Error('Formato RSS inesperado');
  const result = [];
  for (const [, block] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = textOf(block, 'title');
    const url = boundedUrl(textOf(block, 'link'), base);
    if (!url || !title) continue;
    if (sourceId === 'coen' && !classify(title)) continue;
    if (sourceId === 'enfen' && !/comunicado oficial/i.test(title)) continue;
    const raw =
      block.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]>/i)?.[1] ?? '';
    const summary = sourceId === 'enfen' ? textOf(raw, 'p') : '';
    result.push(
      item(sourceId, url, title, url, {
        publishedAt: iso(textOf(block, 'pubDate')),
        category: sourceId === 'enfen' ? 'El Niño' : classify(title),
        summary,
      })
    );
  }
  return result;
}
function archiveItems(html) {
  if (!/Emergencias COEN|Reportes y Emergencias encontradas/i.test(html))
    throw new Error('Archivo de COEN no reconocible');
  const out = new Map();
  for (const [, href, raw] of html.matchAll(
    /<a\s+href="([^"]*\/emergencias\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  )) {
    const title = clean(raw),
      category = classify(title);
    const url = boundedUrl(href, coenUrl);
    if (!url || !category || !/REPORTE|BOLET[IÍ]N|INFORME/i.test(title))
      continue;
    const date = title.match(/\d{2}[/-]\d{2}[/-]20\d{2}/)?.[0],
      hour = title.match(/\b(\d{2}:\d{2})\s*HORAS/i)?.[1];
    out.set(
      url,
      item('coen', url, title, url, {
        publishedAt: date
          ? dateTimeLima(date + (hour ? ' ' + hour : ''))
          : null,
        category,
      })
    );
  }
  return [...out.values()];
}
async function coen() {
  const [feed, archive] = await Promise.allSettled([
    read(coenUrl + 'feed/').then((r) => rss(r.body, 'coen', coenUrl)),
    read(coenUrl).then((r) => archiveItems(r.body)),
  ]);
  if (feed.status === 'rejected' && archive.status === 'rejected')
    throw new Error('RSS y archivo COEN no disponibles');
  const unique = new Map();
  for (const result of [archive, feed])
    if (result.status === 'fulfilled')
      for (const record of result.value) unique.set(record.url, record);
  return [...unique.values()];
}
function cells(row) {
  return [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
    clean(m[1])
  );
}
function tableRows(html) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => m[1]);
}
async function senamhiTable(kind, path) {
  const { body } = await read(senamhiUrl + '?p=' + path);
  const hydro = kind === 'senamhi-rios';
  const table = [...body.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)]
    .map((m) => m[1])
    .find(
      (t) => /<th[^>]*>Aviso<\/th>/i.test(t) && /<th[^>]*>Nivel<\/th>/i.test(t)
    );
  if (!table) throw new Error('Tabla SENAMHI no disponible');
  const out = [];
  for (const row of tableRows(table)) {
    const c = cells(row);
    if (c.length < (hydro ? 6 : 7)) continue;
    const url = boundedUrl(row.match(/href="([^"]+)"/)?.[1], senamhiUrl);
    if (!url || !row.includes('href=')) continue;
    const n = c[1].match(/^\d+/)?.[0];
    if (!n) continue;
    const validFrom = c[hydro ? 2 : 3],
      validUntil = c[hydro ? 3 : 4];
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(validFrom) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)
    )
      continue;
    const status = c[1].match(/\(([^)]+)\)/)?.[1] ?? '';
    if (out.length >= 100) break;
    if (
      validUntil <
      new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10)
    )
      continue;
    out.push(
      item(kind, validFrom.slice(0, 4) + '-' + n, c[0], url, {
        publishedAt: hydro ? null : c[2],
        validFrom,
        validUntil,
        datePrecision: 'day',
        sourceStatus: status,
        level: c.at(-1),
        category: hydro ? 'Ríos' : (classify(c[0]) ?? 'Meteorología'),
        noticeNumber: n,
      })
    );
  }
  // Follow a bounded number of current bulletins; the detail pages have authoritative
  // local times and locations that are absent from the national summary table.
  const selected = out
    .filter(
      (record) =>
        record.sourceStatus === 'vigente' || record.sourceStatus === 'emitido'
    )
    .slice(0, 4);
  await Promise.all(
    selected.map(async (record) => {
      try {
        const { body: detail } = await read(record.url);
        const block = hydro
          ? detail.match(
              /id="nav-avisodet"[^>]*>([\s\S]*?)<div class="col-12 col-md-9/i
            )?.[1]
          : detail
              .split(/<h2 class="desaparecerHR"/i)
              .findLast(
                (part) =>
                  clean(part.slice(0, 140)).match(/Aviso N°\s*(\d+)/i)?.[1] ===
                  record.noticeNumber
              )
              ?.split(/<\/article>/i)[0].slice(0, 24_000);
        if (!block) return;
        const readable = clean(block);
        const captureDate = (label) => {
          const match = readable.match(
            new RegExp(
              label +
                ':?\\s*[^,]{1,15},?\\s*(\\d{1,2}) de (\\w+) de (20\\d{2})\\s*(?:-|a las)\\s*(\\d{2}:\\d{2})',
              'i'
            )
          );
          return match
            ? iso(
                dateEs(match[1], match[2], match[3]) + 'T' + match[4] + '-05:00'
              )
            : null;
        };
        const start = captureDate(
          hydro ? 'Fecha de inicio' : 'Inicio del evento'
        );
        const end = captureDate(hydro ? 'Fecha de final' : 'Fin del evento');
        if (start && end)
          Object.assign(record, {
            validFrom: start,
            validUntil: end,
            datePrecision: 'minute',
          });
        record.publishedAt =
          captureDate('Fecha de emisión') ?? record.publishedAt;
        const paragraphs = [
          ...block.matchAll(/<p align="justify"[^>]*>([\s\S]*?)<\/p>/gi),
        ]
          .map((m) => clean(m[1]))
          .filter(Boolean);
        const meteoLead = clean(
          block.match(/<div class="col-lg-12 col-md-12 col-sm-12 col-xs-12">\s*((?:El )?SENAMHI informa[\s\S]*?)<\/div>/i)?.[1]
        );
        const narrative = hydro ? paragraphs[0] : meteoLead || paragraphs[0];
        if (narrative) {
          const locality = hydro
            ? narrative.match(
                /en el departamento (?:de )?([^.;]{2,32})[.;]/i
              )?.[1]
            : narrative;
          if (locality) {
            record.regions = regionList(locality);
            record.region = record.regions.join(', ');
          }
          record.summary = narrative;
        }
      } catch {
        /* Keep the bulletin index if a detail page is unavailable. */
      }
    })
  );
  return out;
}
async function dailyNotice(kind, path) {
  const { body } = await read(senamhiUrl + '?p=' + path);
  const notice = clean(
    body.match(/<h2 class="desaparecerHR"[^>]*>([\s\S]*?)<\/h2>/i)?.[1]
  );
  const number = notice.match(/(\d+)\s*-\s*(20\d{2})/),
    title = clean(
      body.match(/<h1 class="aviso-vigente"[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    );
  const when = clean(
    body.match(/Fecha de inicio:<\/strong>([\s\S]*?)<\/div>/i)?.[1]
  ).match(/(\d{1,2}) (\w+) (20\d{2})\s*-\s*(\d{2}:\d{2})/);
  const duration = Number(
    clean(
      body.match(/Duraci(?:ó|&oacute;)n:<\/strong>([\s\S]*?)<\/div>/i)?.[1]
    ).match(/(\d+)\s*hrs/i)?.[1]
  );
  if (!title || !number || !when || !duration)
    throw new Error('Aviso de lluvia incompleto');
  const date = dateEs(when[1], when[2], when[3]),
    start = iso(date + 'T' + when[4] + '-05:00');
  if (!start) throw new Error('Fecha de lluvia inválida');
  const summary = [
    ...body.matchAll(
      /<p align="justify">\s*<b class="text-dark">([\s\S]*?)<\/p>/gi
    ),
  ]
    .map((m) => clean(m[1]))
    .join(' ');
  const rain = kind === 'senamhi-lluvias';
  const link =
    senamhiUrl +
    '?p=' +
    path +
    (rain ? '&f=' + date.split('-').reverse().join('-') : '');
  return [
    item(kind, number[2] + '-' + number[1], title, link, {
      validFrom: start,
      validUntil: new Date(
        Date.parse(start) + duration * 3600000
      ).toISOString(),
      noticeNumber: number[1],
      level: notice.match(/NIVEL (\w+)/i)?.[1] ?? '',
      summary,
      category: rain ? 'Lluvias' : 'Quebradas',
      regions: regionList(summary),
    }),
  ];
}
async function marina() {
  const { body } = await read(marinaUrl);
  if (!body.includes('accordion-title'))
    throw new Error('Archivo de Marina no disponible');
  const out = [];
  for (const block of body
    .split(/<div class="accordion-header-links">/i)
    .slice(1)) {
    const title = clean(
      block.match(
        /class="accordion-title">\s*<span[^>]*>([\s\S]*?)<\/span>/i
      )?.[1]
    );
    if (!/aviso especial de oleaje/i.test(title)) continue;
    const href = block.match(/href="([^"]*\/pdf-aviso-especial\/\d+)"/)?.[1];
    const url = href && boundedUrl(href, marinaUrl);
    if (!url) continue;
    const dd = clean(block).match(
      /Callao,?\s*(\d{1,2})\s+de\s+(\w+)\s+(?:del?\s+)?(20\d{2})/i
    );
    const period = title.match(
      /del\s+(\d{1,2})(?:\s+de\s+(\w+))?\s+al\s+(\d{1,2})\s+de\s+(\w+)\s+(?:del?\s+)?(20\d{2})/i
    );
    const validUntil = period ? dateEs(period[3], period[4], period[5]) : null;
    let validFrom = period
      ? dateEs(period[1], period[2] ?? period[4], period[5])
      : null;
    if (validFrom && validUntil && validFrom > validUntil)
      validFrom = dateEs(period[1], period[2], Number(period[5]) - 1);
    out.push(
      item('marina', url, title, url, {
        publishedAt: dd ? dateEs(dd[1], dd[2], dd[3]) : null,
        validFrom,
        validUntil,
        datePrecision: 'day',
        category: 'Oleajes',
        summary: textOf(block, 'h4'),
      })
    );
    if (out.length >= 3) break;
  }
  if (!out.length) throw new Error('No se reconocieron boletines de oleaje');
  return out;
}
const limaDMY = new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
async function sunass() {
  const result = [];
  const { headers } = await read(sunassUrl);
  const cookie = (headers.getSetCookie?.() ?? [])
    .map((v) => v.split(';')[0])
    .join('; ');
  const params = new URLSearchParams({
    pagina: '1',
    limite: '100',
    txtFilter: '',
    odBusqueda: '-1',
    epsBusqueda: '-1',
    sedeBusqueda: '-1',
    estadoBusqueda: '-1',
    tipoInterrupcionBusqueda: '-1',
    tipoServicioBusqueda: '-1',
    fechaRegistroDesde: limaDMY.format(Date.now() - 86400000),
    fechaRegistroHasta: limaDMY.format(Date.now()),
    fechaInicioDesde: '',
    fechaInicioHasta: '',
  });
  const seen = new Set();
  for (let page = 1; page <= 12; page++) {
    params.set('pagina', String(page));
    const { body } = await read(new URL('buscarInterrupcion.html', sunassUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: sunassUrl,
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: params.toString(),
    });
    const table = body.match(
      /<table\b[^>]*id="dataTables-Interrupcion"[^>]*>([\s\S]*?)<\/table>/i
    )?.[1];
    if (!table) throw new Error('Resultado SUNASS no reconocible');
    const records = tableRows(table)
      .map(cells)
      .filter((c) => c.length >= 15 && /^\d+$/.test(c[1]));
    for (const c of records) {
      if (seen.has(c[1])) throw new Error('Paginación SUNASS no avanza');
      seen.add(c[1]);
      const human = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
      const start = dateTimeLima(c[9]),
        expected = dateTimeLima(c[10]);
      const places = regionList(c[3]);
      result.push(
        item(
          'sunass',
          c[1],
          human(c[13]) + ' · ' + human(c[5]) + ' (' + c[4] + ')',
          sunassUrl,
          {
            publishedAt: dateTimeLima(c[7]),
            updatedAt: dateTimeLima(c[8]),
            validFrom: start,
            expectedRestorationAt: expected,
            category: 'Agua',
            regions: places,
            locality: human(c[5]),
            noticeNumber: c[1],
            sourceStatus: c[6],
            summary:
              'Registro ' +
              c[1] +
              '. Interrupción ' +
              c[12].toLowerCase() +
              ' de ' +
              c[13].toLowerCase() +
              '. Motivo comunicado: ' +
              c[14].toLowerCase() +
              '.',
          }
        )
      );
    }
    if (records.length < 100) return result;
  }
  throw new Error('La consulta SUNASS supera las páginas de este ciclo');
}
function source(id, name, url, intervalMinutes, fetchItems, description) {
  return { id, name, url, intervalMinutes, fetchItems, description };
}
export const officialSources = [
  source(
    'coen',
    names.coen,
    coenUrl,
    5,
    coen,
    'Reportes y boletines hidrometeorológicos del COEN.'
  ),
  source(
    'enfen',
    names.enfen,
    enfenUrl + 'comunicados/',
    180,
    async () => rss((await read(enfenUrl + 'feed/')).body, 'enfen', enfenUrl),
    'Perspectiva oficial del fenómeno.'
  ),
  source(
    'senamhi-lluvias',
    names['senamhi-lluvias'],
    senamhiUrl + '?p=aviso-24H',
    15,
    () => dailyNotice('senamhi-lluvias', 'aviso-24H'),
    'Avisos de lluvias a corto plazo.'
  ),
  source(
    'senamhi-rios',
    names['senamhi-rios'],
    senamhiUrl + '?p=avisos-hidrologicos',
    15,
    () => senamhiTable('senamhi-rios', 'avisos-hidrologicos'),
    'Número, estación, vigencia y nivel del aviso.'
  ),
  source(
    'senamhi-meteo',
    names['senamhi-meteo'],
    senamhiUrl + '?p=aviso-meteorologico',
    15,
    () => senamhiTable('senamhi-meteo', 'aviso-meteorologico'),
    'Avisos oficiales de varios días.'
  ),
  source(
    'marina',
    names.marina,
    marinaUrl,
    30,
    marina,
    'Avisos de oleaje de la Dirección de Hidrografía y Navegación.'
  ),
  source(
    'sunass',
    names.sunass,
    sunassUrl,
    30,
    sunass,
    'Interrupciones comunicadas por las empresas prestadoras. La reposición prevista puede cambiar.'
  ),
  source(
    'senamhi-quebradas',
    names['senamhi-quebradas'],
    senamhiUrl + '?p=aviso-activacion-quebrada',
    15,
    () => dailyNotice('senamhi-quebradas', 'aviso-activacion-quebrada'),
    'Aviso oficial de posible activación de quebradas a corto plazo.'
  ),
  source(
    'senamhi-muy-corto',
    'SENAMHI · Muy corto plazo',
    senamhiUrl + '?p=reportes-nowcasting',
    null,
    null,
    'Análisis y pronósticos de una y dos horas. Verifique la hora de la observación en el visor.'
  ),
  source(
    'sutran',
    'SUTRAN',
    'https://alertasviales.sutran.gob.pe/',
    null,
    null,
    'Consulta oficial de la red vial nacional.'
  ),
  source(
    'dicapi',
    'DICAPI',
    'https://www.dicapi.mil.pe/estado-de-puertos',
    null,
    null,
    'Estado de puertos según la autoridad marítima.'
  ),
];
