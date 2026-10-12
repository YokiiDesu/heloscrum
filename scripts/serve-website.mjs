import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {websiteDemoHeaders} from '../lib/website-demos.mjs';
const root = fileURLToPath(new URL('../website/', import.meta.url));
const types = {'.xml':'application/xml; charset=utf-8','.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp'};
const port = Number(process.env.PORT || 4180);
http.createServer(async (req,res) => {
  try {
    if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405);return res.end();}
    const name = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const target = path.resolve(root,'.'+(name.endsWith('/') ? name+'index.html' : name));
    if (!target.startsWith(root) || !types[path.extname(target)]) {res.writeHead(404);return res.end();}
    const body = await readFile(target);
    res.writeHead(200,{'Content-Type':types[path.extname(target)],'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache',...websiteDemoHeaders(path.relative(root,target).split(path.sep).join('/'))});
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {res.writeHead(404);res.end('Not found');}
}).listen(port,'127.0.0.1',()=>console.log(`HeloScrum website: http://127.0.0.1:${port}`));
