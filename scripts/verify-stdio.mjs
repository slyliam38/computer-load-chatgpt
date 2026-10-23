import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const transport = new StdioClientTransport({command:process.execPath,args:[path.join(root,'server/main.mjs'),'--stdio'],cwd:root,env:{...process.env,COMPUTER_LOAD_MCP_PORT:'18977',COMPUTER_LOAD_LOCAL_PORT:'18978'},stderr:'pipe'});
const client=new Client({name:'computer-load-stdio-check',version:'0.1.0'});
try {
  await client.connect(transport);
  const {tools}=await client.listTools();
  assert.equal(tools.length,4);
  const {resources}=await client.listResources();
  assert.equal(resources.length,1);
  const resource=await client.readResource({uri:resources[0].uri});
  assert.equal(resource.contents[0].mimeType,'text/html;profile=mcp-app');
  console.log(JSON.stringify({ok:true,transport:'stdio',tools:tools.length,stdout_protocol_clean:true}));
} finally {await client.close();}
