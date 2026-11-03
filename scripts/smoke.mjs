#!/usr/bin/env node
// 端到端自检：像码道一样以 stdio 方式拉起 server.mjs，走完整 MCP 协议。
//
//   npm run smoke                         # 列出工具 + 调用 list_projects（只读）
//   npm run smoke -- --create TestDemo    # 额外创建一个 scrum 项目（写操作）
//
// 凭证读取自当前环境变量 CODEARTS_REQ_ENDPOINT / CODEARTS_REQ_AK / CODEARTS_REQ_SK；
// 未配置时会看到 MISSING_CONFIG 结构化错误，用于验证错误处理。
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const createIdx = process.argv.indexOf('--create');
const createName = createIdx > 0 ? process.argv[createIdx + 1] : null;

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, 'server.mjs')],
  env: { ...process.env },
  stderr: 'inherit',
});
const client = new Client({ name: 'smoke-test', version: '1.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`✔ 已连接 ${client.getServerVersion()?.name}，工具 ${tools.length} 个：`);
for (const t of tools) console.log(`  - ${t.name}: ${t.description.split('\n')[0]}`);

const show = (label, r) => {
  console.log(`\n${r.isError ? '✘' : '✔'} ${label}`);
  console.log(r.content.map((c) => c.text).join('\n'));
};

show('list_projects {limit: 5}', await client.callTool({ name: 'list_projects', arguments: { limit: 5 } }));
show('参数校验示例 list_projects {offset: 3, limit: 10}', await client.callTool({ name: 'list_projects', arguments: { offset: 3, limit: 10 } }));

if (createName) {
  show(
    `create_project {project_name: ${createName}, project_type: scrum}`,
    await client.callTool({ name: 'create_project', arguments: { project_name: createName, project_type: 'scrum', description: 'created by codearts-req MCP smoke test' } }),
  );
}

await client.close();
