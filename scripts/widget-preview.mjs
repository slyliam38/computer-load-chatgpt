// A local, read-only MCP Apps test host. This is not the native Codex chat host.
import { createServer } from 'node:http';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 19198;
const client = new Client({name:'computer-load-widget-test-host',version:'0.1.3'});
await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:19097/mcp')));
const resource = await client.readResource({uri:'ui://computer-load/dashboard-v1.html'});
const widget = resource.contents[0].text;
const events = [];
let latest;
const host = `<!doctype html><html lang="ru"><meta charset="utf-8"><title>Проверка MCP Apps виджета</title>
<style>body{margin:0;background:#edf1f7;font-family:system-ui;color:#17243a}header{padding:16px 24px;border-bottom:1px solid #d6deeb}h1{font-size:19px;margin:0 0 7px}p{font-size:13px;margin:0 0 12px}button{margin:0 6px 6px 0;padding:8px 12px}iframe{border:0;width:100%;height:650px;display:block}#host-status{font-size:12px}</style>
<header><h1>Тестовый контейнер MCP Apps</h1><p>Настоящий ресурс установленного плагина и живой MCP-сервер. Это проверка iframe, а не виджет в ленте чата Codex.</p>
<button id="restore">Получить свежий замер</button><button id="test-error">Проверить ошибку</button><button id="test-cancel">Проверить отмену</button><button id="test-partial">Проверить неполные данные</button><div id="host-status">Жду инициализации виджета…</div></header>
<iframe id="widget" title="Что нагружает компьютер" sandbox="allow-scripts" src="/widget"></iframe>
<script>
const frame=document.getElementById('widget'), status=document.getElementById('host-status');
function send(data){frame.contentWindow.postMessage({jsonrpc:'2.0',...data},'*')}
async function call(name,args){const res=await fetch('/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,arguments:args})});return res.json()}
async function fresh(){status.textContent='Получаю живой замер…';const data=await call('diagnose_computer',{seconds:3,limit:25});send({method:'ui/notifications/tool-result',params:data});status.textContent=data.isError?'Ошибка MCP':'Живые данные переданы в iframe через tool-result';}
window.addEventListener('message',async event=>{
 if(event.source!==frame.contentWindow||event.data?.jsonrpc!=='2.0')return;
 const msg=event.data;
 fetch('/event',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:msg.method})}).catch(()=>{});
 if(msg.method==='ui/initialize')send({id:msg.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'local-read-only-test-host',version:'0.1.3'},hostCapabilities:{serverTools:{},serverResources:{}},hostContext:{theme:'light',displayMode:'inline'}}});
 else if(msg.method==='ui/notifications/initialized')await fresh();
 else if(msg.method==='ui/notifications/size-changed'&&Number.isFinite(msg.params?.height))frame.style.height=Math.max(200,Math.min(10000,msg.params.height))+'px';
 else if(msg.method==='tools/call')send({id:msg.id,result:await call(msg.params.name,msg.params.arguments)});
});
document.getElementById('restore').onclick=fresh;
document.getElementById('test-error').onclick=()=>send({method:'ui/notifications/tool-result',params:{isError:true,content:[{type:'text',text:'Тест: агент недоступен. Повторите проверку.'}]}});
document.getElementById('test-cancel').onclick=()=>send({method:'ui/notifications/tool-cancelled',params:{reason:'test'}});
document.getElementById('test-partial').onclick=()=>send({method:'ui/notifications/tool-result',params:{structuredContent:{snapshot_id:'a'.repeat(32)}}});
</script></html>`;
function json(res, data) {res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
const server=createServer(async(req,res)=>{
  if(req.socket.remoteAddress!=='127.0.0.1'||req.headers.host!==`127.0.0.1:${port}` ||
    (req.method==='POST'&&req.headers.origin!==`http://127.0.0.1:${port}`)) {res.writeHead(403);return res.end();}
  if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'});return res.end(host);}
  if(req.method==='GET'&&req.url==='/widget'){
    res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:"});return res.end(widget);
  }
  if(req.method==='GET'&&req.url==='/evidence')return json(res,{events,latest});
  if(req.method!=='POST'||!['/call','/event'].includes(req.url)){res.writeHead(404);return res.end();}
  try {
    let body=''; for await(const chunk of req){body+=chunk;if(body.length>8192)throw new Error('Request too large');}
    const data=JSON.parse(body);
    if(req.url==='/event'){events.push({method:data.method,at:new Date().toISOString()});return json(res,{});}
    if(!['diagnose_computer','show_diagnosis'].includes(data.name))return json(res,{isError:true,content:[{type:'text',text:'В этом тесте разрешена только диагностика.'}]});
    const result=await client.callTool(data);
    if(data.name==='diagnose_computer'&&!result.isError){
      latest=result.structuredContent;
      mkdirSync(path.join(root,'artifacts'),{recursive:true});
      writeFileSync(path.join(root,'artifacts/widget-live-scan.json'),JSON.stringify(latest,null,2));
    }
    json(res,result);
  } catch {json(res,{isError:true,content:[{type:'text',text:'Ошибка тестового MCP соединения'}]});}
});
server.listen(port,'127.0.0.1',()=>console.log(`Read-only widget test: http://127.0.0.1:${port}`));
async function close(){server.close();await client.close();process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
