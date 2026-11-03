# MCP Builder：先描述，再生成

本项目按照 MCP Builder 的思路构建：先用自然语言把「要哪些工具、每个工具做什么、接受什么参数、出错怎么办」描述清楚，再交给码道智能体生成代码，最后人工对照 API 文档逐项核对、补充测试。

## 1. 工具清单（设计稿）

| 工具 | 何时使用 | API | 参数 | 返回 |
| --- | --- | --- | --- | --- |
| `create_project` | 用户要求新建项目 | `POST /v4/project` | `project_name` string 必填 1–128；`project_type` enum 必填 scrum/normal/xboard/basic/phoenix/ipd；`description`、`enterprise_id` 选填；`source` 选填 0–64；`template_id` enum 10001/10002/10003（ipd 时必传） | project_id、project_num_id、project_name、project_type、user_num_id |
| `list_projects` | 查看/搜索项目、取 project_id、创建前查重 | `GET /v4/projects` | `offset` 0–10000，默认 0，须为 limit 整数倍；`limit` 1–1000，默认 10；`search`；`project_type` scrum/normal/xboard；`sort` “字段:方向”，最多 4 组；`archive` boolean；`query_type` domain_projects/absent | projects[]、total |

错误约定：`INVALID_ARGUMENTS` / `MISSING_CONFIG` / `API_ERROR`（透传 error_code、error_msg、http_status）/ `NETWORK_ERROR`，全部为 `isError: true` 的中文结构化提示。

## 2. 交给码道智能体的提示词

```text
帮我用 Node.js 的标准 MCP SDK（@modelcontextprotocol/sdk）写一个本地 stdio 类型的 MCP Server，
服务名 codearts-req，封装华为云 CodeArts 需求管理 API（文档见《需求管理 CodeArts Req API参考》）。
终端节点从环境变量 CODEARTS_REQ_ENDPOINT 读取，访问密钥从 CODEARTS_REQ_AK 和 CODEARTS_REQ_SK 读取，
鉴权用 AK/SK 签名（SDK-HMAC-SHA256 算法，请求头 Authorization + X-Sdk-Date）。

暴露两个工具：
- create_project：创建项目，POST /v4/project。参数 project_name（string，必填，1-128 字符）、
  project_type（enum，必填：scrum/normal/xboard/basic/phoenix/ipd）、description（string，选填）、
  enterprise_id（string，选填）、source（string，选填，0-64 字符）、
  template_id（enum，选填：10001/10002/10003，project_type=ipd 时必传）。
  返回 project_id、project_num_id、project_name、project_type、user_num_id。

- list_projects：查询项目列表，GET /v4/projects。参数 offset（integer，选填，默认 0，0-10000，
  须为 limit 整数倍）、limit（integer，选填，默认 10，1-1000）、search（string，选填）、
  project_type（enum，选填：scrum/normal/xboard）、sort（string，选填，格式 字段:方向，最多 4 组）、
  archive（boolean，选填）、query_type（enum，选填：domain_projects/absent）。
  返回 projects 数组与 total。

- 错误处理：参数非法返回 INVALID_ARGUMENTS；缺配置返回 MISSING_CONFIG；API 报错透传
  error_code/error_msg/http_status；网络异常返回 NETWORK_ERROR。全部为 isError: true 的
  结构化中文提示，不静默吞错、不崩溃。

请生成完整的可运行代码 codearts-req-mcp-server/server.mjs，配套测试，并在 README 里写清
安装依赖、环境变量、启动命令与码道配置。
```

## 3. 生成后的人工加固

- **签名正确性**：用华为云官方 Python SDK（`huaweicloudsdkcore.signer.Signer`）对相同请求计算签名，作为测试期望值（`test/signer.test.mjs`）。
- **发送内容与签名内容一致**：查询串按 RFC 3986 规范编码后再签名、再发送，避免出现空格编码成 `+` 导致签名不匹配。
- **先校验后请求**：参数校验不通过时不读取配置、也不发请求。
- **写操作提示**：在 `create_project` 的描述和 `annotations.readOnlyHint=false` 中注明这是写操作，提醒智能体不要随意调用。
- **可测试性**：`fetch` 和 `env` 通过依赖注入传入，测试不访问真实云服务。
