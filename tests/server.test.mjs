import test from 'node:test';
import assert from 'node:assert/strict';
import { localRequestAllowed, startLocal } from '../server/main.mjs';

function req(headers = {}, method = 'GET', remoteAddress = '127.0.0.1') {
  return { method, headers: { host: '127.0.0.1:18898', ...headers }, socket: { remoteAddress } };
}
test('local boundary rejects remote, cross-site, DNS rebinding and forwarded requests', () => {
  assert.equal(localRequestAllowed(req(), 18898), true);
  for (const input of [req({}, 'GET', '10.0.0.1'), req({host: 'evil.example:18898'}), req({origin:'https://evil.example'}), req({'x-forwarded-for':'127.0.0.1'}), req({'x-forwarded-host':'localhost'}), req({'sec-fetch-site':'cross-site'}), req({}, 'POST')]) {
    assert.equal(localRequestAllowed(input, 18898), false);
  }
  assert.equal(localRequestAllowed(req({origin:'http://127.0.0.1:18898'}, 'POST'), 18898), true);
});

test('HTTP confirmation needs a local origin, CSRF and explicit saved-work checkbox', async () => {
  const calls = [];
  const fakeAgent = { call: async (op, args) => { calls.push({op,args}); return {status:'exited'}; } };
  const servers = await startLocal(fakeAgent, {localPort:18898, mcpPort:18897});
  const url = 'http://127.0.0.1:18898';
  try {
    const {csrf} = await (await fetch(url+'/api/session')).json();
    const data = {proposal_id:'a'.repeat(32),confirmation:'VLC',saved_work:true};
    const post = headers => fetch(url+'/api/confirm', {method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
    assert.equal((await post({})).status,403);
    assert.equal((await post({Origin:url})).status,403);
    assert.equal((await post({Origin:'https://evil.example','X-CSRF-Token':csrf})).status,403);
    assert.equal(calls.length,0);
    data.saved_work=false;
    assert.equal((await post({Origin:url,'X-CSRF-Token':csrf})).status,400);
    assert.equal(calls.length,0);
    data.saved_work=true;
    assert.equal((await post({Origin:url,'X-CSRF-Token':csrf})).status,200);
    assert.equal(calls.length,1); assert.equal(calls[0].op,'execute');
    assert.equal((await fetch('http://127.0.0.1:18897/api/confirm', {method:'POST'})).status,404);
  } finally { servers.close(); }
});
