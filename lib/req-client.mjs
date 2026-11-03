// CodeArts 需求管理（projectman）API 客户端：负责读配置、签名、发请求、归一化错误。
import { canonicalQuery, signRequest } from './signer.mjs';

/** 统一的业务异常，code 取值见 README「错误处理」 */
export class ReqError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ReqError';
    this.code = code;
    this.details = details;
  }
}

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * 从环境变量读取配置。缺少必填项时抛出 MISSING_CONFIG。
 * CODEARTS_REQ_ENDPOINT 未设置但设置了 CODEARTS_REQ_REGION 时，按区域拼出终端节点。
 */
export function loadConfig(env = process.env) {
  let endpoint = (env.CODEARTS_REQ_ENDPOINT || '').trim();
  const region = (env.CODEARTS_REQ_REGION || '').trim();
  if (!endpoint && region) endpoint = `https://projectman-ext.${region}.myhuaweicloud.com`;
  const ak = (env.CODEARTS_REQ_AK || '').trim();
  const sk = (env.CODEARTS_REQ_SK || '').trim();

  const missing = [];
  if (!endpoint) missing.push('CODEARTS_REQ_ENDPOINT');
  if (!ak || ak.startsWith('<')) missing.push('CODEARTS_REQ_AK');
  if (!sk || sk.startsWith('<')) missing.push('CODEARTS_REQ_SK');
  if (missing.length) {
    throw new ReqError('MISSING_CONFIG', `缺少必要配置：${missing.join('、')}。请在码道 mcp_settings.json 的 env 中填写后重启 MCP 服务。`, {
      missing,
      hint: 'AK/SK 获取：华为云控制台 → 我的凭证 → 访问密钥 → 新增访问密钥；终端节点如 https://projectman-ext.cn-north-4.myhuaweicloud.com',
    });
  }
  if (!/^https?:\/\//i.test(endpoint)) endpoint = `https://${endpoint}`;
  try {
    new URL(endpoint);
  } catch {
    throw new ReqError('MISSING_CONFIG', `CODEARTS_REQ_ENDPOINT 不是合法的 URL：${endpoint}`, { missing: [] });
  }
  const timeoutMs = Number(env.CODEARTS_REQ_TIMEOUT_MS) > 0 ? Number(env.CODEARTS_REQ_TIMEOUT_MS) : DEFAULT_TIMEOUT_MS;
  return { endpoint: endpoint.replace(/\/+$/, ''), ak, sk, timeoutMs };
}

const STATUS_HINTS = {
  400: '请求参数被服务端拒绝，请检查参数取值（例如项目名称是否重复、ipd 项目是否传了 template_id）。',
  401: '鉴权失败：请确认 AK/SK 正确且未被禁用，并确认本机时间准确（签名时间与服务器相差超过 15 分钟会被拒绝）。',
  403: '没有权限：请确认账号已开通 CodeArts 需求管理，且该 IAM 用户有对应权限。',
  404: '接口不存在：请确认 CODEARTS_REQ_ENDPOINT 是需求管理（projectman-ext）的终端节点。',
  429: '请求过于频繁，请稍后重试。',
};

/**
 * 发送一个签名请求。
 * @param {object} config loadConfig() 的返回值
 * @param {{method:string, path:string, query?:Record<string,any>, body?:object}} req
 * @param {{fetch?: typeof fetch, now?: () => Date}} deps 依赖注入，测试时替换 fetch
 */
export async function callApi(config, { method, path, query, body }, deps = {}) {
  const fetchFn = deps.fetch || globalThis.fetch;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') params.append(k, String(v));
  }
  const qs = canonicalQuery(params); // 发送的查询串与签名使用的保持完全一致
  const url = `${config.endpoint}${path}${qs ? `?${qs}` : ''}`;
  const payload = body === undefined ? '' : JSON.stringify(body);
  const headers = signRequest({
    method,
    url,
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    ak: config.ak,
    sk: config.sk,
    date: deps.now ? deps.now() : new Date(),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  let res;
  try {
    res = await fetchFn(url, { method, headers, body: payload || undefined, signal: controller.signal });
  } catch (err) {
    const timeout = err?.name === 'AbortError';
    throw new ReqError(
      'NETWORK_ERROR',
      timeout ? `请求超时（${config.timeoutMs} ms 内未响应）` : `网络异常，无法访问 ${config.endpoint}：${err?.cause?.code || err?.message || err}`,
      { endpoint: config.endpoint, hint: '请检查网络/代理设置，以及终端节点区域是否正确。' },
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new ReqError('API_ERROR', `CodeArts Req 接口返回错误（HTTP ${res.status}）：${data?.error_msg || text.slice(0, 200) || res.statusText}`, {
      http_status: res.status,
      error_code: data?.error_code ?? null,
      error_msg: data?.error_msg ?? (data ? null : text.slice(0, 500)),
      request_id: data?.request_id ?? res.headers.get('x-request-id') ?? null,
      hint: STATUS_HINTS[res.status] || '请根据 error_code 查阅《需求管理 API 参考》错误码章节。',
    });
  }
  if (data === null) {
    throw new ReqError('API_ERROR', '接口返回的不是合法 JSON', { http_status: res.status, error_msg: text.slice(0, 500) });
  }
  return data;
}
