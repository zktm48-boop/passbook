import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, saveConfig, validateConfig, loadCache, saveCache, listTransactions, addTransactions, deleteTransaction } from '../js/api.js';

const memStorage = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
const brokenStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
const cfg = { url: 'https://script.google.com/macros/s/ABC/exec', token: 'secret' };
const jsonRes = obj => ({ json: async () => obj });

test('config and cache round-trip; broken storage is tolerated', () => {
  const s = memStorage();
  assert.equal(loadConfig(s), null);
  assert.equal(saveConfig({ url: ' ' + cfg.url + ' ', token: 'secret ' }, s), true);
  assert.deepEqual(loadConfig(s), cfg);
  saveCache({ settings: { startBalance: 1 }, rows: [], savedAt: 5 }, s);
  assert.equal(loadCache(s).savedAt, 5);
  assert.equal(loadConfig(brokenStorage), null);
  assert.equal(saveConfig(cfg, brokenStorage), false);
});

test('validateConfig', () => {
  assert.equal(validateConfig(cfg), null);
  assert.match(validateConfig({ url: 'https://example.com', token: 'x' }), /주소/);
  assert.match(validateConfig({ url: cfg.url, token: '' }), /토큰/);
});

test('listTransactions sends GET with action and token', async () => {
  let called;
  const fetchImpl = async (url, opts) => { called = { url, opts }; return jsonRes({ status: 'ok', settings: { startBalance: 10, startDate: '2026-01-01' }, rows: [], skipped: 2 }); };
  const res = await listTransactions(cfg, fetchImpl);
  const u = new URL(called.url);
  assert.equal(u.searchParams.get('action'), 'list');
  assert.equal(u.searchParams.get('token'), 'secret');
  assert.equal(res.skipped, 2);
  assert.equal(res.settings.startBalance, 10);
});

test('addTransactions / deleteTransaction POST text/plain JSON', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push(opts); return jsonRes({ status: 'ok', ids: ['t_1'] }); };
  const { ids, warnings } = await addTransactions(cfg, [{ date: '2026-09-01', kind: 'expense', name: 'a', cat: 'b', amount: 1 }], fetchImpl);
  assert.deepEqual(ids, ['t_1']);
  assert.deepEqual(warnings, []);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].headers['Content-Type'], /^text\/plain/);
  assert.equal(JSON.parse(calls[0].body).action, 'add');
  await deleteTransaction(cfg, 't_1', fetchImpl);
  assert.deepEqual(JSON.parse(calls[1].body), { action: 'delete', token: 'secret', id: 't_1' });
});

test('errors become readable Korean messages', async () => {
  await assert.rejects(listTransactions(cfg, async () => jsonRes({ status: 'error', message: '토큰이 올바르지 않아요' })), /토큰이 올바르지 않아요/);
  await assert.rejects(listTransactions(cfg, async () => ({ json: async () => { throw new SyntaxError('Unexpected token <'); } })), /배포 설정/);
  // 배포 액세스가 "모든 사용자"가 아니면 로그인 페이지 리디렉트가 CORS에 막혀 TypeError가 난다 → 두 원인을 모두 안내
  await assert.rejects(listTransactions(cfg, async () => { throw new TypeError('Failed to fetch'); }), /네트워크.*모든 사용자/);
});

test('addTransactions sends requestId; network failures are marked uncertain', async () => {
  let body;
  await addTransactions(cfg, [{ date: '2026-09-01', kind: 'expense', name: 'a', cat: 'b', amount: 1 }], async (u, o) => { body = JSON.parse(o.body); return jsonRes({ status: 'ok', ids: ['t_1'] }); }, 'req-1');
  assert.equal(body.requestId, 'req-1');
  const err = await addTransactions(cfg, [], async () => { throw new TypeError('Failed to fetch'); }, 'req-2').catch(e => e);
  assert.equal(err.uncertain, true);
  const err2 = await addTransactions(cfg, [], async () => jsonRes({ status: 'error', message: 'x' }), 'req-3').catch(e => e);
  assert.ok(!err2.uncertain);
});
