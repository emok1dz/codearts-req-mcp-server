import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { loadConfig, ReqError } from '../lib/req-client.mjs';
import { runTool, TOOLS, validateCreateProject, validateListProjects } from '../lib/tools.mjs';

const ENV = { CODEARTS_REQ_ENDPOINT: 'https://projectman-ext.cn-north-4.myhuaweicloud.com', CODEARTS_REQ_AK: 'AK123', CODEARTS_REQ_SK: 'SK456' };

/** 记录请求并返回预设响应的假 fetch */
function fakeFetch(status, body, { raw = false } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, ...init });
    return new Response(raw ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  fn.calls = calls;
  return fn;
}

const errorOf = (r) => r.structuredContent.error;

describe('工具定义（四要素）', () => {
  test('工具名为 动词_名词 的 snake_case', () => {
    assert.deepEqual(TOOLS.map((t) => t.name), ['create_project', 'list_projects']);
    for (const t of TOOLS) assert.match(t.name, /^[a-z]+_[a-z_]+$/);
  });
  test('描述说明了何时使用、对应 API 与返回内容', () => {
    for (const t of TOOLS) {
      assert.match(t.description, /何时使用/);
      assert.match(t.description, /返回/);
      assert.match(t.description, /\/v4\/project/);
    }
  });
  test('Schema：create_project 必填 project_name/project_type，枚举与长度约束齐全', () => {
    const s = TOOLS[0].inputSchema;
    assert.deepEqual(s.required, ['project_name', 'project_type']);
    assert.deepEqual(s.properties.project_type.enum, ['scrum', 'normal', 'xboard', 'basic', 'phoenix', 'ipd']);
    assert.deepEqual(s.properties.template_id.enum, [10001, 10002, 10003]);
    assert.equal(s.properties.project_name.maxLength, 128);
    assert.equal(s.properties.source.maxLength, 64);
    for (const [k, p] of Object.entries(s.properties)) assert.ok(p.description, `${k} 缺少描述`);
  });
  test('Schema：list_projects 分页范围与枚举', () => {
    const p = TOOLS[1].inputSchema.properties;
    assert.equal(p.limit.minimum, 1);
    assert.equal(p.limit.maximum, 1000);
    assert.equal(p.offset.maximum, 10000);
    assert.deepEqual(p.project_type.enum, ['scrum', 'normal', 'xboard']);
    assert.deepEqual(p.query_type.enum, ['domain_projects', 'absent']);
    assert.ok(new RegExp(p.sort.pattern).test('created_on:desc,name:asc'));
    assert.ok(!new RegExp(p.sort.pattern).test('foo:desc'));
  });
  test('annotations 标明只读/写操作', () => {
    assert.equal(TOOLS[0].annotations.readOnlyHint, false);
    assert.equal(TOOLS[1].annotations.readOnlyHint, true);
  });
});

describe('参数校验 create_project', () => {
  test('最小合法参数', () => {
    assert.deepEqual(validateCreateProject({ project_name: ' TestDemo ', project_type: 'scrum' }), { project_name: 'TestDemo', project_type: 'scrum' });
  });
  test('选填字段透传', () => {
    const body = validateCreateProject({ project_name: 'a', project_type: 'normal', description: 'd', enterprise_id: 'e', source: 's' });
    assert.deepEqual(body, { project_name: 'a', project_type: 'normal', description: 'd', enterprise_id: 'e', source: 's' });
  });
  const bad = [
    ['缺少 project_name', { project_type: 'scrum' }, /project_name 必填/],
    ['空 project_name', { project_name: '  ', project_type: 'scrum' }, /project_name 必填/],
    ['project_name 超长', { project_name: 'x'.repeat(129), project_type: 'scrum' }, /128/],
    ['缺少 project_type', { project_name: 'a' }, /project_type 必填/],
    ['project_type 非法', { project_name: 'a', project_type: 'agile' }, /project_type/],
    ['ipd 缺 template_id', { project_name: 'a', project_type: 'ipd' }, /必须传 template_id/],
    ['template_id 非法', { project_name: 'a', project_type: 'ipd', template_id: 123 }, /10001/],
    ['非 ipd 传 template_id', { project_name: 'a', project_type: 'scrum', template_id: 10001 }, /仅在 project_type=ipd/],
    ['source 超长', { project_name: 'a', project_type: 'scrum', source: 'x'.repeat(65) }, /source/],
    ['description 类型错误', { project_name: 'a', project_type: 'scrum', description: 1 }, /description/],
    ['未知参数', { project_name: 'a', project_type: 'scrum', foo: 1 }, /不支持的参数 foo/],
  ];
  for (const [name, args, re] of bad) {
    test(name, () => {
      assert.throws(() => validateCreateProject(args), (e) => e instanceof ReqError && e.code === 'INVALID_ARGUMENTS' && re.test(e.message));
    });
  }
  test('ipd + template_id 合法（字符串数字也接受）', () => {
    assert.equal(validateCreateProject({ project_name: 'a', project_type: 'ipd', template_id: '10002' }).template_id, 10002);
  });
});

describe('参数校验 list_projects', () => {
  test('默认值 offset=0 limit=10', () => {
    assert.deepEqual(validateListProjects({}), { offset: 0, limit: 10 });
  });
  test('全部参数', () => {
    const q = validateListProjects({ offset: 20, limit: 10, search: 'demo', project_type: 'scrum', sort: 'created_on:desc, name:asc', archive: false, query_type: 'domain_projects' });
    assert.deepEqual(q, { offset: 20, limit: 10, search: 'demo', project_type: 'scrum', sort: 'created_on:desc,name:asc', archive: false, query_type: 'domain_projects' });
  });
  const bad = [
    ['offset 不是 limit 整数倍', { offset: 5, limit: 10 }, /整数倍/],
    ['limit 为 0', { limit: 0 }, /limit/],
    ['limit 超过 1000', { limit: 1001 }, /limit/],
    ['limit 非整数', { limit: 2.5 }, /limit/],
    ['offset 负数', { offset: -10 }, /offset/],
    ['offset 超过 10000', { offset: 10010, limit: 10 }, /offset/],
    ['project_type 不支持 ipd', { project_type: 'ipd' }, /project_type/],
    ['sort 字段非法', { sort: 'title:desc' }, /sort 格式错误/],
    ['sort 方向非法', { sort: 'name:up' }, /sort 格式错误/],
    ['sort 超过 4 组', { sort: 'name:asc,memcount:asc,created_on:asc,author_name:asc,name:desc' }, /最多 4 组/],
    ['archive 非布尔', { archive: 'yes' }, /archive/],
    ['query_type 非法', { query_type: 'all' }, /query_type/],
  ];
  for (const [name, args, re] of bad) {
    test(name, () => {
      assert.throws(() => validateListProjects(args), (e) => e.code === 'INVALID_ARGUMENTS' && re.test(e.message));
    });
  }
});

describe('配置读取', () => {
  test('缺少配置返回 MISSING_CONFIG 并列出缺失项', () => {
    assert.throws(() => loadConfig({}), (e) => e.code === 'MISSING_CONFIG' && e.details.missing.length === 3);
  });
  test('占位符 <你的AK> 视为未配置', () => {
    assert.throws(() => loadConfig({ ...ENV, CODEARTS_REQ_AK: '<你的Access Key Id>' }), (e) => e.details.missing.includes('CODEARTS_REQ_AK'));
  });
  test('只配置 REGION 时自动拼终端节点；去掉末尾斜杠', () => {
    assert.equal(loadConfig({ ...ENV, CODEARTS_REQ_ENDPOINT: '', CODEARTS_REQ_REGION: 'cn-east-3' }).endpoint, 'https://projectman-ext.cn-east-3.myhuaweicloud.com');
    assert.equal(loadConfig({ ...ENV, CODEARTS_REQ_ENDPOINT: 'projectman-ext.cn-north-4.myhuaweicloud.com/' }).endpoint, 'https://projectman-ext.cn-north-4.myhuaweicloud.com');
  });
});

describe('create_project 调用', () => {
  test('构造 POST /v4/project 请求并带签名头', async () => {
    const fetch = fakeFetch(200, { project_id: 'p1', project_num_id: 1, project_name: 'TestDemo', project_type: 'scrum', description: 'modify testxxxxx', user_num_id: 9 });
    const r = await runTool('create_project', { project_name: 'TestDemo', project_type: 'scrum', description: 'modify testxxxxx' }, { env: ENV, fetch });
    assert.equal(r.isError, undefined);
    assert.equal(r.structuredContent.project_id, 'p1');
    assert.match(r.content[0].text, /创建成功，project_id = p1/);
    const call = fetch.calls[0];
    assert.equal(call.method, 'POST');
    assert.equal(call.url, 'https://projectman-ext.cn-north-4.myhuaweicloud.com/v4/project');
    assert.deepEqual(JSON.parse(call.body), { project_name: 'TestDemo', project_type: 'scrum', description: 'modify testxxxxx' });
    assert.match(call.headers.Authorization, /^SDK-HMAC-SHA256 Access=AK123, SignedHeaders=content-type;host;x-sdk-date, Signature=[0-9a-f]{64}$/);
    assert.match(call.headers['X-Sdk-Date'], /^\d{8}T\d{6}Z$/);
  });
  test('参数非法时不发请求', async () => {
    const fetch = fakeFetch(200, {});
    const r = await runTool('create_project', { project_name: 'a', project_type: 'ipd' }, { env: ENV, fetch });
    assert.equal(r.isError, true);
    assert.equal(errorOf(r).code, 'INVALID_ARGUMENTS');
    assert.equal(fetch.calls.length, 0);
  });
  test('缺配置返回 MISSING_CONFIG', async () => {
    const r = await runTool('create_project', { project_name: 'a', project_type: 'scrum' }, { env: {}, fetch: fakeFetch(200, {}) });
    assert.equal(errorOf(r).code, 'MISSING_CONFIG');
  });
  test('API 400 透传 error_code / error_msg / http_status', async () => {
    const r = await runTool('create_project', { project_name: 'a', project_type: 'scrum' }, { env: ENV, fetch: fakeFetch(400, { error_code: 'PM.00000001', error_msg: 'param error' }) });
    assert.equal(r.isError, true);
    assert.deepEqual(
      { code: errorOf(r).code, http_status: errorOf(r).http_status, error_code: errorOf(r).error_code, error_msg: errorOf(r).error_msg },
      { code: 'API_ERROR', http_status: 400, error_code: 'PM.00000001', error_msg: 'param error' },
    );
  });
  test('API 401 带 request_id 与鉴权提示', async () => {
    const r = await runTool('create_project', { project_name: 'a', project_type: 'scrum' }, { env: ENV, fetch: fakeFetch(401, { error_code: 'APIGW.0301', error_msg: 'Incorrect IAM authentication information', request_id: 'rid' }) });
    assert.equal(errorOf(r).request_id, 'rid');
    assert.match(errorOf(r).hint, /AK\/SK/);
  });
  test('非 JSON 错误响应也能返回可读信息', async () => {
    const r = await runTool('create_project', { project_name: 'a', project_type: 'scrum' }, { env: ENV, fetch: fakeFetch(502, '<html>Bad Gateway</html>', { raw: true }) });
    assert.equal(errorOf(r).code, 'API_ERROR');
    assert.equal(errorOf(r).http_status, 502);
    assert.match(errorOf(r).error_msg, /Bad Gateway/);
  });
  test('网络异常返回 NETWORK_ERROR', async () => {
    const fetch = async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    };
    const r = await runTool('create_project', { project_name: 'a', project_type: 'scrum' }, { env: ENV, fetch });
    assert.equal(errorOf(r).code, 'NETWORK_ERROR');
    assert.match(errorOf(r).message, /ENOTFOUND/);
  });
  test('请求超时返回 NETWORK_ERROR', async () => {
    const fetch = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const r = await runTool('create_project', { project_name: 'a', project_type: 'scrum' }, { env: { ...ENV, CODEARTS_REQ_TIMEOUT_MS: '30' }, fetch });
    assert.equal(errorOf(r).code, 'NETWORK_ERROR');
    assert.match(errorOf(r).message, /超时/);
  });
});

describe('list_projects 调用', () => {
  const sample = {
    total: 12,
    projects: [{ project_num_id: 3183801, project_id: '41bd', project_name: 'demo_project', description: 'demo', created_time: 1576114296000, updated_time: 1576114296000, project_type: 'xboard', creator: { user_num_id: 4097, user_name: 'mobile_user', nick_name: 'Tom' } }],
  };
  test('构造 GET /v4/projects 查询串（与签名一致的 RFC3986 编码）', async () => {
    const fetch = fakeFetch(200, sample);
    await runTool('list_projects', { offset: 10, limit: 10, search: 'demo 项目', sort: 'created_on:desc', archive: true }, { env: ENV, fetch });
    const call = fetch.calls[0];
    assert.equal(call.method, 'GET');
    assert.equal(call.body, undefined);
    assert.equal(
      call.url,
      'https://projectman-ext.cn-north-4.myhuaweicloud.com/v4/projects?archive=true&limit=10&offset=10&search=demo%20%E9%A1%B9%E7%9B%AE&sort=created_on%3Adesc',
    );
  });
  test('返回 total、分页信息与精简后的项目字段', async () => {
    const r = await runTool('list_projects', { limit: 1 }, { env: ENV, fetch: fakeFetch(200, sample) });
    const d = r.structuredContent;
    assert.equal(d.total, 12);
    assert.equal(d.has_more, true);
    assert.equal(d.projects[0].project_id, '41bd');
    assert.equal(d.projects[0].created_time, '2019-12-12 01:31:36 UTC');
    assert.equal(d.projects[0].creator.user_name, 'mobile_user');
    assert.match(r.content[0].text, /共 12 个项目.*demo_project/);
  });
  test('空列表', async () => {
    const r = await runTool('list_projects', {}, { env: ENV, fetch: fakeFetch(200, { total: 0, projects: [] }) });
    assert.match(r.content[0].text, /没有查询到项目/);
    assert.equal(r.structuredContent.has_more, false);
  });
  test('API 403 透传', async () => {
    const r = await runTool('list_projects', {}, { env: ENV, fetch: fakeFetch(403, { error_code: 'PM.02175001', error_msg: 'no permission' }) });
    assert.equal(errorOf(r).http_status, 403);
    assert.equal(errorOf(r).error_code, 'PM.02175001');
  });
});

test('未知工具返回结构化错误', async () => {
  const r = await runTool('delete_project', {}, { env: ENV });
  assert.equal(r.isError, true);
  assert.equal(errorOf(r).code, 'INVALID_ARGUMENTS');
});
