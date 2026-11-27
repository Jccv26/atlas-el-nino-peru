import {mkdir, readFile, rename, stat, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {refreshPanorama} from '../lib/panorama.mjs';
import {generateExplanations} from '../lib/explicaciones.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const publicDir = path.resolve(process.env.ATLAS_PUBLIC_DIR || path.join(root, 'public'));
const dataDir = path.join(publicDir, 'data');
const destination = path.join(dataDir, 'panorama.json');
const stateDir = path.resolve(process.env.ATLAS_STATE_DIR || path.join(root, '.estado'));

export async function readJSON(file, fallback = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
export async function save(file, value) {
  await mkdir(path.dirname(file), {recursive:true});
  const tmp = file + '.' + randomUUID() + '.tmp';
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, file);
}
export async function actualizar({force = false, ai = true, bulletin: buildBulletin = true} = {}) {
  const previous = await readJSON(destination, {});
  const snapshot = await refreshPanorama(previous, {force});
  if (buildBulletin && snapshot.sources.some(s => s.kind === 'oficial' && s.status === 'ok')) {
    try {
      const {generateBulletin,apiCreditActive} = await import('../lib/boletines.mjs');
      const useAI = ai && apiCreditActive();
      const bulletin = await generateBulletin({items:snapshot.items, sources:snapshot.sources, stateDir,
        audioDir:path.join(publicDir,'media'), audioBaseUrl:process.env.ATLAS_AUDIO_BASE || 'media/', audio:useAI, useAI});
      if (bulletin) {
        const last = snapshot.bulletin;
        if (!useAI && last?.id === bulletin.id && last.mode === 'seleccion-ia') {
          // Refreshing sources cannot invalidate the already published narration.
          if (last.audioUrl) {
            const match = /^\/?media\/(boletin-\d{4}-\d{2}-\d{2}-(?:07|13|19)\.(?:wav|mp3))$/.exec(last.audioUrl);
            const found = match && await stat(path.join(publicDir,'media',match[1])).catch(()=>null);
            if (!found?.isFile()) {
              delete last.audioUrl;
              delete last.voiceType;
            }
          }
        } else snapshot.bulletin = bulletin;
      }
    } catch { console.error('No se pudo generar esta edición. Se conservan los avisos oficiales.'); }
  }
  // Reuse the public edition locally. A single publisher owns the shared
  // monthly budget for rewriting regional notices.
  snapshot.explanations = await generateExplanations({
    items:snapshot.items,sources:snapshot.sources,previous:previous.explanations,now:snapshot.updatedAt,useAI:false,
  });
  await save(destination, snapshot);
  console.log(JSON.stringify({updatedAt:snapshot.updatedAt, sources:snapshot.sources.map(s=>[s.id,s.status,s.count??0]), bulletin: snapshot.bulletin?.id || null}));
  return snapshot;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await actualizar({force:process.argv.includes('--force'), ai:!process.argv.includes('--sin-ia')});
}
