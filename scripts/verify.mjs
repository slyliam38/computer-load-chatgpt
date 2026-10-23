import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Agent } from '../server/agent.mjs';
import { ROOT, startLocal } from '../server/main.mjs';
import path from 'node:path';

const agent = new Agent(ROOT);
const servers = await startLocal(agent, {mcpPort:18997,localPort:18998});
const client = new Client({name:'computer-load-verification',version:'0.1.0'});
const transport = new StreamableHTTPClientTransport(new URL('http://127.0.0.1:18997/mcp'));
function safeToolError(result) {
  const text = result.content?.find(part => part.type === 'text')?.text;
  if (typeof text !== 'string') return 'no error detail';
  return text.replace(/[A-Za-z]:[\\/][^\s]+|\/(?:Users|home)\/[^\s]+/g, '<private-path>').replace(/\s+/g, ' ').slice(0, 240);
}
try {
  await client.connect(transport);
  const {tools} = await client.listTools();
  assert.deepEqual(tools.map(t=>t.name).sort(), ['diagnose_computer','show_diagnosis','prepare_process_stop','get_stop_status'].sort());
  assert.equal(tools.some(t=>/execute|confirm|kill|shell/.test(t.name)),false);
  assert.equal(tools.find(t=>t.name==='prepare_process_stop').annotations.readOnlyHint,false);
  const scan = await client.callTool({name:'diagnose_computer',arguments:{seconds:2,limit:20}});
  assert.equal(scan.isError,undefined,`diagnose_computer failed: ${safeToolError(scan)}`);
  const data = scan.structuredContent;
  assert.ok(data.snapshot_id);
  assert.equal(data.cpu.samples_percent.length,2);
  assert.ok(data.processes.length>0 && data.processes.length<=20);
  assert.ok(data.cpu.average_percent>=0 && data.cpu.average_percent<=100);
  for (const row of data.processes) {
    assert.equal('exe' in row,false); assert.equal('owner' in row,false); assert.equal('cmdline' in row,false);
    assert.ok(Number.isFinite(row.rss_bytes));
  }
  const shown = await client.callTool({name:'show_diagnosis',arguments:{snapshot_id:data.snapshot_id}});
  assert.equal(shown.structuredContent.snapshot_id,data.snapshot_id);
  const protectedRow = data.processes.find(p=>p.action.mode!=='confirm');
  assert.ok(protectedRow);
  const rejection = await client.callTool({name:'prepare_process_stop',arguments:{snapshot_id:data.snapshot_id,process_id:protectedRow.process_id}});
  assert.equal(rejection.isError,true);
  const {resources} = await client.listResources();
  assert.equal(resources.length,1);
  const resource = await client.readResource({uri:resources[0].uri});
  assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');
  assert.ok(resource.contents[0].text.includes('ui/initialize'));
  assert.ok(resource.contents[0].text.includes('ui/notifications/tool-result'));
  assert.ok(!resource.contents[0].text.includes('src="/widget.mjs"'));
  const unknown = await client.callTool({name:'get_stop_status',arguments:{proposal_id:'0'.repeat(32)}});
  assert.equal(unknown.isError,true);
  const plugin=JSON.parse(readFileSync(path.join(ROOT,'plugin.json'),'utf8'));
  const mcp=JSON.parse(readFileSync(path.join(ROOT,'mcp.json'),'utf8'));
  assert.equal(plugin.name,'computer-load'); assert.equal(mcp.mcpServers['computer-load'].type,'stdio');
  mkdirSync(path.join(ROOT,'artifacts'),{recursive:true});
  writeFileSync(path.join(ROOT,'artifacts/live-scan.json'),JSON.stringify(data,null,2));
  writeFileSync(path.join(ROOT,'artifacts/verification.json'),JSON.stringify({verified_at:new Date().toISOString(),platform:process.platform,tools:tools.map(t=>t.name),resource_mime:resource.contents[0].mimeType,live_sample_seconds:data.sample_seconds,processes_seen:data.processes_seen,private_fields_excluded:true,protected_stop_rejected:true,user_processes_stopped:0,chatgpt_connection_tested:false,windows_runtime_tested:process.platform==='win32'},null,2));
  console.log(JSON.stringify({ok:true,tools:tools.length,platform:process.platform,processes_seen:data.processes_seen,sample_seconds:data.sample_seconds,user_processes_stopped:0}));
} finally { await client.close(); servers.close(); agent.close(); }
