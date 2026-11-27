import http from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {actualizar} from './actualizar.mjs';

const webRoot = fileURLToPath(new URL('../public/', import.meta.url));
const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.svg':'image/svg+xml','.wav':'audio/wav','.mp3':'audio/mpeg','.woff2':'font/woff2'};
const port = Number(process.env.PORT || 4173);
const server = http.createServer(async (req,res) => {
  try {
    if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405,{Allow:'GET, HEAD'}).end();return;}
    const raw = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const route = raw === '/api/panorama' ? '/data/panorama.json' : raw === '/' ? '/index.html' : raw;
    const parts = route.split('/').filter(Boolean);
    if (parts.some(p=>p.startsWith('.') || p.includes('\\'))) {res.writeHead(404).end();return;}
    const file = path.join(webRoot,...parts);
    const info = await stat(file);
    if (!info.isFile()) {res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':types[path.extname(file)] || 'application/octet-stream','Content-Length':info.size,
      'Cache-Control':route.endsWith('panorama.json')?'no-cache':'public, max-age=60','X-Content-Type-Options':'nosniff'});
    if(req.method==='HEAD')res.end();else createReadStream(file).on('error',()=>res.destroy()).pipe(res);
  } catch {if(!res.headersSent)res.writeHead(404);res.end();}
});
server.listen(port, '127.0.0.1', () => console.log('Atlas disponible en http://127.0.0.1:'+port));
if(process.argv.includes('--actualizar')) {
  let running = false;
  async function tick(){
    if (running) return;
    running = true;
    try {await actualizar({ai:false});} catch {console.error('Consulta pendiente; se conserva la edición publicada.');}
    finally {running=false;}
  }
  void tick();
  setInterval(tick,5*60_000);
}
