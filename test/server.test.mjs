// 通过 MCP 协议（内存传输）验证服务端：工具发现、调用、错误不崩溃。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../server.mjs';

const ENV = { CODEARTS_REQ_ENDPOINT: 'https://projectman-ext.cn-north-4.myhuaweicloud.com', CODEARTS_REQ_AK: 'AK', CODEARTS_REQ_SK: 'SK' };

describe('MCP 协议层', () => {
  let client;
  const requests = [];
  before(async () => {
    const fetch = async (url, init) => {
      requests.push({ url, ...init });
      const body = init.method === 'POST'
        ? { project_id: 'new-id', project_num_id: 7, project_name: 'TestDemo', project_type: 'scrum', user_num_id: 1 }
        : { total: 1, projects: [{ project_id: 'p', project_name: 'Old', project_type: 'scrum' }] };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const server = createServer({ env: ENV, fetch });
    const [a, b] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test', version: '1.0.0' });
    await Promise.all([server.connect(a), client.connect(b)]);
  });
  after(() => client.close());

  test('initialize 返回服务名与 instructions', () => {
    assert.equal(client.getServerVersion().name, 'codearts-req');
    assert.match(client.getInstructions(), /list_projects/);
  });

  test('tools/list 暴露两个带 JSON Schema 的工具', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ['create_project', 'list_projects']);
    for (const t of tools) assert.equal(t.inputSchema.type, 'object');
  });

  test('先查询再创建（与码道验证指令相同的调用顺序）', async () => {
    const list = await client.callTool({ name: 'list_projects', arguments: {} });
    assert.ok(!list.isError);
    assert.match(list.content[0].text, /共 1 个项目/);
    const created = await client.callTool({ name: 'create_project', arguments: { project_name: 'TestDemo', project_type: 'scrum', description: 'modify testxxxxx' } });
    assert.ok(!created.isError);
    assert.equal(created.structuredContent.project_id, 'new-id');
    assert.deepEqual(requests.map((r) => r.method), ['GET', 'POST']);
  });

  test('非法参数返回 isError，而不是协议错误', async () => {
    const r = await client.callTool({ name: 'create_project', arguments: { project_name: 'x', project_type: 'bad' } });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /INVALID_ARGUMENTS/);
  });
});

test('node server.mjs 能以 stdio 方式启动并响应 initialize', async () => {
  // 去掉凭证变量，保留 PATH/SystemRoot 等（Windows 下子进程需要）
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('CODEARTS_REQ_')));
  const serverPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs');
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'], env: cleanEnv });
  const line = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), 5000);
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      if (buf.includes('\n')) {
        clearTimeout(timer);
        resolve(buf.split('\n')[0]);
      }
    });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n');
  });
  child.kill();
  const msg = JSON.parse(line);
  assert.equal(msg.id, 1);
  assert.equal(msg.result.serverInfo.name, 'codearts-req');
  assert.ok(msg.result.capabilities.tools);
});
