import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer(async(req,res)=>{
  try{
    const previewURL=new URL(req.url,'http://localhost');
    let pathname=decodeURIComponent(previewURL.pathname);
    if(pathname==='/'||pathname==='/home')pathname='/demo/index.html';
    if(['/demo/options.html','/demo/popup.html','/demo/history.html','/demo/setup.html'].includes(pathname)){
      const surface=pathname.endsWith('/popup.html')?'popup':pathname.endsWith('/history.html')?'history':pathname.endsWith('/setup.html')?'setup':'options';
      let html=(await readFile(path.join(root,`extension/${surface}.html`),'utf8'))
        .replace(/(src|href)="([A-Za-z][\w.-]*\.(?:js|css|html))"/g,'$1="/extension/$2"')
        .replace(/(src|href)="assets\//g,'$1="/extension/assets/')
        .replace(`<script src="/extension/${surface}.js" defer></script>`,`<script src="/demo/${surface}-preview.js" defer></script><script src="/extension/${surface}.js" defer></script>`)
        .replace(`<script src="/extension/${surface}.js"></script>`,`<script src="/demo/${surface}-preview.js"></script><script src="/extension/${surface}.js"></script>`);
      // QA only: exercise the production light-mode rules without changing the
      // user's browser/OS appearance. The installed extension keeps its media query.
      if(previewURL.searchParams.get('scheme')==='light')html=html.replace(`/extension/${surface}.css`,`/extension/${surface}.css?scheme=light`);
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);return;
    }
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)||!/^\/(?:demo|extension)\//.test(pathname)){res.writeHead(404);res.end();return;}
    let body=await readFile(file);
    if(['/extension/options.css','/extension/popup.css','/extension/history.css'].includes(pathname)&&previewURL.searchParams.get('scheme')==='light')body=Buffer.from(body.toString('utf8').replace('@media (prefers-color-scheme: light)','@media all'));
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.listen(0,'127.0.0.1',()=>console.log(`SuperX preview: http://127.0.0.1:${server.address().port}/demo/index.html (PID ${process.pid})`));
process.on('SIGINT',()=>server.close(()=>process.exit()));
