import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
/** Local-only development diagnostics for this application's own renderer.
 * No desktop capture, remote service, credentials or browser-control API. */
function localDiagnostics():Plugin {
 return {name:'roadster-local-diagnostics',configureServer(server){
  const dir=resolve(process.cwd(),'output');
  server.middlewares.use('/__lab_diagnostics',(req,res)=>{
   res.setHeader('Content-Type','application/json');
   if(req.method==='GET'){const path=resolve(dir,'browser-check.json');res.end(existsSync(path)?readFileSync(path):'{"status":"awaiting-app-startup"}');return;}
   if(req.method!=='POST'){res.statusCode=405;res.end('{}');return;}
   let body='';req.on('data',(chunk:Buffer)=>{body+=chunk.toString();if(body.length>10_000_000)req.destroy();});
   req.on('end',()=>{try{
    const data=JSON.parse(body) as {report:unknown;image?:string;views?:Record<string,string>};mkdirSync(dir,{recursive:true});
    writeFileSync(resolve(dir,'browser-check.json'),JSON.stringify(data.report,null,2)+'\n');
    if(typeof data.image==='string'&&data.image.startsWith('data:image/png;base64,'))writeFileSync(resolve(dir,'runtime-cockpit.png'),Buffer.from(data.image.slice(22),'base64'));
    for(const name of ['front','rear','display']){const view=data.views?.[name];if(typeof view==='string'&&view.startsWith('data:image/png;base64,'))writeFileSync(resolve(dir,`runtime-${name}.png`),Buffer.from(view.slice(22),'base64'));}
    res.end('{"saved":true}');
   }catch{res.statusCode=400;res.end('{"saved":false}');}});
  });
 }};
}
export default defineConfig({
 base:'./',plugins:[localDiagnostics()],
 server:{host:'127.0.0.1',port:5178,watch:{usePolling:true}},
 build:{target:'es2022',chunkSizeWarningLimit:1200}
});
