// 华为云 API 网关 AK/SK 签名（SDK-HMAC-SHA256）。
//
// 签名流程（参考华为云《API 签名指南》）：
//   1. CanonicalRequest = Method \n CanonicalURI \n CanonicalQueryString \n
//                         CanonicalHeaders \n SignedHeaders \n HexEncode(SHA256(Body))
//   2. StringToSign     = "SDK-HMAC-SHA256" \n X-Sdk-Date \n HexEncode(SHA256(CanonicalRequest))
//   3. Signature        = HexEncode(HMAC-SHA256(SK, StringToSign))
//   4. Authorization    = SDK-HMAC-SHA256 Access=<AK>, SignedHeaders=<...>, Signature=<...>
import { createHash, createHmac } from 'node:crypto';

export const ALGORITHM = 'SDK-HMAC-SHA256';

/** RFC 3986 编码：在 encodeURIComponent 基础上再转义 ! ' ( ) * */
export function rfc3986(str) {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const sha256Hex = (data) => createHash('sha256').update(data, 'utf8').digest('hex');

/** 20260503T080910Z */
export function formatSdkDate(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** 路径每一段编码，并保证以 / 结尾（网关规定） */
export function canonicalUri(pathname) {
  const encoded = pathname.split('/').map((seg) => rfc3986(decodeURIComponent(seg))).join('/');
  return encoded.endsWith('/') ? encoded : `${encoded}/`;
}

/** 按参数名排序（同名参数按值排序），值为空时保留 "key=" */
export function canonicalQuery(searchParams) {
  const pairs = [];
  for (const [k, v] of searchParams) pairs.push([rfc3986(k), rfc3986(v)]);
  pairs.sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  return pairs.map(([k, v]) => `${k}=${v}`).join('&');
}

/**
 * 计算签名并返回需要附加到请求上的请求头。
 * @param {{method:string,url:string,headers?:Record<string,string>,body?:string,ak:string,sk:string,date?:Date}} req
 * @returns {Record<string,string>} 包含 X-Sdk-Date、Authorization（以及传入的 headers）
 */
export function signRequest({ method, url, headers = {}, body = '', ak, sk, date }) {
  const u = new URL(url);
  const sdkDate = formatSdkDate(date);
  const all = { ...headers, 'X-Sdk-Date': sdkDate };
  // 参与签名的头：host + x-sdk-date + 调用方显式传入的头（统一小写、去首尾空格、排序）
  const lower = { host: u.host };
  for (const [k, v] of Object.entries(all)) lower[k.toLowerCase()] = String(v).trim();
  const names = Object.keys(lower).sort();
  const canonicalHeaders = names.map((n) => `${n}:${lower[n]}\n`).join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri(u.pathname),
    canonicalQuery(u.searchParams),
    canonicalHeaders,
    signedHeaders,
    sha256Hex(body || ''),
  ].join('\n');
  const stringToSign = `${ALGORITHM}\n${sdkDate}\n${sha256Hex(canonicalRequest)}`;
  const signature = createHmac('sha256', sk).update(stringToSign, 'utf8').digest('hex');

  return {
    ...all,
    Authorization: `${ALGORITHM} Access=${ak}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
