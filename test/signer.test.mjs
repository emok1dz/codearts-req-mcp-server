import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalQuery, canonicalUri, formatSdkDate, rfc3986, signRequest } from '../lib/signer.mjs';

const HOST = 'https://projectman-ext.cn-north-4.myhuaweicloud.com';
const DATE = new Date(Date.UTC(2026, 4, 3, 8, 9, 10));

test('X-Sdk-Date 格式为 YYYYMMDDTHHMMSSZ（UTC）', () => {
  assert.equal(formatSdkDate(DATE), '20260503T080910Z');
});

test('RFC3986 编码会转义 !\'()* 与空格', () => {
  assert.equal(rfc3986("a b!'()*"), 'a%20b%21%27%28%29%2A');
  assert.equal(rfc3986('测试'), '%E6%B5%8B%E8%AF%95');
});

test('CanonicalURI 以 / 结尾', () => {
  assert.equal(canonicalUri('/v4/projects'), '/v4/projects/');
  assert.equal(canonicalUri('/v4/project/'), '/v4/project/');
});

test('CanonicalQueryString 按参数名排序', () => {
  const q = new URLSearchParams([['offset', '0'], ['limit', '10'], ['search', 'a b']]);
  assert.equal(canonicalQuery(q), 'limit=10&offset=0&search=a%20b');
});

// 以下期望值由华为云官方 Python SDK（huaweicloudsdkcore.signer.Signer）对同样的请求计算得到，
// 用于证明本实现与官方签名算法逐字节一致。
test('GET 签名与华为云官方 SDK 一致（含中文、空格、* 与逗号）', () => {
  const url = `${HOST}/v4/projects?limit=10&offset=0&search=${rfc3986('测试 a*b')}&sort=${rfc3986('created_on:desc,name:asc')}`;
  const h = signRequest({ method: 'GET', url, headers: { 'Content-Type': 'application/json' }, ak: 'MYAK', sk: 'MYSK', date: DATE });
  assert.equal(
    h.Authorization,
    'SDK-HMAC-SHA256 Access=MYAK, SignedHeaders=content-type;host;x-sdk-date, Signature=dfb8e6c558329ed7619c74933b115ee6ca8a5bf1cff2b0619ac26522046adf89',
  );
  assert.equal(h['X-Sdk-Date'], '20260503T080910Z');
});

test('POST 签名与华为云官方 SDK 一致（含请求体哈希）', () => {
  const body = JSON.stringify({ project_name: 'TestDemo', project_type: 'scrum' }).replace(/,/g, ', ').replace(/":/g, '": ');
  const h = signRequest({ method: 'POST', url: `${HOST}/v4/project`, headers: { 'Content-Type': 'application/json' }, body, ak: 'MYAK', sk: 'MYSK', date: DATE });
  assert.equal(
    h.Authorization,
    'SDK-HMAC-SHA256 Access=MYAK, SignedHeaders=content-type;host;x-sdk-date, Signature=64f3f1338eabea1203d30db0bf08b1a290085d66a4552ce9d87ce2a1bbba0900',
  );
});

test('请求体或 SK 改变时签名随之改变', () => {
  const base = { method: 'POST', url: `${HOST}/v4/project`, ak: 'AK', sk: 'SK', date: DATE, body: '{"a":1}' };
  const s1 = signRequest(base).Authorization;
  assert.notEqual(s1, signRequest({ ...base, body: '{"a":2}' }).Authorization);
  assert.notEqual(s1, signRequest({ ...base, sk: 'SK2' }).Authorization);
});
