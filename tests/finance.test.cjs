'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadApp = require('./load-app.cjs');
const account = () => ({ id: 'synthetic-1', name: 'Cuenta ficticia', startDate: '2024-01-10', dueDay: 10, amount: 100, currency: 'USD', payments: [], createdAt: '2024-01-01T12:00:00Z' });

test('accepts localized amounts and rejects non-numeric input', () => {
  const { run } = loadApp();
  assert.equal(run('normalizePositiveAmount("1.234,56")'), 1234.56);
  assert.equal(run('normalizePositiveAmount("1,234.56")'), 1234.56);
  assert.equal(run('normalizePositiveAmount("0,10")'), 0.1);
  assert.equal(run('Number.isNaN(normalizePositiveAmount("no-numero"))'), true);
});
test('due dates clamp to month end, including leap years', () => {
  const { run } = loadApp();
  assert.equal(run('toInputDate(buildDateForMonth("2024-02", 31))'), '2024-02-29');
  assert.equal(run('toInputDate(buildDateForMonth("2025-02", 31))'), '2025-02-28');
  assert.equal(run('isValidIsoDate("2025-02-29")'), false);
  assert.equal(run('isValidIsoDate("2024-02-29")'), true);
});
test('invalid stored account records are discarded without mutating the input', () => {
  const { put, json } = loadApp();
  const valid = account();
  const records = [null, valid, { ...valid, id: '' }, { ...valid, startDate: '2024-13-01' }, { ...valid, amount: -1 }, { ...valid, dueDay: 32 }];
  const original = structuredClone(records);
  put('records', records);
  assert.equal(json('sanitizeAccounts(records)').length, 1);
  assert.deepEqual(records, original);
});
test('payment coverage preserves gaps instead of treating later payments as consecutive', () => {
  const { put, json } = loadApp();
  put('sample', { ...account(), payments: [{ monthKey: '2024-01' }, { monthKey: '2024-03' }] });
  assert.deepEqual(json('getPaymentCoverage(sample, "2024-01", "2024-04")'), { count: 1, paidCycles: 2, firstUnpaidMonthKey: '2024-02', paidThroughMonth: '2024-01' });
});
test('arrears and currency estimates count only unpaid months', () => {
  const { put, run } = loadApp();
  put('sample', { ...account(), payments: [{ monthKey: '2024-01', paidAt: '2024-01-10T12:00:00Z', amount: 100, currency: 'USD', estimatedUyu: 4000 }, { monthKey: '2024-03', paidAt: '2024-03-10T12:00:00Z', amount: 100, currency: 'USD', estimatedUyu: 4000 }] });
  run('globalThis.details = buildAccountDetails(sample, new Date(2024, 3, 15), 40)');
  assert.equal(run('details.pendingInstallments'), 2);
  assert.equal(run('details.overdueInstallments'), 2);
  assert.equal(run('details.totalEstimatedUyu'), 8000);
  assert.equal(run('buildNextPaymentRecord(sample, new Date(2024, 3, 15), 40).monthKey'), '2024-02');
});
test('future accounts do not accumulate arrears', () => {
  const { put, run } = loadApp();
  put('sample', { ...account(), startDate: '2024-08-10' });
  assert.equal(run('buildAccountDetails(sample, new Date(2024, 3, 15), 40).statusKey'), 'scheduled');
  assert.equal(run('buildAccountDetails(sample, new Date(2024, 3, 15), 40).overdueInstallments'), 0);
});
test('malformed persisted JSON falls back without writing browser data', () => {
  const { storage, run } = loadApp();
  storage.set('control-pagos-accounts', '{broken');
  assert.equal(run('loadAccounts().length'), 0);
  assert.equal(storage.get('control-pagos-accounts'), '{broken');
});
