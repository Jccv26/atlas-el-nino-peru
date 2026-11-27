export const isRiverNotice=item=>item.sourceId==="senamhi-rios" || item.originNotice?.sourceId==="senamhi-rios";
const number=new Intl.NumberFormat("es-ES",{maximumFractionDigits:6,useGrouping:false});
export function stationReading(item) {
  if(!isRiverNotice(item) || !item.stationName || !Number.isFinite(Date.parse(item.observedAt)))return null;
  const data=item.riverMeasurement;
  const measured=data && Number.isFinite(data.value) &&
    (data.kind==="nivel" && ["m","m s. n. m."].includes(data.unit) || data.kind==="caudal" && data.unit==="m³/s");
  return {name:item.stationName,at:item.observedAt,
    metric:measured ? data.kind : item.title?.match(/\b(caudal|nivel)\b/i)?.[1]?.toLowerCase(),
    value:measured ? number.format(data.value)+" "+data.unit : ""};
}
export function riverValidity(item,now) {
  const start=Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(item.validFrom)?item.validFrom+"T00:00:00-05:00":item.validFrom);
  const end=Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(item.validUntil)?item.validUntil+"T23:59:59.999-05:00":item.validUntil);
  if(item.supersededBy)return "actualizado";
  if(item.withdrawnAt)return "retirado";
  if(item.invalidValidity || start>end)return "sinconfirmar";
  if(start>now)return "proximo";
  if(end<=now)return "finalizado";
  if(start<=now && end>now)return "vigente";
  if(item.phisisListedAt && !item.validUntil) {
    const age=now-Date.parse(item.phisisListedAt);
    return age>=0 && age<=2*3600000 ? "listado" : "sinconfirmar";
  }
  return "publicado";
}
