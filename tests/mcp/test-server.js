'use strict';
// The MCP HTTP server with a fake backend: JSON-RPC handling and the
// transport security checks (token, Origin, Host, methods, size).
const assert = require('node:assert/strict');
const http = require('node:http');
const { McpHttpServer, generateToken, tokenMatches, bearerToken } = require('../../build/mcp/server');
const { TOOLS } = require('../../build/mcp/tools');

const TOKEN = generateToken();
const calls = [];
const backend = {
  tools: () => TOOLS,
  async callTool(name, args, client) {
    calls.push({ name, args, client });
    if (name === 'tabs_list') return { content: [{ type: 'text', text: 'ok' }] };
    if (name === 'screenshot') return { content: [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }] };
    if (name === 'click') throw new Error('boom');
    return { isError: true, content: [{ type: 'text', text: 'denied' }] };
  },
};

function request(port, { method = 'POST', path = '/mcp', headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: { ...(host ? { Host: host } : {}), ...headers, ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}) } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json;
          try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  assert.equal(tokenMatches('abc', 'abc'), true);
  assert.equal(tokenMatches('abd', 'abc'), false);
  assert.equal(tokenMatches('ab', 'abc'), false);
  assert.equal(tokenMatches('', ''), false, 'an empty expected token never matches');
  assert.equal(bearerToken('Bearer  xyz '), 'xyz');
  assert.equal(bearerToken('Basic xyz'), '');
  assert.equal(generateToken().length, 48);

  const server = new McpHttpServer({ backend, getToken: () => TOKEN, port: 0, version: '9.9.9' });
  await server.start();
  const port = server.port;
  assert.ok(port > 0);
  const auth = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
  const rpc = (body, headers = {}) => request(port, { headers: { ...auth, ...headers }, body });

  try {
    // Transport security
    let r = await request(port, { body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    assert.equal(r.status, 401, 'no token');
    r = await request(port, { headers: { Authorization: 'Bearer nope' }, body: { jsonrpc: '2.0', id: 1, method: 'ping' } });
    assert.equal(r.status, 401, 'wrong token');
    r = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'https://evil.example' });
    assert.equal(r.status, 403, 'any Origin header is refused, even with a valid token');
    r = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'null' });
    assert.equal(r.status, 403);
    r = await request(port, { headers: auth, body: { jsonrpc: '2.0', id: 1, method: 'ping' }, host: 'evil.example' });
    assert.equal(r.status, 421, 'DNS rebinding host');
    r = await request(port, { headers: auth, body: { jsonrpc: '2.0', id: 1, method: 'ping' }, host: `127.0.0.1:${port + 1}` });
    assert.equal(r.status, 421, 'wrong port in Host');
    r = await request(port, { headers: auth, body: { jsonrpc: '2.0', id: 1, method: 'ping' }, host: `localhost:${port}` });
    assert.equal(r.status, 200, 'localhost host is fine');
    r = await request(port, { method: 'GET', headers: auth });
    assert.equal(r.status, 405);
    r = await request(port, { method: 'GET' });
    assert.equal(r.status, 401, 'the token is checked before the method');
    r = await request(port, { path: '/other', headers: auth, body: {} });
    assert.equal(r.status, 404);
    assert.equal(r.headers['access-control-allow-origin'], undefined, 'no CORS headers');
    r = await request(port, { method: 'OPTIONS', headers: auth });
    assert.ok(r.status === 405 || r.status === 404, 'no CORS preflight support');
    assert.equal(r.headers['access-control-allow-origin'], undefined);

    // Size limit
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(1024 * 1024 + 10) } });
    r = await request(port, { headers: auth, body: big }).catch((e) => ({ status: 'reset', error: e }));
    assert.ok(r.status === 413 || r.status === 'reset', 'oversized body is refused');

    // JSON-RPC
    r = await rpc('{not json');
    assert.equal(r.status, 400);
    assert.equal(r.json.error.code, -32700);
    r = await rpc({ jsonrpc: '2.0', id: 1 });
    assert.equal(r.json.error.code, -32600);
    r = await rpc([]);
    assert.equal(r.status, 400);

    r = await rpc({ jsonrpc: '2.0', id: 7, method: 'initialize', params: { protocolVersion: '2025-03-26', clientInfo: { name: 'Claude Code', version: '1' } } });
    assert.equal(r.json.id, 7);
    assert.equal(r.json.result.protocolVersion, '2025-03-26');
    assert.deepEqual(r.json.result.capabilities, { tools: {} });
    assert.deepEqual(r.json.result.serverInfo, { name: 'surfing', version: '9.9.9' });
    assert.match(r.json.result.instructions, /tabId/);
    const session = r.headers['mcp-session-id'];
    assert.ok(session);
    r = await rpc({ jsonrpc: '2.0', id: 8, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
    assert.equal(r.json.result.protocolVersion, '2025-06-18', 'unknown versions fall back');

    r = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(r.status, 202);
    assert.equal(r.text, '');
    r = await rpc({ jsonrpc: '2.0', id: 9, method: 'ping' });
    assert.deepEqual(r.json, { jsonrpc: '2.0', id: 9, result: {} });
    r = await rpc({ jsonrpc: '2.0', id: 10, method: 'no/such' });
    assert.equal(r.json.error.code, -32601);

    r = await rpc({ jsonrpc: '2.0', id: 11, method: 'tools/list' });
    const names = r.json.result.tools.map((t) => t.name);
    for (const name of ['tabs_list', 'tabs_create', 'tabs_activate', 'tabs_close', 'navigate', 'read_page', 'find', 'get_page_text', 'click', 'type', 'key', 'scroll', 'form_input', 'screenshot', 'wait_for', 'javascript', 'console_messages']) {
      assert.ok(names.includes(name), `tool ${name} is listed`);
    }
    for (const tool of r.json.result.tools) {
      assert.equal(tool.inputSchema.type, 'object');
      assert.ok(tool.description.length > 10);
    }

    // tools/call: session client name, results, isError, thrown errors, unknown tool
    r = await rpc({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'tabs_list', arguments: {} } }, { 'Mcp-Session-Id': session });
    assert.deepEqual(r.json.result.content, [{ type: 'text', text: 'ok' }]);
    assert.equal(calls.at(-1).client.name, 'Claude Code');
    r = await rpc({ jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'tabs_list' } });
    assert.equal(calls.at(-1).client.name, 'An MCP client', 'no session: generic client name');
    r = await rpc({ jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'screenshot', arguments: {} } });
    assert.equal(r.json.result.content[0].type, 'image');
    r = await rpc({ jsonrpc: '2.0', id: 15, method: 'tools/call', params: { name: 'click', arguments: {} } });
    assert.equal(r.json.result.isError, true);
    assert.equal(r.json.result.content[0].text, 'boom');
    assert.equal(r.json.error, undefined, 'a throwing tool is a tool error, not a protocol error');
    r = await rpc({ jsonrpc: '2.0', id: 16, method: 'tools/call', params: { name: 'nope' } });
    assert.equal(r.json.error.code, -32602);
    r = await rpc({ jsonrpc: '2.0', id: 17, method: 'tools/call', params: {} });
    assert.equal(r.json.error.code, -32602);

    // Batches: notifications drop out
    r = await rpc([
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    assert.equal(r.json.length, 2);
    assert.deepEqual(r.json.map((x) => x.id), [1, 2]);
    r = await rpc([{ jsonrpc: '2.0', method: 'notifications/initialized' }]);
    assert.equal(r.status, 202);

    console.log('PASS: JSON-RPC methods, batches, tool errors; token/Origin/Host/method/size checks');
  } finally {
    await server.stop();
  }

  // After stop nothing listens any more.
  await assert.rejects(request(port, { headers: auth, body: {} }));

  // A busy port is reported as EADDRINUSE.
  const first = new McpHttpServer({ backend, getToken: () => TOKEN, port: 0, version: '1' });
  await first.start();
  const second = new McpHttpServer({ backend, getToken: () => TOKEN, port: first.port, version: '1' });
  await assert.rejects(second.start(), (error) => error.code === 'EADDRINUSE');
  await first.stop();
  console.log('PASS: stop releases the port; a busy port rejects with EADDRINUSE');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
