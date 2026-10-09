// Pure market parsing, validation and comparisons shared by browser modes.
export const SYMBOL =
  /^(sh(?:600|601|603|605|688|689)\d{3}|sz(?:000|001|002|003|300|301)\d{3}|bj(?:4\d|8\d|92)\d{4})$/;
export const SEEDS = [
  ['sh600519', '贵州茅台'],
  ['sz000001', '平安银行'],
  ['sz300750', '宁德时代'],
  ['sh601318', '中国平安'],
  ['sz002594', '比亚迪'],
  ['sh600036', '招商银行'],
  ['sh601899', '紫金矿业'],
  ['sh600900', '长江电力'],
  ['sz000333', '美的集团'],
  ['sz000858', '五粮液'],
  ['sh688981', '中芯国际'],
  ['sh601088', '中国神华'],
].map(([symbol, name]) => ({
  symbol,
  name,
  code: symbol.slice(2),
  exchange: symbol.slice(0, 2).toUpperCase(),
}));

export function validSymbol(value) {
  if (typeof value !== 'string' || !SYMBOL.test(value.toLowerCase()))
    throw new Error('请输入带市场前缀的 A 股代码，例如 sh600519。');
  return value.toLowerCase();
}
export function numeric(value) {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean')
    return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
export function requiredText(value, label, max = 5000, required = true) {
  if (typeof value !== 'string' || value.trim().length > max || (required && !value.trim()))
    throw new Error(`${label}${required ? '不能为空，且' : ''}不能超过 ${max} 个字符。`);
  return value.trim();
}
export function stockFields(item) {
  const symbol = validSymbol(item?.symbol);
  return {
    symbol,
    code: symbol.slice(2),
    exchange: symbol.slice(0, 2).toUpperCase(),
    name: requiredText(item?.name, '股票名称', 80),
  };
}
export function journalFields(item) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(item?.review_date) ||
    !Number.isFinite(Date.parse(item.review_date)) ||
    new Date(item.review_date).toISOString().slice(0, 10) !== item.review_date
  )
    throw new Error('请选择有效的复盘日期。');
  return {
    ...stockFields(item),
    title: requiredText(item.title, '标题', 120),
    thesis: requiredText(item.thesis, '研究理由'),
    validation: requiredText(item.validation, '验证条件'),
    risk: requiredText(item.risk ?? '', '风险', 5000, false),
    review_date: item.review_date,
  };
}
export function makeEnvelope(symbol, data, as_of, basis) {
  return {
    symbol,
    data,
    as_of,
    source: '腾讯证券',
    fetched_at: new Date().toISOString(),
    cache_status: 'fresh',
    ...(basis ? { basis } : {}),
  };
}
function marketTime(raw) {
  if (!/^\d{14}$/.test(raw ?? '')) throw new Error('行情时间无效。');
  const as_of = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}+08:00`;
  const time = Date.parse(as_of);
  if (
    !Number.isFinite(time) ||
    new Date(time + 8 * 3600000).toISOString().replace(/\D/g, '').slice(0, 14) !== raw
  )
    throw new Error('行情时间无效。');
  return as_of;
}
export function parseQuote(raw, symbol) {
  validSymbol(symbol);
  const p = raw?.split('~') ?? [];
  if (p.length < 47 || p[2] !== symbol.slice(2) || !/^\d{14}$/.test(p[30]))
    throw new Error('数据源没有返回有效行情或数据时间。');
  const as_of = marketTime(p[30]);
  const data = {
    name: p[1],
    price: numeric(p[3]),
    prev_close: numeric(p[4]),
    open: numeric(p[5]),
    change: numeric(p[31]),
    change_pct: numeric(p[32]),
    high: numeric(p[33]),
    low: numeric(p[34]),
    volume: numeric(p[6]),
    amount: numeric(p[37]),
    turnover: numeric(p[38]),
    pe: numeric(p[39]),
    market_cap: numeric(p[45]),
    pb: numeric(p[46]),
  };
  if (!(data.price > 0)) throw new Error('暂无有效成交价格，可能停牌或数据缺失。');
  for (const [key, factor] of [
    ['volume', 100],
    ['amount', 1e4],
    ['market_cap', 1e8],
  ])
    if (data[key] !== null) data[key] *= factor;
  return makeEnvelope(symbol, data, as_of);
}
export function parseHistory(payload, symbol) {
  validSymbol(symbol);
  const rows = payload?.data?.[symbol]?.day ?? [];
  const bars = new Map();
  for (const row of rows) {
    if (
      !Array.isArray(row) ||
      row.length < 6 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(row[0]) ||
      !Number.isFinite(Date.parse(row[0]))
    )
      continue;
    const [open, close, high, low, lots] = row.slice(1, 6).map(numeric);
    if (
      [open, close, high, low, lots].includes(null) ||
      low <= 0 ||
      low > Math.min(open, close) ||
      high < Math.max(open, close) ||
      lots < 0
    )
      continue;
    bars.set(row[0], { date: row[0], open, close, high, low, volume: lots * 100 });
  }
  const data = [...bars.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (!data.length) throw new Error('没有可用的未复权日线。');
  const lastDate = data.at(-1).date;
  let asOf = `${lastDate}T15:00:00+08:00`,
    precision = 'close';
  const quoteTime = payload?.data?.[symbol]?.qt?.[symbol]?.[30];
  if (quoteTime?.slice(0, 8) === lastDate.replaceAll('-', '')) {
    try {
      const actual = marketTime(quoteTime);
      if (Date.parse(actual) < Date.parse(asOf)) {
        asOf = actual;
        precision = 'intraday';
      }
    } catch {
      /* Conservative date-only observation below. */
    }
  }
  if (Date.parse(asOf) > Date.now()) {
    asOf = `${lastDate}T00:00:00+08:00`;
    precision = 'date';
  }
  return { ...makeEnvelope(symbol, data, asOf, 'unadjusted'), time_precision: precision };
}
export function parseSearch(hint) {
  if (typeof hint !== 'string') throw new Error('搜索数据无法解析。');
  // Some responses preserve literal unicode escapes inside v_hint.
  hint = hint.replace(/\\u([\da-f]{4})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  const stocks = new Map();
  for (const raw of hint.split('^')) {
    const [market, code, name, , type] = raw.split('~');
    const symbol = market + code;
    if (type === 'GP-A' && SYMBOL.test(symbol) && name)
      stocks.set(symbol, stockFields({ symbol, name }));
  }
  return [...stocks.values()].slice(0, 30);
}
export function movingAverages(bars, window) {
  let sum = 0;
  return bars.map((bar, i) => {
    sum += bar.close;
    if (i >= window) sum -= bars[i - window].close;
    return i + 1 >= window ? sum / window : null;
  });
}
export function freshness(envelope, now = Date.now()) {
  if (!envelope?.as_of || !Number.isFinite(Date.parse(envelope.as_of)))
    return { state: 'unknown', label: '数据时间未知' };
  const age = now - Date.parse(envelope.as_of);
  if (age < -300000) return { state: 'warning', label: '数据时间晚于本机时间' };
  if (envelope.cache_status === 'fallback') return { state: 'warning', label: '备用缓存' };
  if (age > 72 * 3600000) return { state: 'warning', label: '超过 72 小时' };
  return {
    state: 'neutral',
    label: envelope.cache_status === 'cached' ? '本地缓存' : '来源已响应',
  };
}
export function screenStock(quote, history, rule, now = Date.now()) {
  if (
    !quote?.data ||
    quote.cache_status === 'fallback' ||
    freshness(quote, now).state !== 'neutral'
  )
    return { status: 'missing', reason: '行情缺失、时间异常或为备用缓存' };
  if (rule.type === 'change') {
    const value = numeric(quote.data.change_pct);
    if (value === null) return { status: 'missing', reason: '涨跌幅缺失' };
    return {
      status: value >= rule.min ? 'match' : 'excluded',
      value,
      reason: `涨跌幅 ${value.toFixed(2)}%`,
    };
  }
  if (
    !history?.data ||
    history.basis !== 'unadjusted' ||
    history.cache_status === 'fallback' ||
    freshness(history, now).state !== 'neutral'
  )
    return { status: 'missing', reason: '可用日线不足或已过期' };
  const window = rule.window === 60 ? 60 : 20;
  const ma = movingAverages(history.data, window).at(-1);
  if (ma === null || ma === undefined)
    return { status: 'missing', reason: `不足 ${window} 个交易日` };
  // Compare same-day close to its MA, rather than mix a new quote with old history.
  const close = history.data.at(-1).close;
  return {
    status: close > ma ? 'match' : 'excluded',
    value: ma,
    reason: `日线收盘 ${close.toFixed(2)} / MA${window} ${ma.toFixed(2)}`,
  };
}
export function compareReview(entry, quote, history, now = Date.now()) {
  const baseline = entry?.baseline;
  const base = numeric(baseline?.data?.price);
  const baseTime = Date.parse(baseline?.as_of);
  const created = Date.parse(entry?.created_at);
  if (!(base > 0) || !Number.isFinite(baseTime) || !Number.isFinite(created))
    return { status: 'no_baseline', message: '创建时没有可用行情，不能计算价格变化。' };
  const cutoff = Math.max(baseTime, created);
  const observations = [];
  if (history?.basis === 'unadjusted')
    for (const bar of history.data ?? []) {
      let at = Date.parse(`${bar.date}T15:00:00+08:00`);
      if (bar.date === history.as_of?.slice(0, 10)) at = Math.min(at, Date.parse(history.as_of));
      if (at > cutoff && at <= now && numeric(bar.close) > 0)
        observations.push({ at, price: bar.close, source: history.source });
    }
  const at = Date.parse(quote?.as_of);
  if (at > cutoff && at <= now && numeric(quote?.data?.price) > 0)
    observations.push({ at, price: quote.data.price, source: quote.source });
  observations.sort((a, b) => b.at - a.at);
  if (!observations.length)
    return { status: 'waiting', message: '暂无研究创建之后的行情，等待后续数据。' };
  const last = observations[0];
  const packet = quote && Date.parse(quote.as_of) === last.at ? quote : history;
  return {
    status: 'available',
    baseline_price: base,
    baseline_as_of: baseline.as_of,
    price: last.price,
    as_of: new Date(last.at).toISOString(),
    source: last.source,
    change_pct: Number(((last.price / base - 1) * 100).toFixed(4)),
    cache_status: packet?.cache_status ?? 'unknown',
    warning: packet?.warning,
    basis: '未复权价格变化，不含分红、费用，不代表交易收益。',
  };
}
function validTime(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value.slice(0, 10)).toISOString().slice(0, 10) === value.slice(0, 10)
  );
}
function validSnapshot(snapshot, symbol) {
  if (
    !snapshot ||
    snapshot.symbol !== symbol ||
    !validTime(snapshot.as_of) ||
    typeof snapshot.data?.price !== 'number' ||
    !(numeric(snapshot.data.price) > 0)
  )
    throw new Error('备份中的行情快照无效。');
  requiredText(snapshot.source, '数据来源', 100);
}
export function validateBackup(input) {
  if (
    input?.format !== 'stockshub-backup' ||
    input.version !== 1 ||
    !Array.isArray(input.watchlist) ||
    !Array.isArray(input.journals) ||
    input.watchlist.length > 1000 ||
    input.journals.length > 10000
  )
    throw new Error('请选择 StocksHub 导出的 v1 备份文件。');
  const watchlist = input.watchlist.map(stockFields);
  const ids = new Set();
  const journals = input.journals.map((item) => {
    const fields = journalFields(item);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(item.id ?? '')) throw new Error('备份中的记录 ID 无效。');
    if (ids.has(item.id) || !validTime(item.created_at) || !validTime(item.updated_at))
      throw new Error('备份记录 ID 重复或日期无效。');
    ids.add(item.id);
    const baseline = item.baseline ?? null;
    if (baseline) validSnapshot(baseline, fields.symbol);
    const reviews = item.reviews ?? [],
      revisions = item.revisions ?? [];
    if (
      !Array.isArray(reviews) ||
      !Array.isArray(revisions) ||
      reviews.length > 1000 ||
      revisions.length > 1000
    )
      throw new Error('备份中的复盘或版本记录无效。');
    const cleanReviews = reviews.map((review) => {
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(review.id ?? '')) throw new Error('备份中的复盘 ID 无效。');
      requiredText(review.conclusion, '复盘结论');
      if (
        !['confirmed', 'rejected', 'uncertain'].includes(review.verdict) ||
        !validTime(review.created_at)
      )
        throw new Error('备份中的复盘记录无效。');
      if (review.snapshot) validSnapshot(review.snapshot, fields.symbol);
      return {
        id: review.id,
        conclusion: review.conclusion,
        verdict: review.verdict,
        created_at: review.created_at,
        snapshot: review.snapshot ?? null,
        comparison: compareReview(item, review.snapshot),
      };
    });
    const cleanRevisions = revisions.map((revision) => {
      if (!validTime(revision.revised_at)) throw new Error('备份中的版本时间无效。');
      return { ...journalFields(revision), revised_at: revision.revised_at };
    });
    return {
      ...fields,
      id: item.id,
      created_at: item.created_at,
      updated_at: item.updated_at,
      baseline,
      reviews: cleanReviews,
      revisions: cleanRevisions,
      archived: item.archived === true,
    };
  });
  return { watchlist, journals };
}
export function chinaDate(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86400000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
