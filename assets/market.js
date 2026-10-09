import { SEEDS, validSymbol, parseQuote, parseHistory, parseSearch } from './domain.js';

// Only these fixed trusted public providers may execute JSONP scripts.
// This is necessary on static Pages where the providers do not expose CORS.
let searchQueue = Promise.resolve();
let serial = 0;
function scriptValue(url, key, charset = 'utf-8') {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.charset = charset;
    script.src = url;
    let completed = false;
    const clean = () => {
      clearTimeout(timer);
      script.remove();
    };
    const fail = () => {
      if (!completed) {
        completed = true;
        clean();
        reject(new Error('免费数据源暂时无法连接。'));
      }
    };
    const timer = setTimeout(fail, 8000);
    script.onerror = fail;
    script.onload = () => {
      if (completed) return;
      completed = true;
      const value = window[key];
      clean();
      try {
        delete window[key];
      } catch {
        /* Non-configurable provider global can be overwritten next time. */
      }
      value === undefined ? reject(new Error('数据源没有返回可用数据。')) : resolve(value);
    };
    // Clear previous values before load so a failed response cannot look fresh.
    try {
      window[key] = undefined;
    } catch {
      /* Provider global already exists. */
    }
    document.head.append(script);
  });
}

export class BrowserMarket {
  constructor(store, snapshot) {
    this.store = store;
    this.snapshot = snapshot;
    this.pending = new Map();
  }
  async get(kind, symbol, refresh = false) {
    validSymbol(symbol);
    const key = `${kind}:${symbol}`;
    if (this.pending.has(key)) return this.pending.get(key);
    const promise = this.load(kind, symbol, refresh).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
  async load(kind, symbol, refresh) {
    const key = `cache:${kind}:${symbol}`;
    const saved = await this.store.get(key);
    const ttl = kind === 'quote' ? 60000 : 3600000;
    const age = Date.now() - Date.parse(saved?.fetched_at);
    if (saved && !refresh && age >= 0 && age < ttl) return { ...saved, cache_status: 'cached' };
    let result;
    try {
      if (kind === 'quote') {
        const raw = await scriptValue(`https://qt.gtimg.cn/q=${symbol}`, `v_${symbol}`, 'gbk');
        result = parseQuote(raw, symbol);
      } else {
        const key = `stockshubHistory${Date.now()}x${++serial}`;
        const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,320,bfq&_var=${key}`;
        result = parseHistory(await scriptValue(url, key), symbol);
      }
    } catch (error) {
      const fallback =
        saved ?? this.snapshot?.[kind === 'quote' ? 'quotes' : 'histories']?.[symbol];
      if (fallback)
        return {
          ...fallback,
          cache_status: 'fallback',
          warning: '在线来源不可用，显示已保存的数据。',
        };
      throw error;
    }
    // A cache quota failure must not discard successfully fetched market data.
    try {
      await this.store.put(key, result);
    } catch {
      result.warning = '行情已读取，但浏览器缓存保存失败。';
    }
    return result;
  }
  async search(query) {
    const local = [...(await this.store.state()).watchlist, ...SEEDS];
    const needle = query.toLowerCase();
    const items = new Map(
      local
        .filter((s) => s.symbol.includes(needle) || s.name.toLowerCase().includes(needle))
        .map((s) => [s.symbol, s]),
    );
    try {
      const run = () =>
        scriptValue(
          `https://smartbox.gtimg.cn/s3/?q=${encodeURIComponent(query)}&t=all`,
          'v_hint',
          'gbk',
        );
      const request = searchQueue.then(run, run);
      searchQueue = request.catch(() => {});
      for (const stock of parseSearch(await request)) items.set(stock.symbol, stock);
      return { items: [...items.values()].slice(0, 30), offline: false, source: '腾讯证券' };
    } catch {
      return {
        items: [...items.values()].slice(0, 30),
        offline: true,
        source: '本地自选与起始列表',
        warning: '在线搜索不可用；当前结果只覆盖本地列表。',
      };
    }
  }
}
