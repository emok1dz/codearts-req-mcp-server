// 工具定义：名字（动词_名词）× 描述（何时用/做什么/返回什么）× 参数 Schema × 错误处理。
// Schema 以《需求管理 CodeArts Req API 参考》4.4.4 CreateProjectV4、4.4.5 ListProjectsV4 为事实来源。
import { callApi, loadConfig, ReqError } from './req-client.mjs';

export const PROJECT_TYPES = ['scrum', 'normal', 'xboard', 'basic', 'phoenix', 'ipd'];
export const LIST_PROJECT_TYPES = ['scrum', 'normal', 'xboard'];
export const IPD_TEMPLATES = { 10001: 'IPD-系统设备类', 10002: 'IPD-独立软件类', 10003: 'IPD-自运营软件/云服务类' };
export const QUERY_TYPES = ['domain_projects', 'absent'];
const SORT_RE = /^(name|author_name|created_on|memcount):(asc|desc)$/i;

export const TOOLS = [
  {
    name: 'create_project',
    title: '创建 CodeArts 需求管理项目',
    description: [
      '在华为云 CodeArts 需求管理（CodeArts Req）中创建一个新项目（API: CreateProjectV4，POST /v4/project）。',
      '何时使用：用户明确要求“新建/创建一个项目”时调用；只是查看已有项目请用 list_projects。',
      '注意：这是写操作，会真实创建项目；同一账号下项目名称不能重复，创建前可先用 list_projects 的 search 检查是否已存在。',
      'project_type 为 ipd 时必须同时传 template_id。',
      '返回：project_id（项目 UUID，后续接口常用）、project_num_id、project_name、project_type、description、user_num_id（创建者数字 ID）。',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        project_name: { type: 'string', minLength: 1, maxLength: 128, description: '项目名称，1~128 个字符，例如 "TestDemo"。' },
        project_type: {
          type: 'string',
          enum: PROJECT_TYPES,
          description: '项目类型：scrum=Scrum 项目，normal=普通项目，xboard=看板项目，basic=基础项目，phoenix=凤凰项目，ipd=IPD 项目（需传 template_id）。用户没有特别说明时一般用 scrum。',
        },
        description: { type: 'string', description: '项目描述，选填。' },
        enterprise_id: { type: 'string', description: '要绑定的企业项目 ID，选填；不清楚时不要传。' },
        source: { type: 'string', maxLength: 64, description: '项目来源，选填，0~64 个字符。' },
        template_id: {
          type: 'integer',
          enum: [10001, 10002, 10003],
          description: 'IPD 项目模板 ID，仅 project_type=ipd 时使用且必传：10001=IPD-系统设备类，10002=IPD-独立软件类，10003=IPD-自运营软件/云服务类。',
        },
      },
      required: ['project_name', 'project_type'],
      additionalProperties: false,
    },
    annotations: { title: '创建项目', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
  {
    name: 'list_projects',
    title: '查询 CodeArts 需求管理项目列表',
    description: [
      '分页查询华为云 CodeArts 需求管理（CodeArts Req）中当前用户可见的项目列表（API: ListProjectsV4，GET /v4/projects）。',
      '何时使用：用户想“看看/查询/列出我的项目”、按名称搜索项目、获取某项目的 project_id、或创建项目前检查重名时调用。只读，不会修改任何数据。',
      '分页：offset 必须是 limit 的整数倍（例如 limit=10 时 offset 取 0、10、20…）。',
      '返回：total（项目总数）、projects 数组（project_id、project_num_id、project_name、description、project_type、created_time、updated_time、creator），以及 offset/limit/has_more 便于翻页。',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        offset: { type: 'integer', minimum: 0, maximum: 10000, default: 0, description: '分页起始位置，默认 0，取值 0~10000，必须是 limit 的整数倍。' },
        limit: { type: 'integer', minimum: 1, maximum: 1000, default: 10, description: '每页条数，默认 10，取值 1~1000。' },
        search: { type: 'string', description: '按项目名称或描述模糊搜索，不支持通配符。' },
        project_type: { type: 'string', enum: LIST_PROJECT_TYPES, description: '按项目类型过滤：scrum / normal / xboard。' },
        sort: {
          type: 'string',
          pattern: '^((name|author_name|created_on|memcount):(asc|desc|ASC|DESC))(,(name|author_name|created_on|memcount):(asc|desc|ASC|DESC)){0,3}$',
          description: '排序条件，格式“字段:方向”，多组用英文逗号分隔，最多 4 组。字段可选 name、author_name、created_on、memcount，方向 asc/desc。例如 "created_on:desc,name:asc"。默认按创建时间降序。',
        },
        archive: { type: 'boolean', description: '是否查询已归档项目：true=归档项目，false=未归档项目；不传则使用服务端默认。' },
        query_type: {
          type: 'string',
          enum: QUERY_TYPES,
          description: '查询范围：domain_projects=租户下所有项目，absent=当前用户未参与的租户项目；不传则只查当前用户参与的项目。',
        },
      },
      additionalProperties: false,
    },
    annotations: { title: '查询项目列表', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
];

// ---------------------------------------------------------------- 参数校验

const isInt = (v) => Number.isInteger(v);

/** 校验 create_project 参数，返回规范化后的请求体；不合法时抛 INVALID_ARGUMENTS */
export function validateCreateProject(args = {}) {
  const errors = [];
  const allowed = new Set(Object.keys(TOOLS[0].inputSchema.properties));
  for (const k of Object.keys(args)) if (!allowed.has(k)) errors.push(`不支持的参数 ${k}`);

  const name = typeof args.project_name === 'string' ? args.project_name.trim() : args.project_name;
  if (typeof name !== 'string' || name.length === 0) errors.push('project_name 必填，且为非空字符串');
  else if (name.length > 128) errors.push(`project_name 长度不能超过 128 个字符（当前 ${name.length}）`);

  if (!PROJECT_TYPES.includes(args.project_type)) errors.push(`project_type 必填，取值只能是 ${PROJECT_TYPES.join(' / ')}（收到 ${JSON.stringify(args.project_type)}）`);

  for (const k of ['description', 'enterprise_id', 'source']) {
    if (args[k] !== undefined && typeof args[k] !== 'string') errors.push(`${k} 必须是字符串`);
  }
  if (typeof args.source === 'string' && args.source.length > 64) errors.push('source 长度不能超过 64 个字符');

  let templateId = args.template_id;
  if (typeof templateId === 'string' && /^\d+$/.test(templateId)) templateId = Number(templateId);
  if (templateId !== undefined && !(templateId in IPD_TEMPLATES)) errors.push('template_id 只能是 10001 / 10002 / 10003');
  if (args.project_type === 'ipd' && templateId === undefined) errors.push('project_type 为 ipd 时必须传 template_id（10001 / 10002 / 10003）');
  if (args.project_type && args.project_type !== 'ipd' && templateId !== undefined) errors.push('template_id 仅在 project_type=ipd 时使用');

  if (errors.length) throw invalid(errors);
  const body = { project_name: name, project_type: args.project_type };
  for (const k of ['description', 'enterprise_id', 'source']) if (args[k] !== undefined && args[k] !== '') body[k] = args[k];
  if (templateId !== undefined) body.template_id = templateId;
  return body;
}

/** 校验 list_projects 参数，返回查询参数；不合法时抛 INVALID_ARGUMENTS */
export function validateListProjects(args = {}) {
  const errors = [];
  const allowed = new Set(Object.keys(TOOLS[1].inputSchema.properties));
  for (const k of Object.keys(args)) if (!allowed.has(k)) errors.push(`不支持的参数 ${k}`);

  const offset = args.offset ?? 0;
  const limit = args.limit ?? 10;
  if (!isInt(limit) || limit < 1 || limit > 1000) errors.push(`limit 必须是 1~1000 的整数（收到 ${JSON.stringify(args.limit)}）`);
  if (!isInt(offset) || offset < 0 || offset > 10000) errors.push(`offset 必须是 0~10000 的整数（收到 ${JSON.stringify(args.offset)}）`);
  else if (isInt(limit) && limit > 0 && offset % limit !== 0) errors.push(`offset 必须是 limit 的整数倍（offset=${offset}, limit=${limit}），例如 ${Math.floor(offset / limit) * limit}`);

  if (args.search !== undefined && typeof args.search !== 'string') errors.push('search 必须是字符串');
  if (args.project_type !== undefined && !LIST_PROJECT_TYPES.includes(args.project_type)) errors.push(`project_type 只能是 ${LIST_PROJECT_TYPES.join(' / ')}`);
  if (args.archive !== undefined && typeof args.archive !== 'boolean') errors.push('archive 必须是布尔值 true / false');
  if (args.query_type !== undefined && !QUERY_TYPES.includes(args.query_type)) errors.push(`query_type 只能是 ${QUERY_TYPES.join(' / ')}`);

  let sort;
  if (args.sort !== undefined && args.sort !== '') {
    if (typeof args.sort !== 'string') errors.push('sort 必须是字符串');
    else {
      const groups = args.sort.split(',').map((s) => s.trim());
      if (groups.length > 4) errors.push('sort 最多 4 组排序条件');
      const bad = groups.filter((g) => !SORT_RE.test(g));
      if (bad.length) errors.push(`sort 格式错误：${bad.join(', ')}；应为“字段:方向”，字段 name/author_name/created_on/memcount，方向 asc/desc`);
      sort = groups.join(',');
    }
  }

  if (errors.length) throw invalid(errors);
  const query = { offset, limit };
  if (args.search) query.search = args.search;
  if (args.project_type) query.project_type = args.project_type;
  if (sort) query.sort = sort;
  if (args.archive !== undefined) query.archive = args.archive;
  if (args.query_type) query.query_type = args.query_type;
  return query;
}

function invalid(errors) {
  return new ReqError('INVALID_ARGUMENTS', `参数校验失败：${errors.join('；')}`, { errors });
}

// ---------------------------------------------------------------- 处理函数

const fmtTime = (ms) => (typeof ms === 'number' ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : ms);

export async function createProject(args, deps = {}) {
  const body = validateCreateProject(args); // 先校验参数，再读配置
  const config = deps.config || loadConfig(deps.env);
  const data = await callApi(config, { method: 'POST', path: '/v4/project', body }, deps);
  const result = {
    project_id: data.project_id,
    project_num_id: data.project_num_id,
    project_name: data.project_name,
    project_type: data.project_type,
    description: data.description ?? body.description ?? '',
    user_num_id: data.user_num_id,
  };
  return { summary: `项目「${result.project_name}」创建成功，project_id = ${result.project_id}（类型 ${result.project_type}）。`, data: result };
}

export async function listProjects(args, deps = {}) {
  const query = validateListProjects(args);
  const config = deps.config || loadConfig(deps.env);
  const data = await callApi(config, { method: 'GET', path: '/v4/projects', query }, deps);
  const projects = (data.projects || []).map((p) => ({
    project_id: p.project_id,
    project_num_id: p.project_num_id,
    project_name: p.project_name,
    description: p.description ?? '',
    project_type: p.project_type,
    created_time: fmtTime(p.created_time),
    updated_time: fmtTime(p.updated_time),
    creator: p.creator ? { user_name: p.creator.user_name, nick_name: p.creator.nick_name, user_num_id: p.creator.user_num_id } : undefined,
  }));
  const total = data.total ?? projects.length;
  const result = { total, offset: query.offset, limit: query.limit, returned: projects.length, has_more: query.offset + projects.length < total, projects };
  const names = projects.slice(0, 10).map((p) => p.project_name).join('、');
  const summary = total === 0
    ? '没有查询到项目。'
    : `共 ${total} 个项目，本页返回第 ${query.offset + 1}~${query.offset + projects.length} 个${names ? `：${names}${projects.length > 10 ? ' 等' : ''}` : ''}。`;
  return { summary, data: result };
}

export const HANDLERS = { create_project: createProject, list_projects: listProjects };

// ---------------------------------------------------------------- MCP 结果封装

/** 成功：一段中文摘要 + JSON 详情；同时给出 structuredContent 便于程序化读取 */
export function toSuccessResult({ summary, data }) {
  return {
    content: [{ type: 'text', text: `${summary}\n\n${JSON.stringify(data, null, 2)}` }],
    structuredContent: data,
  };
}

/** 失败：isError=true 的结构化中文错误，绝不抛出到协议层导致客户端看不到原因 */
export function toErrorResult(err) {
  const known = err instanceof ReqError;
  const error = known
    ? { code: err.code, message: err.message, ...err.details }
    : { code: 'INTERNAL_ERROR', message: `服务内部错误：${err?.message || err}` };
  return {
    isError: true,
    content: [{ type: 'text', text: `【${error.code}】${error.message}\n\n${JSON.stringify({ error }, null, 2)}` }],
    structuredContent: { error },
  };
}

/** 统一入口：未知工具 / 参数错误 / 配置缺失 / 接口错误 / 网络异常 全部转成结构化结果 */
export async function runTool(name, args, deps = {}) {
  const handler = HANDLERS[name];
  if (!handler) {
    return toErrorResult(new ReqError('INVALID_ARGUMENTS', `未知工具 ${name}，可用工具：${Object.keys(HANDLERS).join(', ')}`, { errors: [`unknown tool ${name}`] }));
  }
  try {
    return toSuccessResult(await handler(args ?? {}, deps));
  } catch (err) {
    return toErrorResult(err);
  }
}
