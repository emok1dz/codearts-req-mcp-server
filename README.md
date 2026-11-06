# CodeArts Req MCP Server

ICT 大赛实践赛题 **1.8「MCP-如何将华为云服务封装成 MCP Server」** 作品。

这是一个本地 **stdio** 类型的 MCP Server，基于官方 `@modelcontextprotocol/sdk`（Node.js）。它把华为云 **CodeArts 需求管理（CodeArts Req）** 的两个真实 API 封装成智能体可以直接调用的工具：

| 工具 | 对应 API | 说明 |
| --- | --- | --- |
| `create_project` | CreateProjectV4 · `POST /v4/project` | 创建项目（写操作） |
| `list_projects` | ListProjectsV4 · `GET /v4/projects` | 分页查询项目列表（只读） |

鉴权方式为华为云 **AK/SK 签名**（`SDK-HMAC-SHA256`，请求头 `Authorization` + `X-Sdk-Date`）。签名算法由测试保证与华为云官方 SDK 逐字节一致。

---

## 一、MCP、Rule、Skill 的分工

| 对比维度 | 规则（Rule） | 技能（Skill） | MCP Server（本项目） |
| --- | --- | --- | --- |
| 定义 | 约束智能体的行为方式 | 描述如何完成特定任务 | 提供外部工具的调用能力 |
| 加载方式 | 对话开始时加载，持续参与推理 | 按需加载 | 不参与推理，按需调用外部接口 |
| 解决的问题 | “应该怎么做”（边界） | “怎么完成任务”（流程） | “能动手”（执行能力） |

## 二、写好 MCP Server 的四要素在本项目中的落地

| 要素 | 本项目的做法 | 代码位置 |
| --- | --- | --- |
| **名字** | `动词_名词` 的 snake_case：`create_project`、`list_projects` | `lib/tools.mjs` → `TOOLS` |
| **描述** | 每个工具都写清对应的 API、何时使用（查询还是创建）、注意事项（写操作、重名、ipd 需模板）和返回字段 | 同上 `description` |
| **参数 Schema** | 以 API 文档为事实来源的 JSON Schema：必填项、`enum`、长度和取值范围、`sort` 正则、每个字段都有中文说明，并设置 `additionalProperties: false`；`annotations` 标明只读/写 | 同上 `inputSchema` |
| **错误处理** | 所有失败都返回 `isError: true` 的中文结构化错误，不吞错、不崩溃（见下表） | `lib/tools.mjs` → `runTool` / `toErrorResult` |

错误码：

| code | 触发场景 | 附带信息 |
| --- | --- | --- |
| `INVALID_ARGUMENTS` | 参数非法，例如 `offset` 不是 `limit` 的整数倍、ipd 项目缺 `template_id`、枚举值越界、未知参数。**校验不通过时不会发出请求** | `errors[]` 逐条列出原因 |
| `MISSING_CONFIG` | 缺少 `CODEARTS_REQ_ENDPOINT` / `AK` / `SK`（未替换的 `<占位符>` 也算缺失） | `missing[]`、获取方式 `hint` |
| `API_ERROR` | 华为云接口返回非 2xx | 透传 `http_status`、`error_code`、`error_msg`、`request_id`，并按状态码给出 `hint` |
| `NETWORK_ERROR` | DNS/连接失败或超时（默认 15 秒） | `endpoint`、`hint` |

错误示例（假 AK/SK 调用真实接口得到的结果）：

```text
【API_ERROR】CodeArts Req 接口返回错误（HTTP 401）：Incorrect IAM authentication information: Unauthorized
{ "error": { "code": "API_ERROR", "http_status": 401, "error_code": "APIGW.0301", "request_id": "…",
             "hint": "鉴权失败：请确认 AK/SK 正确且未被禁用，并确认本机时间准确…" } }
```

## 三、目录结构

```
codearts-req-mcp-server/
├── server.mjs               # MCP Server 入口（stdio）：注册 tools/list、tools/call
├── lib/
│   ├── tools.mjs            # 工具定义（名字/描述/Schema）+ 参数校验 + 处理函数 + 错误封装
│   ├── req-client.mjs       # 读取环境变量配置、发送签名请求、归一化 HTTP/网络错误
│   └── signer.mjs           # 华为云 AK/SK 签名（SDK-HMAC-SHA256）
├── test/                    # node:test，共 61 个用例，全部注入假 fetch，不消耗真实云资源
│   ├── signer.test.mjs      #   签名：与华为云官方 Python SDK 的签名结果比对
│   ├── tools.test.mjs       #   四要素、参数校验、请求构造、成功/失败/网络异常/超时
│   └── server.test.mjs      #   MCP 协议层：initialize、tools/list、tools/call、stdio 启动
├── scripts/
│   ├── smoke.mjs            # 端到端自检：像码道一样以 stdio 拉起服务并调用工具
│   └── print-config.mjs     # 生成带本机绝对路径的码道 mcp_settings.json 配置
├── docs/mcp-builder-prompt.md  # MCP Builder：先用自然语言描述工具，再生成代码
├── mcp_settings.example.json
└── package.json
```

## 四、安装与自测（实验手册 3.4）

需要 Node.js 18 或更高版本。

```bash
cd codearts-req-mcp-server
npm install --registry=https://registry.npmmirror.com
npm test
```

预期输出：

```
# tests 61
# pass 61
# fail 0
```

确认 stdio 服务能正常启动：

```bash
npm start
# [codearts-req] MCP Server v1.0.0 已启动（stdio），等待客户端连接…   ← 输出到 stderr，按 Ctrl+C 退出
```

端到端自检（不依赖码道，走完整 MCP 协议）：

```bash
npm run smoke                        # 没有配置凭证：会看到 MISSING_CONFIG 结构化错误
# 配置凭证后（PowerShell 示例）：
$env:CODEARTS_REQ_ENDPOINT="https://projectman-ext.cn-north-4.myhuaweicloud.com"
$env:CODEARTS_REQ_AK="你的AK"; $env:CODEARTS_REQ_SK="你的SK"
npm run smoke                        # 列出工具并查询项目列表（只读）
npm run smoke -- --create TestDemo   # 额外创建一个 scrum 项目
```

## 五、获取 AK/SK（实验手册 2.2）

华为云控制台 → 右上角用户名 → **我的凭证** → **访问密钥** → **新增访问密钥**，然后下载 `credentials.csv`，里面有 Access Key Id（AK）和 Secret Access Key（SK）。SK 只在创建时显示一次。

> AK/SK 只写在码道配置的 `env` 里，**不要写进代码、也不要提交到仓库**（`.gitignore` 已排除 `.env`）。

## 六、配置到码道（实验手册 3.5）

操作路径：码道右上角 **设置 → MCP 工具 → 配置 MCP**。在打开的 `mcp_settings.json` 中粘贴下面的配置，然后按 `Ctrl+S` 保存。

运行 `npm run config` 可以直接打印出**已经填好本机绝对路径**的配置。也可以手动改 [`mcp_settings.example.json`](mcp_settings.example.json)：

```json
{
  "mcpServers": {
    "codearts-req": {
      "command": "node",
      "args": ["D:/改成你的路径/codearts-req-mcp-server/server.mjs"],
      "env": {
        "CODEARTS_REQ_ENDPOINT": "https://projectman-ext.cn-north-4.myhuaweicloud.com",
        "CODEARTS_REQ_AK": "<你的Access Key Id>",
        "CODEARTS_REQ_SK": "<你的Secret Access Key>"
      },
      "disabled": false,
      "timeout": 10000
    }
  }
}
```

| 环境变量 | 必填 | 说明 |
| --- | --- | --- |
| `CODEARTS_REQ_ENDPOINT` | 是* | 需求管理终端节点，须与开通 CodeArts 的区域一致，如北京四 `https://projectman-ext.cn-north-4.myhuaweicloud.com`、上海一 `https://projectman-ext.cn-east-3.myhuaweicloud.com`（其他区域见 API 文档 1.2 节：cn-north-1、cn-east-3、cn-south-1 等） |
| `CODEARTS_REQ_REGION` | 否 | 可以代替 ENDPOINT，例如 `cn-east-3`，程序会自动拼出终端节点 |
| `CODEARTS_REQ_AK` | 是 | Access Key Id |
| `CODEARTS_REQ_SK` | 是 | Secret Access Key |
| `CODEARTS_REQ_TIMEOUT_MS` | 否 | 请求超时，默认 15000 |

保存后，在 MCP 工具列表中能看到 `codearts-req` 处于启用状态，并包含 `create_project`、`list_projects` 两个工具。

## 七、验证调用（实验手册 3.6）

在码道输入框下方选择「内置 > 智能体」，输入：

```text
用 codearts-req 的工具先查询我的项目列表；再帮我创建一个名为 "TestDemo" 的 scrum 项目，
描述写 "modify testxxxxx"，创建完成后把新项目的 project_id 告诉我。
```

预期结果：
- 智能体先调用 `list_projects`，返回项目总数和列表；
- 再调用 `create_project`，参数为 `{"project_name":"TestDemo","project_type":"scrum","description":"modify testxxxxx"}`；
- 最后回复新项目的 `project_id`。

之后到 [CodeArts 需求管理控制台](https://devcloud.cn-north-4.huaweicloud.com/home) 确认项目确实已经创建。

> 如果提示项目名已存在，可以换一个名字（例如 `TestDemo-2`），或者先用 `list_projects` 的 `search` 参数查一下。

## 八、常见问题

| 现象 | 处理 |
| --- | --- |
| `MISSING_CONFIG` | `env` 里的 AK/SK 仍是 `<…>` 占位符，或变量名拼错；修改后保存，再重启 MCP 服务 |
| `API_ERROR` 401 `APIGW.0301` | AK/SK 不正确、已删除或已停用；或者本机时间与标准时间相差超过 15 分钟 |
| `API_ERROR` 403 | 账号未开通 CodeArts，或 IAM 子用户没有权限 |
| `NETWORK_ERROR` | 检查网络和代理设置；确认终端节点区域与账号开通的区域一致 |
| 码道中服务状态显示红色 | `args` 中的路径错误（Windows 路径建议用 `/`），或者没有执行 `npm install` |
