import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validSymbol,
  parseQuote,
  parseHistory,
  parseSearch,
  movingAverages,
  freshness,
  screenStock,
  compareReview,
  validateBackup,
  journalFields,
} from '../assets/domain.js';

const fields = {
  symbol: 'sh600519',
  name: '贵州茅台',
  title: '研究',
  thesis: '利润率提升',
  validation: '下一期财报验证',
  risk: '',
  review_date: '2026-10-20',
};
const quote = {
  symbol: fields.symbol,
  source: '测试来源',
  as_of: '2026-10-08T15:00:00+08:00',
  fetched_at: '2026-10-08T15:01:00+08:00',
  cache_status: 'fresh',
  data: { price: 100, change_pct: 2 },
};
const entry = {
  ...fields,
  id: 'note1',
  created_at: '2026-10-08T16:00:00+08:00',
  updated_at: '2026-10-08T16:00:00+08:00',
  baseline: quote,
  reviews: [],
  revisions: [],
  archived: false,
};
const now = Date.parse('2026-10-09T00:00:00+08:00');
test('stock identifiers distinguish SZ000001 from the Shanghai index', () => {
  assert.equal(validSymbol('SZ000001'), 'sz000001');
  for (const value of ['000001', 'sh000001', 'hk00700', 'sh600519?x=y', null])
    assert.throws(() => validSymbol(value));
});
test('stock search filters indices and non-A-share assets', () => {
  const hint =
    'sh~600519~\\u8d35\\u5dde\\u8305\\u53f0~gzmt~GP-A^sh~000001~指数~zs~ZS^hk~00700~腾讯~tx~GP^sz~000001~平安银行~pa~GP-A';
  assert.deepEqual(
    parseSearch(hint).map((s) => s.symbol),
    ['sh600519', 'sz000001'],
  );
  assert.equal(parseSearch(hint)[0].name, '贵州茅台');
});
test('quote parser keeps observation time, missing values, and source units', () => {
  const p = Array(48).fill('');
  Object.assign(p, {
    1: '茅台',
    2: '600519',
    3: '100',
    4: '99',
    6: '20',
    30: '20261008150000',
    32: '1',
    37: '5',
    45: '8',
    46: '0',
  });
  const result = parseQuote(p.join('~'), 'sh600519');
  assert.equal(result.data.volume, 2000);
  assert.equal(result.data.amount, 50000);
  assert.equal(result.data.market_cap, 8e8);
  assert.equal(result.data.pb, 0);
  assert.equal(result.data.pe, null);
  assert.equal(result.as_of, '2026-10-08T15:00:00+08:00');
  p[30] = '';
  assert.throws(() => parseQuote(p.join('~'), 'sh600519'));
});
test('history rejects impossible OHLC bars and normalizes order', () => {
  const result = parseHistory(
    {
      data: {
        sh600519: {
          day: [
            ['2026-10-08', '100', '101', '102', '99', '20'],
            ['2026-10-07', '90', '91', '92', '89', '30'],
            ['2026-10-06', '9', '10', '8', '7', '5'],
          ],
        },
      },
    },
    'sh600519',
  );
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].date, '2026-10-07');
  assert.equal(result.data[1].volume, 2000);
  assert.equal(result.basis, 'unadjusted');
});
test('moving averages never use later observations', () => {
  assert.deepEqual(
    movingAverages(
      [1, 2, 3, 4].map((close) => ({ close })),
      3,
    ),
    [null, null, 2, 3],
  );
});
test('freshness differentiates stale observation time from a new fetch time', () => {
  assert.equal(
    freshness({ ...quote, fetched_at: '2099-01-01T00:00:00Z' }, Date.parse('2026-10-15T00:00:00Z'))
      .state,
    'warning',
  );
  assert.equal(freshness({ ...quote, cache_status: 'fallback' }, now).label, '备用缓存');
  assert.equal(freshness({ ...quote, as_of: null }, now).state, 'unknown');
});
test('screening explicitly marks unavailable and fallback data', () => {
  assert.equal(screenStock(null, null, { type: 'change', min: 0 }, now).status, 'missing');
  assert.equal(
    screenStock({ ...quote, cache_status: 'fallback' }, null, { type: 'change', min: 0 }, now)
      .status,
    'missing',
  );
  assert.equal(screenStock(quote, null, { type: 'change', min: 1 }, now).status, 'match');
  assert.equal(screenStock(quote, null, { type: 'change', min: 3 }, now).status, 'excluded');
});
test('MA screening uses same-history close, not a mismatched new quote', () => {
  const history = {
    ...quote,
    basis: 'unadjusted',
    data: Array.from({ length: 20 }, (_, i) => ({ close: i + 1 })),
  };
  assert.equal(
    screenStock({ ...quote, data: { price: 1 } }, history, { type: 'ma', window: 20 }, now).status,
    'match',
  );
  assert.equal(screenStock(quote, history, { type: 'ma', window: 60 }, now).status, 'missing');
});
test('no comparison is calculated without a baseline', () =>
  assert.equal(compareReview({ ...entry, baseline: null }, quote).status, 'no_baseline'));
test('comparison ignores precreation history and the unchanged baseline', () => {
  assert.equal(
    compareReview(entry, quote, {
      basis: 'unadjusted',
      source: '测试',
      data: [{ date: '2026-10-08', close: 120 }],
    }).status,
    'waiting',
  );
});
test('comparison selects latest eligible observation and excludes adjusted data', () => {
  const history = {
    source: '测试',
    basis: 'unadjusted',
    data: [
      { date: '2026-10-09', close: 110 },
      { date: '2026-10-10', close: 120 },
    ],
  };
  assert.equal(
    compareReview(entry, null, history, Date.parse('2026-10-11T00:00:00Z')).change_pct,
    20,
  );
  assert.equal(compareReview(entry, null, { ...history, basis: 'qfq' }).status, 'waiting');
});
test('journal validation rejects rolled-over and malformed dates', () => {
  for (const review_date of ['2026-02-30', '2026-13-01', 'bad'])
    assert.throws(() => journalFields({ ...fields, review_date }));
  assert.equal(journalFields(fields).review_date, fields.review_date);
});
test('backup verification preserves journals and rejects duplicate IDs atomically', () => {
  const backup = { format: 'stockshub-backup', version: 1, watchlist: [fields], journals: [entry] };
  assert.equal(validateBackup(backup).journals[0].title, fields.title);
  assert.throws(() => validateBackup({ ...backup, journals: [entry, entry] }));
  assert.throws(() =>
    validateBackup({
      ...backup,
      journals: [{ ...entry, baseline: { ...quote, symbol: 'sz000001' } }],
    }),
  );
});
test('backup never trusts imported computed returns', () => {
  const review = {
    id: 'review1',
    created_at: '2026-10-10T16:00:00+08:00',
    verdict: 'uncertain',
    conclusion: '观察中',
    snapshot: { ...quote, as_of: '2026-10-10T15:00:00+08:00', data: { price: 110 } },
    comparison: { change_pct: 999 },
  };
  const data = validateBackup({
    format: 'stockshub-backup',
    version: 1,
    watchlist: [],
    journals: [{ ...entry, reviews: [review] }],
  });
  const comparison = compareReview(
    entry,
    review.snapshot,
    null,
    Date.parse('2026-10-11T00:00:00Z'),
  );
  assert.equal(comparison.change_pct, 10);
  assert.notEqual(data.journals[0].reviews[0].comparison.change_pct, 999);
});
test('future observations cannot masquerade as verified outcomes', () => {
  const future = { ...quote, as_of: '2099-01-01T15:00:00+08:00', data: { price: 1000 } };
  assert.equal(compareReview(entry, future, null, now).status, 'waiting');
});
test('partial same-day bars do not claim an unobserved closing time', () => {
  const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  const qt = Array(31).fill('');
  qt[30] = date.replaceAll('-', '') + '093000';
  const history = parseHistory(
    { data: { sh600519: { day: [[date, '100', '101', '102', '99', '1']], qt: { sh600519: qt } } } },
    'sh600519',
  );
  assert.notEqual(history.as_of, date + 'T15:00:00+08:00');
});
test('backup route IDs and snapshot numbers are strictly validated', () => {
  const base = { format: 'stockshub-backup', version: 1, watchlist: [], journals: [entry] };
  assert.throws(() => validateBackup({ ...base, journals: [{ ...entry, id: '../broken' }] }));
  assert.throws(() =>
    validateBackup({
      ...base,
      journals: [{ ...entry, baseline: { ...quote, data: { price: '100' } } }],
    }),
  );
});
