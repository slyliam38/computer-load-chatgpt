import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../public/dashboard.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../public/widget.mjs', import.meta.url), 'utf8');
const fixture = {
  snapshot_id:'a'.repeat(32),measured_at:'2026-10-01T02:00:00Z',platform:'Windows',sample_seconds:3,severity:'normal',
  cpu:{average_percent:23,logical_cores:8,samples_percent:[20,25,24]},
  memory:{used_percent:65,total_bytes:16*1024**3,available_bytes:6*1024**3,swap_used_bytes:0},
  disk:{free_bytes:100*1024**3,free_percent:30,read_bytes_per_second:1024,write_bytes_per_second:2048},
  network:{received_bytes_per_second:1024,sent_bytes_per_second:1024},
  findings:[{level:'normal',title:'Перегрузки не видно',detail:'Короткий замер'}],processes_seen:2,unreadable_or_exited:0,
  capabilities:{per_process_io:false},
  processes:[
    {process_id:'b'.repeat(24),pid:123,name:'<img src=x onerror=alert(1)>',cpu_one_core_percent:100,rss_bytes:1024,status:'running',read_bytes_per_second:null,write_bytes_per_second:null,action:{mode:'protected',reason:'Защищён'}},
    {process_id:'c'.repeat(24),pid:124,name:'VLC',cpu_one_core_percent:10,rss_bytes:1024**3,status:'running',read_bytes_per_second:null,write_bytes_per_second:null,action:{mode:'confirm',reason:'Медиаприложение'}},
  ],
};
async function harness() {
  const dom = new JSDOM(html, {url:'http://127.0.0.1:8798',runScripts:'outside-only'});
  const calls=[];
  dom.window.fetch = async (url, options) => {
    calls.push({url,options});
    const value = url === '/api/session' ? {csrf:'test-secret'} : url === '/api/pending' ? {proposals:[]} : fixture;
    return {ok:true,json:async()=>value};
  };
  await dom.window.eval(`(async()=>{${script}\n})()`);
  return {dom,calls,document:dom.window.document};
}
async function flush() { for(let n=0;n<8;n++) await new Promise(resolve=>setImmediate(resolve)); }

async function iframeHarness(init = {protocolVersion:'2026-01-26',hostCapabilities:{serverTools:{}},hostContext:{theme:'light'}}) {
  const dom = new JSDOM('<iframe></iframe>', {url:'http://127.0.0.1:19198',runScripts:'outside-only'});
  const view = dom.window.document.querySelector('iframe').contentWindow;
  view.document.write(html);
  const calls=[];
  const send = data => view.dispatchEvent(new view.MessageEvent('message',{source:dom.window,data:{jsonrpc:'2.0',...data}}));
  let callResult = {structuredContent:fixture};
  dom.window.postMessage = msg => {
    calls.push(msg);
    if (msg.method === 'ui/initialize') queueMicrotask(()=>send({id:msg.id,result:init}));
    if (msg.method === 'tools/call') queueMicrotask(()=>send({id:msg.id,result:callResult}));
  };
  await view.eval(`(async()=>{${script}\n})()`);
  await flush();
  return {dom,view,document:view.document,calls,send,setCallResult:r=>{callResult=r;}};
}

test('iframe initializes, renders host results, sorts and scans through tools/call',async()=>{
  const {dom,document,calls,send}=await iframeHarness();
  try {
    assert.ok(calls.some(c=>c.method==='ui/notifications/initialized'));
    assert.equal(document.getElementById('approvals').hidden,true);
    assert.equal(document.getElementById('export').hidden,true);
    send({method:'ui/notifications/tool-result',params:{structuredContent:fixture}});
    assert.equal(document.getElementById('cpu-value').textContent,'23%');
    assert.equal(document.getElementById('scan').textContent,'Повторить проверку');
    assert.equal(document.querySelectorAll('#processes img').length,0);
    document.getElementById('sort-memory').click();
    assert.equal(document.querySelector('#processes .name').textContent,'VLC');
    document.getElementById('scan').click(); await flush();
    assert.equal(calls.filter(c=>c.method==='tools/call').length,1);
    assert.deepEqual(JSON.parse(JSON.stringify(calls.find(c=>c.method==='tools/call').params)),{name:'diagnose_computer',arguments:{seconds:3,limit:25}});
    assert.equal(document.getElementById('scan').disabled,false);
  } finally {dom.window.close();}
});

test('iframe shows host errors, cancellation, malformed data and tool-call errors',async()=>{
  const {dom,document,send,setCallResult}=await iframeHarness();
  try {
    send({method:'ui/notifications/tool-result',params:{isError:true,content:[{type:'text',text:'Замер устарел'}]}});
    assert.equal(document.getElementById('message').textContent,'Замер устарел');
    assert.equal(document.getElementById('message').dataset.error,'true');
    send({method:'ui/notifications/tool-result',params:{structuredContent:fixture}});
    assert.equal(document.getElementById('message').dataset.error,'false');
    assert.ok(document.getElementById('message').textContent.includes('Замер готов'));
    send({method:'ui/notifications/tool-cancelled',params:{reason:'user action'}});
    assert.ok(document.getElementById('message').textContent.includes('отменена'));
    send({method:'ui/notifications/tool-result',params:{structuredContent:{snapshot_id:'a'.repeat(32)}}});
    assert.ok(document.getElementById('message').textContent.includes('неполный отчёт'));
    setCallResult({isError:true,content:[{type:'text',text:'Агент недоступен'}]});
    document.getElementById('scan').click(); await flush();
    assert.equal(document.getElementById('message').textContent,'Агент недоступен');
    assert.equal(document.getElementById('scan').disabled,false);
  } finally {dom.window.close();}
});

test('iframe rejects unsupported initialization and messages from other windows',async()=>{
  const {dom,view,document,calls}=await iframeHarness({protocolVersion:'unsupported',hostCapabilities:{},hostContext:{}});
  try {
    assert.ok(document.getElementById('message').textContent.includes('не поддерживает'));
    assert.equal(calls.some(c=>c.method==='ui/notifications/initialized'),false);
    view.dispatchEvent(new view.MessageEvent('message',{source:null,data:{jsonrpc:'2.0',method:'ui/notifications/tool-result',params:{structuredContent:fixture}}}));
    assert.equal(document.getElementById('cpu-value').textContent,'—');
  } finally {dom.window.close();}
});

test('panel scans with CSRF, renders names safely, sorts and labels unavailable IO', async()=>{
  const {dom,calls,document}=await harness();
  try {
    document.getElementById('scan').click(); await flush();
    assert.equal(document.getElementById('cpu-value').textContent,'23%');
    assert.ok(document.getElementById('status-text').textContent.includes('Windows'));
    assert.equal(document.querySelectorAll('#processes tr').length,2);
    assert.equal(document.querySelectorAll('#processes img').length,0);
    assert.ok(document.querySelector('#processes .name').textContent.includes('<img'));
    assert.ok(document.getElementById('processes').textContent.includes('н/д'));
    const scan=calls.find(c=>c.url==='/api/diagnose');
    assert.equal(scan.options.headers['X-CSRF-Token'],'test-secret');
    document.getElementById('sort-memory').click();
    assert.equal(document.querySelector('#processes .name').textContent,'VLC');
    assert.equal(document.querySelectorAll('#processes button').length,1);
    assert.equal(document.getElementById('export').disabled,false);
  } finally {dom.window.close();}
});

test('diagnostic error is visible and scan button recovers',async()=>{
  const {dom,document}=await harness();
  try {
    dom.window.fetch=async()=>({ok:false,json:async()=>({error:'Агент недоступен'})});
    document.getElementById('scan').click(); await flush();
    assert.equal(document.getElementById('message').textContent,'Агент недоступен');
    assert.equal(document.getElementById('scan').disabled,false);
  } finally {dom.window.close();}
});
