#!/usr/bin/env node
// codearts-req MCP Server（stdio）：把华为云 CodeArts 需求管理的
//   · create_project  创建项目      POST /v4/project   (CreateProjectV4)
//   · list_projects   查询项目列表  GET  /v4/projects  (ListProjectsV4)
// 封装成智能体可调用的 MCP 工具。凭证通过环境变量注入：
//   CODEARTS_REQ_ENDPOINT / CODEARTS_REQ_AK / CODEARTS_REQ_SK
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { runTool, TOOLS } from './lib/tools.mjs';

export const SERVER_NAME = 'codearts-req';
export const SERVER_VERSION = '1.0.0';

export function createServer(deps = {}) {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        '华为云 CodeArts 需求管理工具集。查询项目用 list_projects（只读）；创建项目用 create_project（写操作，会真实创建）。' +
        '创建前建议先用 list_projects 的 search 检查同名项目。工具出错时会返回 isError=true 的结构化错误（code: INVALID_ARGUMENTS / MISSING_CONFIG / API_ERROR / NETWORK_ERROR），请根据 message 与 hint 修正后重试。',
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const started = Date.now();
    const result = await runTool(name, args, deps);
    // stdio 模式下 stdout 被协议占用，日志只能写 stderr
    console.error(`[codearts-req] ${name} ${result.isError ? 'ERROR ' + result.structuredContent.error.code : 'OK'} ${Date.now() - started}ms`);
    return result;
  });
  return server;
}

export async function main() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
  console.error(`[codearts-req] MCP Server v${SERVER_VERSION} 已启动（stdio），等待客户端连接…`);
}

// 直接 `node server.mjs` 运行时启动；被测试 import 时不启动
const isMain = (() => {
  try {
    return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((err) => {
    console.error('[codearts-req] 启动失败：', err);
    process.exit(1);
  });
}
