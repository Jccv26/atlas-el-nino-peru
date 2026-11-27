const noaa='https://www.cpc.ncep.noaa.gov/data/indices/wksst9120.for';
const enfen='https://enfen.imarpe.gob.pe/download/informe-tecnico-el-nino-costero-2017/';
const week=7*86400000;
const formatter=new Intl.DateTimeFormat('es-PE',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'});
const formatDate=date=>formatter.format(new Date(date));
const degrees=v=>(v>0?'+':'')+v.toLocaleString('es-ES',{minimumFractionDigits:1,maximumFractionDigits:1})+' °C';
const svgNS='http://www.w3.org/2000/svg';
function graph(row,bottom,top) {
  const make=(tag,attrs)=>{
    const el=document.createElementNS(svgNS,tag);
    for (const [k,v] of Object.entries(attrs)) el.setAttribute(k,v);
    return el;
  };
  const chart=make('svg',{viewBox:'0 0 284 54',height:54,width:'100%','aria-hidden':'true',preserveAspectRatio:'none'});
  const x=i=>3+278*i/Math.max(1,row.anomalies.length-1);
  const y=v=>49-44*(v-bottom)/(top-bottom);
  const points=row.anomalies.map((v,i)=>x(i).toFixed(2)+','+y(v).toFixed(2));
  chart.append(make('line',{x1:0,y1:y(0),x2:284,y2:y(0),stroke:'currentColor',opacity:'.35','stroke-dasharray':'3 4'}),
    make('polyline',{points:points.join(' '),fill:'none',stroke:'currentColor','stroke-width':2,'stroke-linejoin':'round','vector-effect':'non-scaling-stroke'}));
  const marker=make('circle',{r:3,fill:'currentColor'});
  chart.append(marker);
  return {chart,mark(i){marker.setAttribute('cx',x(i)); marker.setAttribute('cy',y(row.anomalies[i]));}};
}

export function mostrarHistoria({weekly,node,link,dialog}) {
  const cited=link('Consultar la serie semanal de NOAA ↗',noaa);
  if (!Array.isArray(weekly?.comparison) || !weekly.comparison.length || weekly.sourceUrl!==noaa) {
    dialog('Perspectiva histórica','El calentamiento frente a la costa',node('p','La serie comparada está pendiente en esta edición.'),cited);
    return;
  }
  const heading=node('p','Cada curva muestra cuánto se apartó la temperatura superficial del mar en Niño 1+2 del promedio de esa semana entre 1991 y 2020. Las cuatro comparten la escala vertical. El tramo de 2026 llega hasta el '+formatDate(weekly.comparison.at(-1).lastWeek)+'.');
  const rows=node('div','','history-comparison');
  const all=weekly.comparison.flatMap(r=>r.anomalies);
  const bottom=Math.min(-1,Math.floor(Math.min(...all))), top=Math.max(1,Math.ceil(Math.max(...all)));
  for (const row of weekly.comparison) {
    const item=node('section','','history-period');
    const header=node('div','','history-period-head');
    header.append(node('h3',row.label==='2017'?'Niño costero de 2017':row.label),node('strong',degrees(row.peak.anomaly)));
    const reportDate=row.peak.dates.map(formatDate).join(' y ');
    const detail=node('p','Máximo semanal · '+reportDate,'history-peak');
    const plot=graph(row,bottom,top);
    const range=node('p',formatDate(row.firstWeek)+' — '+formatDate(row.lastWeek),'history-range');
    const picker=node('details','','history-weeks'); picker.append(node('summary','Consultar por semana'));
    const select=node('select'); select.setAttribute('aria-label','Semana de '+row.label);
    const output=node('output'); output.setAttribute('aria-live','polite');
    row.anomalies.forEach((_v,i)=>{
      const option=node('option',formatDate(Date.parse(row.firstWeek)+week*i));option.value=String(i);select.append(option);
    });
    const peakWeek=(Date.parse(row.peak.date)-Date.parse(row.firstWeek))/week;
    select.value=String(peakWeek);
    const showWeek=()=>{const i=Number(select.value);plot.mark(i);output.textContent=degrees(row.anomalies[i])+' respecto al promedio';};
    select.onchange=showWeek;showWeek();picker.append(select,output);
    item.append(header,detail,plot.chart,range,picker);rows.append(item);
  }
  const note=node('p','Los periodos de 1982–83 y 1997–98 abarcan los dos años calendario. Para 2017 se usa el intervalo de diciembre de 2016 a mayo de 2017 documentado por ENFEN. Las lluvias y sus impactos se consultan por localidad en el mapa.');
  const sources=node('div','','history-sources');sources.append(cited,link('Ver informe de ENFEN sobre 2017 ↗',enfen));
  dialog('Perspectiva histórica · NOAA','¿Cuánto se calentó el mar?',heading,rows,note,sources);
}
