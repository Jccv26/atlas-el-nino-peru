import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {refreshPanorama} from '../lib/panorama.mjs';

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
export async function actualizar({force = false, ai = true} = {}) {
  const previous = await readJSON(destination, {});
  const snapshot = await refreshPanorama(previous, {force});
  if (ai && process.env.OPENAI_API_KEY && snapshot.sources.some(s => s.kind === 'oficial' && s.status === 'ok')) {
    try {
      const {generateBulletin} = await import('../lib/boletines.mjs');
      const bulletin = await generateBulletin({items:snapshot.items, sources:snapshot.sources, stateDir,
        audioDir:path.join(publicDir,'media'), audioBaseUrl:process.env.ATLAS_AUDIO_BASE || 'media/', audio:true});
      if (bulletin) snapshot.bulletin = bulletin;
    } catch { console.error('No se pudo generar esta edición. Se conservan los avisos oficiales.'); }
  }
  await save(destination, snapshot);
  console.log(JSON.stringify({updatedAt:snapshot.updatedAt, sources:snapshot.sources.map(s=>[s.id,s.status,s.count??0]), bulletin: snapshot.bulletin?.id || null}));
  return snapshot;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await actualizar({force:process.argv.includes('--force'), ai:!process.argv.includes('--sin-ia')});
}
