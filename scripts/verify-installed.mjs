// Read-only integration check. No model turn and no process-stop tools are used.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expected = ['diagnose_computer', 'show_diagnosis', 'prepare_process_stop', 'get_stop_status'].sort();
const configResult = spawnSync('codex', ['mcp', 'get', 'computer-load', '--json'], { encoding: 'utf8' });
assert.equal(configResult.status, 0, configResult.stderr);
const config = JSON.parse(configResult.stdout);
assert.equal(config.enabled, true);
assert.equal(config.transport.type, 'stdio');
assert.ok(config.transport.args[0].includes('/plugins/cache/'));
mkdirSync(path.join(root, 'artifacts'), { recursive: true });

// Ask Codex's own app-server to discover this installed MCP server, without
// creating a chat, running a model or changing other plugin settings.
// The desktop may already own the normal ports. Override only this test's server
// entry with the exact installed command and isolated ports, leaving config.toml intact.
const testEnv = { COMPUTER_LOAD_MCP_PORT: '18977', COMPUTER_LOAD_LOCAL_PORT: '18978' };
const override = `mcp_servers.computer-load={command=${JSON.stringify(config.transport.command)},args=${JSON.stringify(config.transport.args)},cwd=${JSON.stringify(config.transport.cwd)},env={COMPUTER_LOAD_MCP_PORT="18977",COMPUTER_LOAD_LOCAL_PORT="18978"}}`;
const host = spawn('codex', ['app-server', '--disable', 'apps', '-c', override], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
const pending = new Map();
let id = 0;
host.stderr.on('data', () => {});
host.on('error', err => { for (const item of pending.values()) item.reject(err); });
host.on('exit', () => { for (const item of pending.values()) item.reject(new Error('Codex app-server exited')); });
createInterface({ input: host.stdout }).on('line', line => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const item = pending.get(msg.id);
  if (!item) return;
  clearTimeout(item.timer);
  pending.delete(msg.id);
  msg.error ? item.reject(new Error(JSON.stringify(msg.error))) : item.resolve(msg.result);
});
function rpc(method, params) {
  const requestId = ++id;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)); }, 45000);
    pending.set(requestId, { resolve, reject, timer });
    host.stdin.write(JSON.stringify({ id: requestId, method, params }) + '\n');
  });
}
let inventory;
try {
  await rpc('initialize', { clientInfo: { name: 'computer-load-install-check', version: '0.1.1' }, capabilities: { experimentalApi: true } });
  host.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
  const status = await rpc('mcpServerStatus/list', { serverName: 'computer-load', detail: 'toolsAndAuthOnly' });
  inventory = status.data.find(s => s.name === 'computer-load');
  assert.ok(inventory, 'Installed server is absent from Codex inventory');
  assert.equal(inventory.toolsError ?? null, null);
  assert.deepEqual(Object.values(inventory.tools).map(t => t.name).sort(), expected);
  writeFileSync(path.join(root, 'artifacts/codex-plugin-inventory.json'), JSON.stringify(inventory, null, 2));
  console.log(JSON.stringify({ phase: 'codex_discovery', ok: true, tools: expected }));
} finally {
  for (const item of pending.values()) clearTimeout(item.timer);
  host.stdin.end();
  await new Promise(resolve => {
    if (host.exitCode !== null) return resolve();
    const timer = setTimeout(() => host.kill(), 2000);
    host.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

// Now execute through the exact installed command that Codex resolved.
const transport = new StdioClientTransport({ ...config.transport, env: { ...process.env, ...config.transport.env, ...testEnv }, stderr: 'pipe' });
const client = new Client({ name: 'computer-load-installed-check', version: '0.1.1' });
try {
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), expected);
  const scan = await client.callTool({ name: 'diagnose_computer', arguments: { seconds: 3, limit: 25 } });
  assert.ok(!scan.isError, 'Installed diagnostic returned an error');
  const data = scan.structuredContent;
  assert.equal(data.cpu.samples_percent.length, 3);
  assert.ok(data.processes.length > 0);
  for (const row of data.processes) {
    for (const privateField of ['exe', 'owner', 'cmdline']) assert.equal(privateField in row, false);
  }
  const shown = await client.callTool({ name: 'show_diagnosis', arguments: { snapshot_id: data.snapshot_id } });
  assert.ok(!shown.isError);
  assert.equal(shown.structuredContent.snapshot_id, data.snapshot_id);
  const resource = await client.readResource({ uri: 'ui://computer-load/dashboard-v1.html' });
  assert.equal(resource.contents[0].mimeType, 'text/html;profile=mcp-app');
  writeFileSync(path.join(root, 'artifacts/codex-live-scan.json'), JSON.stringify(data, null, 2));
  const summary = {
    verified_at: new Date().toISOString(), installed_root: config.transport.cwd,
    codex_discovered_tools: expected, discovery_ports_isolated: true, transport: 'stdio', sample_seconds: data.sample_seconds,
    cpu: data.cpu, memory: data.memory, disk: data.disk, network: data.network,
    severity: data.severity, findings: data.findings,
    processes: data.processes.slice(0, 10), processes_seen: data.processes_seen,
    tools_called: ['diagnose_computer', 'show_diagnosis'], user_processes_stopped: 0,
    desktop_current_chat_tool_reload_tested: false, chat_widget_rendered: false,
  };
  writeFileSync(path.join(root, 'artifacts/codex-installed-verification.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ phase: 'installed_live_scan', ok: true, ...summary }));
} finally { await client.close(); }
