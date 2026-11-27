const statusText={open:'Abierto',partial:'Cierre parcial',closed:'Cierre total'};
const number=(n,one,many)=>n+' '+(n===1?one:many);
const breakdown=({open,partial,closed})=>[
  number(open,'abierta','abiertas'),number(partial,'con cierre parcial','con cierre parcial'),
  number(closed,'con cierre total','con cierre total'),
].join(' · ');

export function portStatusPanel(source, region, {node,link,dateTime,regionLabel}) {
  const data=source?.portStatus;
  if (!Array.isArray(data?.ports) || !source.lastSuccessAt) return null;
  const ports=region ? data.ports.filter(port=>port.region===region) : data.ports;
  if (!ports.length) return null;
  const details=node('details','','port-panel');
  details.append(node('summary',region ? 'Estado de puertos en '+regionLabel(region) : 'Estado de puertos del Perú'));
  const counts={open:0,partial:0,closed:0};
  for (const port of ports) counts[port.status]++;
  const scope=region ? [...new Set(ports.map(port=>port.area.toLowerCase()))].join(' y ') : 'nacional';
  details.append(node('p',region
    ? 'Ámbito '+scope+' · '+number(ports.length,'instalación identificada','instalaciones identificadas')+' en '+regionLabel(region)+'.'
    : number(ports.length,'instalación','instalaciones')+' en el registro nacional de DICAPI.'));
  if (region) details.append(node('p',breakdown(counts)+'.'));
  else for (const [area,title] of [['Marítimo','Litoral marítimo'],['Fluvial','Puertos fluviales'],['Lacustre','Puertos lacustres'],['Sin clasificar','Ámbito por identificar']]) {
    const group=data.areas?.[area];
    if (group) details.append(node('p',title+' ('+group.total+') · '+breakdown(group)+'.'));
  }
  const delayed=source.status==='stale' || Date.now()-Date.parse(source.lastSuccessAt)>2*3600000;
  details.append(node('p',(delayed ? 'Última lectura disponible' : 'Consulta a DICAPI')+' del '+dateTime(source.lastSuccessAt)+'. Cada resolución indica a qué actividades se aplica el cierre.'));
  if (!region) {
    const unlocated=ports.filter(port=>!port.region).length;
    if (unlocated) details.append(node('p',number(unlocated,'instalación pendiente','instalaciones pendientes')+' de ubicación regional. Puedes encontrar '+(unlocated===1?'su registro':'sus registros')+' en esta lista nacional.'));
  }
  const list=node('div','','port-groups');
  for (const [status,title] of [['closed','Cierres totales'],['partial','Cierres parciales'],['open','Instalaciones abiertas']]) {
    const rows=ports.filter(p=>p.status===status);
    if (!rows.length) continue;
    const category=node('details');
    category.append(node('summary',title+' ('+rows.length+')'));
    const ul=node('ul');
    for (const port of rows) {
      const li=node('li');
      li.append(node('strong',port.name),node('span',port.level+' · '+statusText[status]+' · Capitanía de '+port.captaincy));
      if (port.date) li.append(node('small','Resolución del '+dateTime(port.date)));
      if (port.url) li.append(link('Ver resolución de DICAPI ↗',port.url));
      ul.append(li);
    }
    category.append(ul);list.append(category);
  }
  details.append(list,link('Consultar el registro oficial de DICAPI ↗',source.url));
  return details;
}
