// Publisher for a GitHub-hosted, serialized workflow. The data-only branch is
// never executed. Only a verified allowlist of regular files is restored.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, readdir, stat, utimes, rm, rename } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { fetchOcean } from '../public/atlas/oceano.mjs';
import { fetchTemperature, isTemperatureSnapshot } from '../lib/temperatura.mjs';
import { apiCreditActive, generateBulletin } from '../lib/boletines.mjs';
import { refreshPanorama } from '../lib/panorama.mjs';
import { verificarPublico } from './verificar-publico.mjs';

const dayMs = 86400000;
const ledgerName = '.atlas-reservas.v1';
const metaName = 'edicion.json';
const temperatureFile = 'public/data/temperatura.json';
const baseFiles = ['public/data/panorama.json', 'public/atlas/oceano.json', temperatureFile];
const audioName = /^boletin-(\d{4}-\d{2}-\d{2})-(07|13|19)\.(?:wav|mp3)$/;
const relativeState =
  /^boletines\/(\d{4}-\d{2}-\d{2})-(07|13|19)\/(?:(?:text|fuentes)\.json|(?:texto|voz)-[12]\.reserved)$/;
const limaDay = (stamp) => new Date(stamp - 5 * 3600000).toISOString().slice(0, 10);
const signature = 'atlas-el-nino-peru/v1';

function allowedPath(p) {
  return (
    p === metaName ||
    p === ledgerName ||
    baseFiles.includes(p) ||
    (p.startsWith('public/media/') && audioName.test(p.slice('public/media/'.length)))
  );
}
function git(dir, args, token) {
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'C', GIT_TERMINAL_PROMPT: '0' };
  if (token) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader';
    env.GIT_CONFIG_VALUE_0 =
      'Authorization: Basic ' + Buffer.from('x-access-token:' + token).toString('base64');
  }
  const result = spawnSync('git', args, {
    cwd: dir,
    env,
    encoding: 'utf8',
    maxBuffer: 12_000_000,
    timeout: 85000,
  });
  if (result.status !== 0)
    throw new Error(
      'Falló git ' + args[0] + '. Revisar acceso de Actions a contents y el estado de la rama ediciones.',
    );
  return result.stdout.trim();
}
async function optionalFile(file) {
  try {
    return await readFile(file);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}
function savedTemperature(data) {
  if (!data) return null;
  try {
    const report = JSON.parse(data);
    return isTemperatureSnapshot(report) ? report : null;
  } catch { return null; }
}
async function copy(from, to) {
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}
async function files(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
}
function parseKey(raw) {
  if (!raw) return null;
  const k = Buffer.from(raw.trim(), 'base64');
  return k.length === 32 && k.toString('base64') === raw.trim() ? k : null;
}
function seal(data, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(signature));
  const payload = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from('ATL1'), iv, cipher.getAuthTag(), payload]);
}
function unseal(blob, key) {
  if (blob.length < 33 || blob.length > 3_000_000 || blob.subarray(0, 4).toString() !== 'ATL1')
    throw new Error('Estado cifrado inválido');
  const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(4, 16));
  decipher.setAAD(Buffer.from(signature));
  decipher.setAuthTag(blob.subarray(16, 32));
  const data = JSON.parse(Buffer.concat([decipher.update(blob.subarray(32)), decipher.final()]).toString());
  if (
    data.v !== 1 ||
    typeof data.files !== 'object' ||
    !data.files ||
    typeof data.grants !== 'object' ||
    !data.grants
  )
    throw new Error('Versión de reservas desconocida');
  return data;
}
async function restoreState(dir, state) {
  for (const [relative, record] of Object.entries(state.files)) {
    if (
      !relativeState.test(relative) ||
      typeof record.data !== 'string' ||
      record.data.length > 25000 ||
      !Number.isFinite(record.mtime)
    )
      throw new Error('Reserva inválida');
    const target = join(dir, relative);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, Buffer.from(record.data, 'base64'), { mode: 0o600 });
    const when = new Date(record.mtime);
    await utimes(target, when, when);
  }
}
async function collectState(dir, grants, now) {
  const entries = {};
  const cutoff = limaDay(now - 62 * dayMs);
  for (const edition of await files(join(dir, 'boletines'))) {
    if (
      !edition.isDirectory() ||
      edition.name.slice(0, 10) < cutoff ||
      !/^\d{4}-\d\d-\d\d-(07|13|19)$/.test(edition.name)
    )
      continue;
    for (const file of await files(join(dir, 'boletines', edition.name))) {
      const relative = 'boletines/' + edition.name + '/' + file.name;
      if (!file.isFile() || !relativeState.test(relative)) continue;
      const data = await readFile(join(dir, relative));
      const details = await stat(join(dir, relative));
      if (data.length > 18000) throw new Error('Estado no permitido por tamaño');
      entries[relative] = { data: data.toString('base64'), mtime: details.mtimeMs };
    }
  }
  return {
    v: 1,
    files: entries,
    grants: Object.fromEntries(Object.entries(grants).filter(([k]) => k.slice(0, 10) >= cutoff)),
  };
}
function slotAt(now) {
  const lima = new Date(now - 5 * 3600000),
    h = lima.getUTCHours();
  return h < 7 ? null : lima.toISOString().slice(0, 10) + '-' + (h < 13 ? '07' : h < 19 ? '13' : '19');
}
function validateBranchTree(dir) {
  for (const row of git(dir, ['ls-tree', '-r', 'FETCH_HEAD']).split('\n')) {
    const [attrs, p] = row.split('\t');
    if (!p || !attrs.startsWith('100644 blob ') || !allowedPath(p))
      throw new Error(
        'La rama ediciones contiene archivos no gestionados por el atlas. Se conservó sin cambios.',
      );
  }
}
function commit(dir, message, token) {
  git(dir, ['add', '--all', '--', '.']);
  if (!git(dir, ['status', '--porcelain'])) return;
  git(dir, [
    '-c',
    'user.name=atlas-publicador',
    '-c',
    'user.email=41898282+github-actions[bot]@users.noreply.github.com',
    'commit',
    '--quiet',
    '-m',
    message,
  ]);
  // A concurrent or external change causes a normal non-fast-forward rejection.
  git(dir, ['push', '--quiet', 'origin', 'HEAD:refs/heads/ediciones'], token);
}
async function seedCurrentSlot(stateDir, panorama) {
  const b = panorama?.bulletin;
  if (!b || !/^\d{4}-\d{2}-\d{2}-(07|13|19)$/.test(b.id)) return;
  const dir = join(stateDir, 'boletines', b.id);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const { audioUrl, voiceType, ...record } = b;
  const filename = record.mode === 'fuentes' ? 'fuentes.json' : 'text.json';
  await writeFile(join(dir, filename), JSON.stringify(record), { mode: 0o600 });
}
// Choose observations by their successful read, and independently retain the
// newest actual attempt (which may have failed after that read on another host).
export function mergePanorama(seed, published, now = Date.now()) {
  if (!seed || ![1,2].includes(seed.schemaVersion) || ![1,2].includes(published?.schemaVersion) ||
      !Array.isArray(seed.sources) || !Array.isArray(seed.items) ||
      !Array.isArray(published.sources) || !Array.isArray(published.items)) return published;
  const sources = new Map(published.sources.map(s => [s.id,s]));
  const replacements = new Map();
  let checkedThrough = Date.parse(published.updatedAt);
  if (!Number.isFinite(checkedThrough)) return published;
  let schemaVersion = published.schemaVersion;
  for (const s of seed.sources) {
    const success = Date.parse(s.lastSuccessAt), checked = Date.parse(s.checkedAt);
    if (!['ok','stale'].includes(s.status) || !Number.isFinite(success) || !Number.isFinite(checked) ||
        success > checked || checked > now || (s.status === 'ok' && success !== checked)) continue;
    const records = seed.items.filter(i => i.sourceId === s.id);
    if (records.length !== s.count || records.some(i => !i.id) ||
        new Set(records.map(i => i.id)).size !== records.length) continue;
    const existing = sources.get(s.id);
    const oldSuccess = Date.parse(existing?.lastSuccessAt), oldCheck = Date.parse(existing?.checkedAt);
    const useSeed = !Number.isFinite(oldSuccess) || success > oldSuccess;
    if (!useSeed && !(checked > oldCheck)) continue;
    const data = useSeed ? s : existing;
    const attempt = !Number.isFinite(oldCheck) || checked > oldCheck ? s : existing;
    // A failed reading is stale as soon as either host has a successful copy.
    const merged = {...data, checkedAt:attempt.checkedAt, status:attempt.status === 'ok' ? 'ok' : 'stale'};
    delete merged.errorCode;
    if (merged.status === 'stale' && attempt.errorCode) merged.errorCode = attempt.errorCode;
    sources.set(s.id,merged);
    checkedThrough = Math.max(checkedThrough,Date.parse(merged.checkedAt));
    if (useSeed) {
      replacements.set(s.id,records);
      schemaVersion = Math.min(schemaVersion,seed.schemaVersion);
    }
  }
  return {...published,schemaVersion,updatedAt:new Date(checkedThrough).toISOString(),sources:[...sources.values()],
    items:[...published.items.filter(i=>!replacements.has(i.sourceId)),...[...replacements.values()].flat()]};
}

async function mirrorPublic(root, cache, now, restore, seed = null) {
  // A first runner may have reserved an edition and stopped before validating
  // the first snapshot. In that case use the public assets checked into main.
  if (restore && !(await optionalFile(join(cache, baseFiles[0])))) return;
  const source = restore ? cache : root,
    target = restore ? root : cache;
  for (const relative of baseFiles) {
    const data = await optionalFile(join(source, relative));
    if (!data) continue;
    if (restore && seed && relative === baseFiles[0]) {
      await writeFile(join(target,relative),JSON.stringify(mergePanorama(seed,JSON.parse(data),now)));
      continue;
    }
    if (relative === temperatureFile && !savedTemperature(data)) continue;
    await copy(join(source, relative), join(target, relative));
  }
  const folder = 'public/media';
  await mkdir(join(target, folder), { recursive: true });
  const cutoff = limaDay(now - 2 * dayMs);
  const keep = new Set();
  for (const f of await files(join(source, folder))) {
    const match = audioName.exec(f.name);
    if (!f.isFile() || !match || match[1] < cutoff) continue;
    keep.add(f.name);
    await copy(join(source, folder, f.name), join(target, folder, f.name));
  }
  for (const f of await files(join(target, folder))) {
    if (f.isFile() && audioName.test(f.name) && !keep.has(f.name)) await rm(join(target, folder, f.name));
  }
}
async function verifyPublic(root) {
  const { issues } = await verificarPublico(join(root, 'public'));
  if (issues.length) throw new Error('No se guardó esta edición. ' + issues.join('\n'));
}
async function keepAvailableAudio(root, bulletin, now) {
  if (!bulletin?.audioUrl) return false;
  const name = String(bulletin.audioUrl).replace(/^\/?media\//, '');
  const match = audioName.exec(name);
  if (
    match &&
    match[1] + '-' + match[2] === bulletin.id &&
    match[1] >= limaDay(now - 2 * dayMs) &&
    (await optionalFile(join(root, 'public/media', name)))
  )
    return true;
  delete bulletin.audioUrl;
  delete bulletin.voiceType;
  return false;
}
export async function publishCycle({
  root,
  remote,
  token,
  keyValue,
  now = Date.now(),
  refresh,
  generate = generateBulletin,
  ocean = fetchOcean,
  temperature = fetchTemperature,
  verify = verifyPublic,
  apiEnabled = apiCreditActive(now),
}) {
  const temp = await mkdtemp(join(process.env.RUNNER_TEMP || tmpdir(), 'atlas-ci-'));
  try {
    const cache = join(temp, 'ediciones'),
      stateDir = join(temp, 'privado');
    await mkdir(cache);
    await mkdir(stateDir, { mode: 0o700 });
    git(cache, ['init', '--quiet', '--initial-branch=ediciones']);
    git(cache, ['remote', 'add', 'origin', remote]);
    const existing = git(cache, ['ls-remote', '--heads', 'origin', 'refs/heads/ediciones'], token);
    let meta = { format: signature, state: 'pending', oceanDay: null };
    if (existing) {
      git(cache, ['fetch', '--quiet', '--depth=1', '--no-tags', 'origin', 'refs/heads/ediciones'], token);
      validateBranchTree(cache);
      git(cache, ['checkout', '--quiet', '-B', 'ediciones', 'FETCH_HEAD']);
      meta = JSON.parse(await readFile(join(cache, metaName), 'utf8'));
      if (meta.format !== signature || !['pending', 'initialized'].includes(meta.state))
        throw new Error('La rama no pertenece al publicador del atlas.');
      let seed = null;
      try {
        await verify(root);
        seed = JSON.parse(await readFile(join(root,baseFiles[0]),'utf8'));
      } catch {
        console.warn('La semilla de main no superó la verificación. Se recupera la edición publicada.');
      }
      await mirrorPublic(root, cache, now, true, seed);
    }

    const key = parseKey(keyValue);
    let journal = null;
    if (key) {
      try {
        const blob = await optionalFile(join(cache, ledgerName));
        if (blob) {
          journal = unseal(blob, key);
          await restoreState(stateDir, journal);
        } else if (meta.state === 'pending') {
          journal = { v: 1, files: {}, grants: {} };
          const initial = await optionalFile(join(root, baseFiles[0]));
          await seedCurrentSlot(stateDir, initial && JSON.parse(initial));
        } else throw new Error('Faltan reservas inicializadas');
      } catch {
        journal = null;
        console.warn(
          'Reservas privadas no verificables. Esta ejecución actualizará fuentes sin generar con IA.',
        );
      }
    } else if (apiEnabled) console.warn('Falta una ATLAS_STATE_KEY de 32 bytes en base64. IA en pausa.');
    const saveMeta = async () => writeFile(join(cache, metaName), JSON.stringify(meta));
    const saveLedger = async () => {
      const state = await collectState(stateDir, journal.grants, now);
      await writeFile(join(cache, ledgerName), seal(state, key), { mode: 0o600 });
      meta.state = 'initialized';
    };

    const previous = JSON.parse(await readFile(join(root,baseFiles[0]),'utf8'));
    // Bypass the waiting interval for failed sources only. collect() writes the
    // real attempted time and status to the result, even if the retry fails.
    const retryInput = {...previous,sources:previous.sources?.map(s =>
      ['stale','error'].includes(s.status) ? {...s,checkedAt:null} : s)};
    const snapshot = await (refresh ?? refreshPanorama)(retryInput,{now:new Date(now)});
    const temperaturePath = join(root, temperatureFile);
    try {
      const stored = await optionalFile(temperaturePath);
      const previous = savedTemperature(stored);
      const lastCheck = Date.parse(previous?.checkedAt);
      if (!Number.isFinite(lastCheck) || lastCheck > now || limaDay(lastCheck) !== limaDay(now)) {
        const report = await temperature({ now });
        if (!isTemperatureSnapshot(report) || (previous?.seriesEnd && previous.seriesEnd > report.seriesEnd))
          throw new Error('Retroceso en la última semana de NOAA');
        const staged = temperaturePath + '.tmp';
        try {
          await writeFile(staged, JSON.stringify(report));
          await rename(staged, temperaturePath);
        } finally { await rm(staged, {force:true}); }
      }
    } catch {
      console.warn('No se actualizó la serie semanal Niño 1+2. Se conserva el último registro válido.');
    }
    let savedOceanDay = meta.oceanDay;
    if (meta.oceanDay !== limaDay(now)) {
      try {
        const grid = await ocean();
        const old = await optionalFile(join(root, baseFiles[1]));
        if (old && Date.parse(JSON.parse(old).time) > Date.parse(grid.time))
          throw new Error('Observación más antigua');
        await writeFile(join(root, baseFiles[1]), JSON.stringify(grid));
        savedOceanDay = limaDay(now);
      } catch {
        console.warn('NOAA no aportó una cuadrícula nueva válida. Sigue visible la última observación.');
      }
    }
    const slot = slotAt(now);
    const hasAudio =
      (await keepAvailableAudio(root, snapshot.bulletin, now)) && snapshot.bulletin?.id === slot;
    const grants = journal?.grants[slot] ?? [];
    const hasSources = snapshot.sources.some((s) => s.kind === 'oficial' && s.status === 'ok');
    const bulletinInput = { items: snapshot.items, sources: snapshot.sources, now: new Date(now) };
    const canGenerate =
      slot &&
      journal &&
      apiEnabled &&
      !hasAudio &&
      hasSources &&
      grants.length < 2 &&
      (!grants.length || now - grants.at(-1) > 20 * 60000);
    if (canGenerate) {
      await writeFile(join(root, baseFiles[0]), JSON.stringify(snapshot));
      await verify(root);
      // Commit a durable grant BEFORE any billable request. A runner loss after
      // this point consumes one of two possible attempts for this edition.
      journal.grants[slot] = [...grants, now];
      await saveLedger();
      await saveMeta();
      commit(cache, 'Reservar edición ' + slot, token);
      try {
        const b = await generate({
          ...bulletinInput,
          stateDir,
          audioDir: join(root, 'public/media'),
          audioBaseUrl: 'media/',
          audio: true,
          useAI: true,
        });
        if (b) snapshot.bulletin = b;
      } catch {
        console.warn('La edición con IA no está disponible en este intento.');
      }
      await saveLedger();
    } else if (journal && meta.state === 'pending') await saveLedger();

    if (slot && hasSources && snapshot.bulletin?.id !== slot) {
      try {
        const free = await generate({
          ...bulletinInput,
          stateDir: join(temp, 'sin-gasto'),
          audioDir: join(temp, 'sin-gasto/audio'),
          audio: false,
          useAI: false,
        });
        if (free?.id === slot && free.mode === 'fuentes') snapshot.bulletin = free;
      } catch {
        console.warn('No se pudo preparar el texto de esta franja. Se conservará la última edición.');
      }
    }
    await keepAvailableAudio(root, snapshot.bulletin, now);
    await writeFile(join(root, baseFiles[0]), JSON.stringify(snapshot));
    for (const f of await files(join(root, 'public/media'))) {
      if (f.isFile() && audioName.test(f.name) && f.name.slice(8, 18) < limaDay(now - 2 * dayMs))
        await rm(join(root, 'public/media', f.name));
    }
    await verify(root);
    await mirrorPublic(root, cache, now, false);
    meta.oceanDay = savedOceanDay;
    await saveMeta();
    commit(cache, 'Actualizar fuentes ' + new Date(now).toISOString(), token);
    return {
      iaDisponible: Boolean(journal && apiEnabled),
      intentoIA: Boolean(canGenerate),
      edicion: snapshot.bulletin?.id ?? null,
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repo = process.env.GITHUB_REPOSITORY ?? '';
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    !/^[-\w.]+\/atlas-el-nino-peru$/.test(repo) ||
    process.env.GITHUB_REF !== 'refs/heads/main'
  )
    throw new Error('El publicador solo corre en Actions desde main.');
  const root = fileURLToPath(new URL('../', import.meta.url));
  console.log(
    await publishCycle({
      root,
      remote: 'https://github.com/' + repo + '.git',
      token: process.env.ATLAS_GIT_TOKEN,
      keyValue: process.env.ATLAS_STATE_KEY,
    }),
  );
}
