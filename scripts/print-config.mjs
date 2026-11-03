#!/usr/bin/env node
// 生成可直接粘贴到码道 mcp_settings.json 的配置（自动填好本机 server.mjs 的绝对路径）。
//   npm run config
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs').replace(/\\/g, '/');
const config = {
  mcpServers: {
    'codearts-req': {
      command: 'node',
      args: [serverPath],
      env: {
        CODEARTS_REQ_ENDPOINT: process.env.CODEARTS_REQ_ENDPOINT || 'https://projectman-ext.cn-north-4.myhuaweicloud.com',
        CODEARTS_REQ_AK: '<你的Access Key Id>',
        CODEARTS_REQ_SK: '<你的Secret Access Key>',
      },
      disabled: false,
      timeout: 10000,
    },
  },
};
console.log('把下面的内容粘贴到码道「设置 → MCP 工具 → 配置 MCP」打开的 mcp_settings.json，替换 AK/SK 后 Ctrl+S 保存：\n');
console.log(JSON.stringify(config, null, 2));
