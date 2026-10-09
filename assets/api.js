import { BrowserStore } from './storage.js';
import { BrowserMarket } from './market.js';
import {
  stockFields,
  journalFields,
  validateBackup,
  compareReview,
  requiredText,
  validSymbol,
} from './domain.js';

class HttpClient {
  async request(path, method = 'GET', body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`./api/${path}`, {
        method,
        signal: controller.signal,
        headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `服务返回 ${response.status}，请重试。`);
      return data;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('请求超时，已保存的研究记录不会受影响。');
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

class BrowserClient {
  constructor(store, market) {
    this.store = store;
    this.market = market;
  }
  async safeQuote(symbol) {
    try {
      return await this.market.get('quote', symbol);
    } catch {
      return null;
    }
  }
  async request(path, method = 'GET', body) {
    const url = new URL(path, 'https://local.invalid/');
    const [route, id, sub] = url.pathname.slice(1).split('/');
    if (method === 'GET') {
      if (route === 'search')
        return this.market.search(requiredText(url.searchParams.get('q'), '搜索内容', 80));
      if (route === 'quote' || route === 'history')
        return this.market.get(route, validSymbol(id), url.searchParams.get('refresh') === '1');
      const state = await this.store.state();
      if (route === 'watchlist') return { items: state.watchlist };
      if (route === 'journals' && !id)
        return {
          items: state.journals.toSorted((a, b) => b.created_at.localeCompare(a.created_at)),
        };
      if (route === 'journals') {
        const entry = state.journals.find((e) => e.id === id);
        if (!entry) throw new Error('研究记录不存在。');
        return entry;
      }
      if (route === 'backup')
        return {
          format: 'stockshub-backup',
          version: 1,
          exported_at: new Date().toISOString(),
          ...state,
        };
    }
    if (route === 'restore' && method === 'POST') {
      const imported = validateBackup(body);
      return this.store.mutate((state) => {
        const result = { watchlist: 0, journals: 0, skipped: 0 };
        for (const stock of imported.watchlist)
          if (!state.watchlist.some((s) => s.symbol === stock.symbol)) {
            state.watchlist.push(stock);
            result.watchlist++;
          }
        for (const entry of imported.journals) {
          if (state.journals.some((e) => e.id === entry.id)) result.skipped++;
          else {
            state.journals.push(entry);
            result.journals++;
          }
        }
        return result;
      });
    }
    if (route === 'watchlist')
      return this.store.mutate((state) => {
        if (method === 'DELETE') {
          validSymbol(id);
          state.watchlist = state.watchlist.filter((s) => s.symbol !== id);
          return { removed: true };
        }
        const stock = stockFields(body);
        state.watchlist = state.watchlist.filter((s) => s.symbol !== stock.symbol).concat(stock);
        return stock;
      });
    if (route === 'journals' && !id && method === 'POST') {
      const fields = journalFields(body);
      const baseline = await this.safeQuote(fields.symbol);
      const now = new Date().toISOString();
      const entry = {
        ...fields,
        id: crypto.randomUUID(),
        created_at: now,
        updated_at: now,
        baseline,
        reviews: [],
        revisions: [],
        archived: false,
      };
      return this.store.mutate((state) => {
        state.journals.push(entry);
        return entry;
      });
    }
    if (route === 'journals' && id) {
      let snapshot = null;
      if (sub === 'reviews' && method === 'POST') {
        requiredText(body?.conclusion, '复盘结论');
        if (!['confirmed', 'rejected', 'uncertain'].includes(body?.verdict))
          throw new Error('请选择复盘判断。');
        const entry = (await this.store.state()).journals.find((e) => e.id === id);
        if (!entry) throw new Error('研究记录不存在。');
        snapshot = await this.safeQuote(entry.symbol);
      }
      return this.store.mutate((state) => {
        const entry = state.journals.find((e) => e.id === id);
        if (!entry) throw new Error('研究记录不存在。');
        const now = new Date().toISOString();
        if (sub === 'reviews' && method === 'POST') {
          entry.reviews.push({
            id: crypto.randomUUID(),
            conclusion: body.conclusion.trim(),
            verdict: body.verdict,
            created_at: now,
            snapshot,
            comparison: compareReview(entry, snapshot),
          });
        } else if (
          method === 'PATCH' &&
          Object.keys(body).length === 1 &&
          typeof body.archived === 'boolean'
        )
          entry.archived = body.archived;
        else if (method === 'PATCH') {
          const fields = journalFields(body);
          if (fields.symbol !== entry.symbol) throw new Error('研究创建后不能更换股票。');
          entry.revisions.push({ ...journalFields(entry), revised_at: now });
          Object.assign(entry, fields);
        } else throw new Error('操作不支持。');
        entry.updated_at = now;
        return entry;
      });
    }
    throw new Error('接口不存在。');
  }
}

export async function createClient() {
  const response = await fetch('./site-config.json');
  if (!response.ok) throw new Error('无法加载工作台配置，请刷新页面。');
  const config = await response.json();
  if (config.mode === 'server') return { client: new HttpClient(), config, snapshot: null };
  const store = await BrowserStore.open();
  let snapshot = null;
  try {
    const result = await fetch('./data/market.json');
    if (result.ok) snapshot = await result.json();
  } catch {
    /* Live provider can work without a snapshot. */
  }
  return { client: new BrowserClient(store, new BrowserMarket(store, snapshot)), config, snapshot };
}
