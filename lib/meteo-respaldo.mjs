import {fetchWeatherSample} from '../public/consulta-meteo.mjs';
import {mergeWeatherRecords} from '../public/avisos-meteorologicos-api.mjs';

function sourceFields(item) {
  const {firstSeenAt,lastChangedAt,version,kind,sourceName,...raw}=item;
  return raw;
}

export function meteorologicalSource(fetchWeb,request=globalThis.fetch) {
  return async (context={})=>{
    const now=+(context.now??new Date());
    try {
      const rows=await fetchWeb(context);
      if(!rows.length && context.previousItems?.some(item=>{
        const end=item.validUntil?.length===10?item.validUntil+'T23:59:59-05:00':item.validUntil;
        return !item.withdrawnAt && !item.supersededBy && Date.parse(end)>=now;
      }))throw Error('El índice meteorológico vacío requiere corroboración');
      return rows;
    } catch(webError) {
      try {
        const {sample}=await fetchWeatherSample(request,now);
        const previous=(context.previousItems||[]).map(sourceFields);
        // A newly announced notice with no verified detail must keep the last
        // central edition pending. Known notices can retain their original copy.
        if(sample.unverified.some(id=>!previous.some(item=>item.id===id)))throw webError;
        const records=mergeWeatherRecords(sample.records,previous,now,sample.unverified);
        if(sample.unverified.length)context.onReading?.({meteoDetailsRetained:sample.unverified.length});
        return records.map(sourceFields);
      } catch {throw webError;}
    }
  };
}
