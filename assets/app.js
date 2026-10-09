import { createClient } from './api.js';
import { SEEDS, chinaDate, compareReview, screenStock, validSymbol, freshness } from './domain.js';
import { createChart } from './chart.js';
import {
  h,
  icon,
  button,
  link,
  heading,
  empty,
  errorState,
  loading,
  fmt,
  pct,
  tone,
  unit,
  dateTime,
  sourceLine,
  toast,
  busy,
  field,
} from './ui.js';

let api, config, snapshot;
let state = { watchlist: [], journals: [] };
let generation = 0,
  cleanups = [],
  dirty = false,
  lastHash = location.hash;
const main = document.querySelector('#main');
const titles = {
  watchlist: '自选研究',
  journals: '研究日志',
  reviews: '复盘队列',
  data: '数据与备份',
  stock: '股票研究',
  new: '新建研究',
  edit: '编辑研究',
  journal: '研究记录',
};
const run =
  (work) =>
  async (...args) => {
    try {
      return await work(...args);
    } catch (error) {
      toast(error.message || '操作失败，请重试。');
    }
  };
const request = (...args) => api.request(...args);
const due = (entry) => !entry.archived && entry.review_date <= chinaDate() && !entry.reviews.length;
const activeEntries = () => state.journals.filter((e) => !e.archived);
function panel(title, subtitle, body, action) {
  return h(
    'section',
    { class: 'panel' },
    h(
      'div',
      { class: 'panel-head' },
      h('div', {}, h('h2', {}, title), subtitle ? h('p', {}, subtitle) : null),
      action,
    ),
    body,
  );
}
function setPage(...nodes) {
  main.replaceChildren(...nodes);
  main.setAttribute('aria-busy', 'false');
}
async function readPersonal() {
  const [watches, journals] = await Promise.all([request('watchlist'), request('journals')]);
  state = { watchlist: watches.items, journals: journals.items };
  document.querySelector('#watch-count').textContent = state.watchlist.length;
  document.querySelector('#journal-count').textContent = activeEntries().length;
  document.querySelector('#due-count').textContent = state.journals.filter(due).length;
}
function stockName(symbol) {
  return (
    state.watchlist.find((s) => s.symbol === symbol)?.name ??
    SEEDS.find((s) => s.symbol === symbol)?.name ??
    symbol
  );
}
function stats() {
  const values = [
    [state.watchlist.length, '自选股票', '跟踪自己的观察范围'],
    [activeEntries().length, '研究记录', '保留观点与创建时行情'],
    [state.journals.filter(due).length, '待复盘', '到期且尚未留下结论'],
  ];
  return h(
    'div',
    { class: 'stats-strip' },
    values.map(([number, label, description]) =>
      h(
        'div',
        { class: 'stat' },
        h('span', { class: 'stat-number' }, number),
        h('div', { class: 'stat-label' }, label, h('small', {}, description)),
      ),
    ),
  );
}
function workflow() {
  const queue = state.journals.filter(due).slice(0, 4);
  return h(
    'aside',
    { class: 'side-stack' },
    panel(
      '下一步研究',
      '把观察变成可回看的记录',
      h(
        'div',
        { class: 'panel-body' },
        queue.length
          ? queue.map((e) =>
              h(
                'a',
                { class: 'queue-item', href: `#journal/${e.id}` },
                h('span', { class: 'badge warning' }, '待复盘'),
                h('strong', {}, e.title),
                h('small', {}, `${e.name} · ${e.review_date}`),
              ),
            )
          : h(
              'div',
              {},
              [
                ['建立观察范围', '从搜索或起始列表添加一只股票。'],
                ['写下验证条件', '记录为什么关注，以及什么会改变判断。'],
                ['按时回看结果', '对照后续走势，追加复盘结论。'],
              ].map(([title, text], i) =>
                h(
                  'div',
                  { class: 'workflow-step' },
                  h('span', { class: 'step-number' }, i + 1),
                  h('div', {}, title, h('small', {}, text)),
                ),
              ),
            ),
        link(
          queue.length ? '查看复盘队列' : '写一篇研究',
          queue.length ? '#reviews' : '#new',
          'quiet',
          'arrow',
        ),
      ),
    ),
    h(
      'div',
      { class: 'note-box' },
      h('strong', {}, '先记录，再验证'),
      '行情只是观察材料。研究理由、验证条件和复盘结论共同构成你的判断记录。',
    ),
    h(
      'div',
      { class: 'note-box' },
      h('strong', {}, config.mode === 'browser' ? '记录保存在这个浏览器' : '记录保存在本机 SQLite'),
      config.mode === 'browser'
        ? '个人记录不会上传到 GitHub。清除网站数据、更换浏览器或设备前，请先导出备份。'
        : '更换电脑或在 Pages 版使用时，可通过 JSON 备份迁移。',
      h('br'),
      h('a', { class: 'text-link', href: '#data' }, '管理数据与备份', icon('arrow')),
    ),
  );
}
async function limitedMap(items, work, limit = 4) {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const current = index++;
        await work(items[current], current);
      }
    }),
  );
}

async function watchlistPage(id) {
  const body = h('tbody');
  const quotes = new Map(),
    rows = new Map();
  const summary = h(
    'div',
    { class: 'filter-summary', role: 'status' },
    '筛选只覆盖你的自选股；结果不是买卖建议。',
  );
  const type = h(
    'select',
    { 'aria-label': '筛选规则' },
    h('option', { value: 'all' }, '全部自选'),
    h('option', { value: 'change' }, '涨跌幅 ≥ 阈值'),
    h('option', { value: 'ma20' }, '日线收盘 > MA20'),
    h('option', { value: 'ma60' }, '日线收盘 > MA60'),
  );
  const threshold = h('input', {
    type: 'number',
    value: '0',
    step: '.1',
    min: '-100',
    max: '1000',
    'aria-label': '涨跌幅阈值（%）',
    hidden: true,
  });
  type.addEventListener('change', () => {
    threshold.hidden = type.value !== 'change';
  });
  const filter = button(
    '运行筛选',
    run(() =>
      busy(
        filter,
        async () => {
          if (type.value === 'all') {
            rows.forEach((row) => {
              row.hidden = false;
              row.querySelector('[data-screen]').replaceChildren();
            });
            summary.textContent = '显示全部自选。';
            return;
          }
          const min = Number(threshold.value);
          if (type.value === 'change' && (!threshold.value || !Number.isFinite(min)))
            throw new Error('请输入有效的涨跌幅阈值。');
          let matches = 0,
            missing = 0;
          await limitedMap(state.watchlist, async (stock) => {
            if (generation !== id) return;
            let quote = quotes.get(stock.symbol),
              history;
            try {
              quote ??= await request(`quote/${stock.symbol}`);
            } catch {
              /* Mark missing below. */
            }
            if (type.value.startsWith('ma'))
              try {
                history = await request(`history/${stock.symbol}`);
              } catch {
                /* Mark missing below. */
              }
            if (generation !== id) return;
            const result = screenStock(
              quote,
              history,
              type.value === 'change'
                ? { type: 'change', min }
                : { type: 'ma', window: type.value === 'ma60' ? 60 : 20 },
            );
            const row = rows.get(stock.symbol);
            row.hidden = result.status === 'excluded';
            const status = row.querySelector('[data-screen]');
            status.replaceChildren(
              h(
                'span',
                { class: result.status === 'missing' ? 'row-error' : 'row-source' },
                result.reason,
              ),
            );
            if (result.status === 'match') matches++;
            if (result.status === 'missing') missing++;
          });
          if (generation === id)
            summary.textContent = `匹配 ${matches} 只 · 数据不足 ${missing} 只（仍显示）· 排除 ${state.watchlist.length - matches - missing} 只。`;
        },
        '正在筛选…',
      ),
    ),
  );
  const table = h(
    'div',
    { class: 'table-scroll' },
    h(
      'table',
      {},
      h(
        'thead',
        {},
        h(
          'tr',
          {},
          ['股票 / 市场', '最新价', '涨跌幅', '数据时间 / 状态', '操作'].map((label, i) =>
            h('th', { class: [1, 2, 4].includes(i) ? 'numeric' : '' }, label),
          ),
        ),
      ),
      body,
    ),
  );
  for (const stock of state.watchlist) {
    const row = h(
      'tr',
      {},
      h(
        'td',
        {},
        h('a', { class: 'stock-link', href: `#stock/${stock.symbol}` }, stock.name),
        h('span', { class: 'stock-code' }, stock.symbol.toUpperCase()),
      ),
      h('td', { class: 'numeric price', 'data-price': '' }, '—'),
      h('td', { class: 'numeric mono', 'data-change': '' }, '—'),
      h('td', { 'data-source': '' }, h('span', { class: 'row-source' }, '正在读取行情…')),
      h(
        'td',
        {},
        h('div', { 'data-screen': '' }),
        h(
          'div',
          { class: 'row-actions' },
          link('研究', `#stock/${stock.symbol}`, 'quiet'),
          button(
            '移除',
            run(async () => {
              await request(`watchlist/${stock.symbol}`, 'DELETE');
              await render();
              toast(`已移除 ${stock.name}，相关研究记录保留。`, {
                label: '撤销',
                run: run(async () => {
                  await request('watchlist', 'POST', stock);
                  await render();
                }),
              });
            }),
            'quiet',
          ),
        ),
      ),
    );
    rows.set(stock.symbol, row);
    body.append(row);
  }
  const listBody = state.watchlist.length
    ? h(
        'div',
        {},
        h('div', { class: 'filter-bar' }, type, threshold, filter, summary),
        table,
        h(
          'div',
          { class: 'coverage-note' },
          '数据时间来自行情源。超过 72 小时会提示；节假日、停牌也可能导致间隔较长。',
        ),
      )
    : h(
        'div',
        {},
        empty(
          '从一只股票开始',
          '搜索你关注的 A 股，添加自选，再写下可以验证的研究假设。起始列表仅帮助你开始，不是股票推荐。',
          button(
            '搜索股票',
            () => document.querySelector('#stock-search').focus(),
            'primary',
            'search',
          ),
        ),
        h(
          'div',
          { class: 'starter-list' },
          SEEDS.slice(0, 6).map((stock) =>
            h(
              'a',
              { class: 'starter-item', href: `#stock/${stock.symbol}` },
              h(
                'span',
                {},
                h('strong', {}, stock.name),
                h('small', { class: 'mono' }, stock.symbol.toUpperCase()),
              ),
              icon('arrow'),
            ),
          ),
        ),
      );
  const refresh = button(
    '刷新行情',
    run(() =>
      busy(
        refresh,
        async () => {
          await loadQuotes(true);
          toast('行情读取完成，请查看每行的数据时间与状态。');
        },
        '正在读取…',
      ),
    ),
    'secondary',
    'refresh',
  );
  setPage(
    heading('自选研究', '围绕自己的观察范围，留下可验证的判断。', [refresh]),
    stats(),
    h(
      'div',
      { class: 'content-grid' },
      panel(
        '我的自选',
        `${state.watchlist.length} 只股票 · 行情与研究入口`,
        listBody,
        h('span', { class: 'badge' }, 'A 股'),
      ),
      workflow(),
    ),
  );
  async function loadQuotes(force = false) {
    await limitedMap([...state.watchlist], async (stock) => {
      if (generation !== id) return;
      const row = rows.get(stock.symbol);
      try {
        const data = await request(`quote/${stock.symbol}${force ? '?refresh=1' : ''}`);
        if (generation !== id) return;
        quotes.set(stock.symbol, data);
        const price = row.querySelector('[data-price]'),
          change = row.querySelector('[data-change]');
        price.textContent = fmt(data.data.price);
        change.textContent = pct(data.data.change_pct);
        price.className = `numeric price ${tone(data.data.change_pct)}`;
        change.className = `numeric mono ${tone(data.data.change_pct)}`;
        const quality = freshness(data);
        row
          .querySelector('[data-source]')
          .replaceChildren(
            h('span', { class: 'row-source' }, dateTime(data.as_of)),
            h(
              'span',
              { class: `row-source ${quality.state === 'warning' ? 'warning-text' : ''}` },
              `${data.source} · ${quality.label}`,
            ),
          );
      } catch (error) {
        if (generation === id) {
          quotes.delete(stock.symbol);
          row.querySelector('[data-price]').textContent = '—';
          row.querySelector('[data-change]').textContent = '—';
          row
            .querySelector('[data-source]')
            .replaceChildren(h('span', { class: 'row-error' }, error.message));
        }
      }
    });
  }
  await loadQuotes();
}

async function stockPage(symbol, id) {
  validSymbol(symbol);
  const quoteBox = h('section', { class: 'panel quote-panel' }, loading('正在读取带时间的行情…'));
  const chartBox = h(
    'section',
    { class: 'panel chart-panel' },
    h(
      'div',
      { class: 'panel-head' },
      h('h2', {}, '价格与成交量'),
      h('span', { class: 'badge' }, '未复权日线'),
    ),
    loading('正在读取历史日线…'),
  );
  const title = h('h1', {}, stockName(symbol));
  let followed = state.watchlist.some((s) => s.symbol === symbol);
  const follow = button(
    followed ? '已加入自选' : '加入自选',
    run(async () => {
      await busy(follow, async () => {
        if (followed) {
          toast('已经在自选列表，可在自选研究页移除。');
          return;
        }
        await request('watchlist', 'POST', { symbol, name: title.textContent });
        await readPersonal();
        followed = true;
        toast('已加入自选。');
      });
      if (followed) follow.replaceChildren(icon('check'), '已加入自选');
    }),
    followed ? 'secondary' : 'primary',
    followed ? 'check' : 'plus',
  );
  const refresh = button(
    '刷新数据',
    run(() => busy(refresh, () => loadData(true), '正在读取…')),
    'secondary',
    'refresh',
  );
  const related = state.journals.filter((e) => e.symbol === symbol && !e.archived);
  setPage(
    h('a', { class: 'back-link', href: '#watchlist' }, icon('back'), '返回自选研究'),
    h(
      'div',
      { class: 'stock-heading' },
      h('div', {}, title, h('span', { class: 'stock-code' }, `${symbol.toUpperCase()} · A 股`)),
      h(
        'div',
        { class: 'actions' },
        refresh,
        follow,
        link('写研究', `#new/${symbol}`, 'primary', 'plus'),
      ),
    ),
    h(
      'div',
      { class: 'content-grid' },
      h(
        'div',
        {},
        quoteBox,
        chartBox,
        panel(
          '相关研究',
          `${related.length} 篇记录`,
          related.length
            ? journalRows(related)
            : empty(
                '还没有这只股票的研究',
                '把关注理由和验证条件写下来，创建时会尽力保存当时行情。',
                link('新建研究', `#new/${symbol}`, 'primary', 'plus'),
              ),
        ),
      ),
      h(
        'aside',
        { class: 'side-stack' },
        panel(
          '研究时先想清楚',
          '价格变化之外，也要记录依据',
          h(
            'div',
            { class: 'panel-body' },
            [
              '为什么关注这家公司？',
              '什么事实能验证你的判断？',
              '出现什么情况会承认判断错误？',
              '准备在哪一天重新评估？',
            ].map((text, i) =>
              h(
                'div',
                { class: 'workflow-step' },
                h('span', { class: 'step-number' }, i + 1),
                h('span', {}, text),
              ),
            ),
            link('写下研究假设', `#new/${symbol}`, 'primary', 'plus'),
          ),
        ),
        h(
          'div',
          { class: 'note-box' },
          h('strong', {}, '关于数据口径'),
          '日线与均线使用未复权价格。除权、除息会影响价格对比；复盘展示的是价格变化，不是实际投资收益。',
        ),
      ),
    ),
  );
  async function loadQuote(force) {
    try {
      const quote = await request(`quote/${symbol}${force ? '?refresh=1' : ''}`);
      if (generation !== id) return;
      title.textContent = quote.data.name || stockName(symbol);
      const d = quote.data;
      const metrics = [
        ['今开', fmt(d.open)],
        ['最高', fmt(d.high)],
        ['最低', fmt(d.low)],
        ['昨收', fmt(d.prev_close)],
        ['成交量 / 股', unit(d.volume)],
        ['成交额', unit(d.amount)],
        ['换手率', d.turnover === null ? '—' : `${fmt(d.turnover)}%`],
        ['市盈率 TTM', fmt(d.pe)],
        ['市净率', fmt(d.pb)],
        ['总市值', unit(d.market_cap)],
      ];
      quoteBox.replaceChildren(
        h(
          'div',
          { class: 'quote-head' },
          h('span', { class: `quote-price ${tone(d.change_pct)}` }, fmt(d.price)),
          h(
            'span',
            { class: `quote-change ${tone(d.change_pct)}` },
            `${pct(d.change_pct)} / ${fmt(d.change)}`,
          ),
        ),
        h(
          'div',
          { class: 'quote-metrics' },
          metrics.map(([label, value]) =>
            h(
              'div',
              {},
              h('span', { class: 'metric-label' }, label),
              h('span', { class: 'metric-value' }, value),
            ),
          ),
        ),
        sourceLine(quote),
      );
    } catch (error) {
      if (generation === id)
        quoteBox.replaceChildren(
          errorState(
            error,
            run(() => loadQuote(true)),
          ),
        );
    }
  }
  let chartCleanup;
  cleanups.push(() => chartCleanup?.());
  async function loadHistory(force) {
    try {
      const history = await request(`history/${symbol}${force ? '?refresh=1' : ''}`);
      if (generation !== id) return;
      const container = h('div', { class: 'chart-container' });
      chartCleanup?.();
      chartBox.replaceChildren(
        h(
          'div',
          { class: 'panel-head' },
          h('h2', {}, '价格与成交量'),
          h('span', { class: 'badge' }, `${history.data.length} 个交易日`),
        ),
        container,
        h('div', { class: 'coverage-note' }, sourceLine(history)),
      );
      chartCleanup = createChart(container, history);
    } catch (error) {
      if (generation === id)
        chartBox.replaceChildren(
          errorState(
            error,
            run(() => loadHistory(true)),
          ),
        );
    }
  }
  async function loadData(force = false) {
    await Promise.allSettled([loadQuote(force), loadHistory(force)]);
  }
  await loadData();
}

function journalStatus(entry) {
  return entry.archived
    ? h('span', { class: 'badge' }, '已归档')
    : entry.reviews.length
      ? h('span', { class: 'badge accent' }, `${entry.reviews.length} 次复盘`)
      : due(entry)
        ? h('span', { class: 'badge warning' }, '待复盘')
        : h('span', { class: 'badge' }, '观察中');
}
function journalRows(entries) {
  return h(
    'div',
    { class: 'journal-list' },
    entries.map((entry) =>
      h(
        'div',
        { class: 'journal-row' },
        h(
          'div',
          {},
          h(
            'div',
            { class: 'journal-meta' },
            h('a', { class: 'journal-symbol', href: `#stock/${entry.symbol}` }, entry.name),
            h('span', { class: 'mono' }, entry.symbol.toUpperCase()),
            journalStatus(entry),
          ),
          h('h3', {}, h('a', { href: `#journal/${entry.id}` }, entry.title)),
          h('p', {}, entry.thesis),
          h(
            'div',
            { class: 'journal-meta spaced' },
            h('span', {}, `创建 ${dateTime(entry.created_at)}`),
            h('span', {}, `复盘 ${entry.review_date}`),
          ),
        ),
        h(
          'div',
          { class: 'actions' },
          link('查看记录', `#journal/${entry.id}`, 'secondary', 'arrow'),
        ),
      ),
    ),
  );
}
function journalsPage(reviewOnly = false) {
  const filter = h(
    'select',
    { 'aria-label': reviewOnly ? '复盘队列筛选' : '研究记录筛选' },
    ...(reviewOnly
      ? [
          h('option', { value: 'due' }, '到期未复盘'),
          h('option', { value: 'upcoming' }, '尚未到期'),
          h('option', { value: 'reviewed' }, '已有复盘'),
        ]
      : [
          h('option', { value: 'active' }, '全部进行中'),
          h('option', { value: 'reviewed' }, '已有复盘'),
          h('option', { value: 'archived' }, '已归档'),
        ]),
  );
  const container = h('div');
  const update = () => {
    const entries = state.journals.filter((e) =>
      filter.value === 'archived'
        ? e.archived
        : filter.value === 'due'
          ? due(e)
          : filter.value === 'reviewed'
            ? !e.archived && e.reviews.length
            : filter.value === 'upcoming'
              ? !e.archived && !e.reviews.length && !due(e)
              : !e.archived,
    );
    container.replaceChildren(
      entries.length
        ? journalRows(entries)
        : empty(
            reviewOnly ? '当前队列没有记录' : '让第一个判断有据可查',
            reviewOnly
              ? '到期且尚未复盘的研究会出现在这里。也可以切换查看观察中或已经复盘的记录。'
              : '写下研究理由、验证条件与复盘日期。保存后，工作台会保留当时的行情快照。',
            link('新建研究', '#new', 'primary', 'plus'),
          ),
    );
  };
  filter.addEventListener('change', update);
  update();
  setPage(
    heading(
      reviewOnly ? '复盘队列' : '研究日志',
      reviewOnly ? '回看当初的判断，给结果留下解释。' : '保存观点，也保存观点改变的过程。',
      [link('新建研究', '#new', 'primary', 'plus')],
    ),
    stats(),
    h(
      'div',
      { class: 'content-grid' },
      panel(
        reviewOnly ? '需要重新评估的判断' : '我的研究记录',
        '原始行情快照保留；编辑会留下版本，复盘采用追加记录。',
        h('div', {}, h('div', { class: 'filter-bar' }, filter), container),
      ),
      workflow(),
    ),
  );
}

async function journalForm(symbol, editId, id) {
  let existing;
  if (editId) existing = await request(`journals/${editId}`);
  if (generation !== id) return;
  const stocks = new Map([...SEEDS, ...state.watchlist].map((s) => [s.symbol, s]));
  if (existing) stocks.set(existing.symbol, existing);
  if (symbol && !stocks.has(symbol)) {
    validSymbol(symbol);
    let name = symbol;
    try {
      const quote = await request(`quote/${symbol}`);
      name = quote.data.name;
    } catch {
      /* Allow saving a journal even offline. */
    }
    if (generation !== id) return;
    stocks.set(symbol, { symbol, name });
  }
  const selected = existing?.symbol ?? symbol ?? state.watchlist[0]?.symbol ?? SEEDS[0].symbol;
  const select = h(
    'select',
    { id: 'journal-symbol', required: true, disabled: !!existing },
    [...stocks.values()].map((s) =>
      h('option', { value: s.symbol }, `${s.name} · ${s.symbol.toUpperCase()}`),
    ),
  );
  select.value = selected;
  const title = h('input', {
    id: 'journal-title',
    required: true,
    maxlength: 120,
    value: existing?.title ?? '',
    placeholder: '例如：关注利润率变化，等待下期财报验证',
  });
  const thesis = h(
    'textarea',
    {
      id: 'journal-thesis',
      required: true,
      maxlength: 5000,
      rows: 5,
      placeholder: '写下观察到的事实、信息来源，以及为什么值得继续研究。',
    },
    existing?.thesis ?? '',
  );
  const validation = h(
    'textarea',
    {
      id: 'journal-validation',
      required: true,
      maxlength: 5000,
      rows: 4,
      placeholder: '什么具体事实或指标会支持这项判断？什么会使它失效？',
    },
    existing?.validation ?? '',
  );
  const risk = h(
    'textarea',
    {
      id: 'journal-risk',
      maxlength: 5000,
      rows: 3,
      placeholder: '可能忽略的因素、数据局限或相反证据。',
    },
    existing?.risk ?? '',
  );
  const reviewDate = h('input', {
    id: 'journal-review-date',
    type: 'date',
    required: true,
    value: existing?.review_date ?? chinaDate(20),
  });
  const errors = h('div', { class: 'form-error', role: 'alert' });
  const baselineBox = h('div', { class: 'panel-body' }, loading('正在读取创建时行情预览…'));
  const submit = h(
    'button',
    { type: 'submit', class: 'button primary' },
    icon('check'),
    existing ? '保存修改' : '保存研究',
  );
  const form = h(
    'form',
    { class: 'panel research-form' },
    field(
      '研究股票',
      select,
      existing
        ? '已有研究不能更换股票，基准快照始终保留。'
        : '列表包含自选与起始股票；其他股票可先搜索，再从详情页写研究。',
    ),
    field('研究标题', title),
    field('研究理由', thesis),
    field('验证条件', validation),
    field('风险与相反证据', risk),
    field(
      '计划复盘日期',
      reviewDate,
      '默认约 20 个自然日后，可改为任何合适的日期。到期后会进入复盘队列。',
    ),
    errors,
    h(
      'div',
      { class: 'form-bottom' },
      h('small', {}, '仅保存到自己的设备。保存时会尽力读取并固定行情快照。'),
      submit,
    ),
  );
  form.addEventListener('input', () => {
    dirty = true;
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errors.textContent = '';
    try {
      await busy(submit, async () => {
        const stock = stocks.get(select.value);
        const data = {
          symbol: select.value,
          name: stock.name,
          title: title.value,
          thesis: thesis.value,
          validation: validation.value,
          risk: risk.value,
          review_date: reviewDate.value,
        };
        const entry = await request(
          existing ? `journals/${existing.id}` : 'journals',
          existing ? 'PATCH' : 'POST',
          data,
        );
        dirty = false;
        toast(
          entry.baseline
            ? '研究已保存，行情快照已固定。'
            : '研究已保存。当前无可用行情，未创建价格基准。',
        );
        location.hash = `journal/${entry.id}`;
      });
    } catch (error) {
      errors.textContent = error.message;
    }
  });
  let previewVersion = 0;
  async function preview() {
    const version = ++previewVersion;
    baselineBox.replaceChildren(loading('正在读取行情预览…'));
    try {
      const quote = existing ? existing.baseline : await request(`quote/${select.value}`);
      if (version !== previewVersion || generation !== id) return;
      baselineBox.replaceChildren(
        quote
          ? h(
              'div',
              {},
              h('div', { class: 'quote-price' }, fmt(quote.data.price)),
              sourceLine(quote),
              h(
                'p',
                { class: 'inline-note' },
                existing
                  ? '这是研究创建时固定的快照，修改研究不会改写它。'
                  : '当前为预览。保存时重新读取或使用明确标记的缓存，并固定实际数据时间。',
              ),
            )
          : h(
              'p',
              { class: 'inline-note' },
              '创建时没有有效行情。本条研究可以人工复盘，无法计算价格变化。',
            ),
      );
    } catch {
      if (version === previewVersion && generation === id)
        baselineBox.replaceChildren(
          h('p', { class: 'inline-note' }, '暂时没有行情。仍可保存研究，基准不会用虚构价格补齐。'),
        );
    }
  }
  select.addEventListener('change', run(preview));
  setPage(
    heading(
      existing ? '编辑研究' : '新建研究',
      existing ? '修改会留下历史版本，原始行情基准保持不变。' : '把想法写成能被验证的判断。',
      [link('返回记录', existing ? `#journal/${existing.id}` : '#journals', 'secondary')],
    ),
    h(
      'div',
      { class: 'form-layout' },
      form,
      h(
        'aside',
        { class: 'side-stack' },
        panel(existing ? '固定的原始快照' : '行情快照预览', '来源与数据时间一起保存', baselineBox),
        h(
          'div',
          { class: 'note-box' },
          h('strong', {}, '一个可复盘的假设'),
          '研究理由描述事实，验证条件描述判断标准，复盘结论解释实际发生了什么。价格变化只能回答其中一部分问题。',
        ),
      ),
    ),
  );
  await preview();
}

async function journalPage(entryId, id) {
  const entry = await request(`journals/${entryId}`);
  if (generation !== id) return;
  const comparisonBox = h('div', { class: 'panel-body' }, loading('正在对照后续行情…'));
  const trendBox = h('div', { class: 'chart-container' }, loading('正在读取研究前后的日线…'));
  const trendSource = h('div', { class: 'coverage-note' });
  const fields = [
    ['研究理由', entry.thesis],
    ['验证条件', entry.validation],
    ['风险与相反证据', entry.risk || '未填写'],
  ];
  const verdicts = { confirmed: '假设获得支持', rejected: '假设被证伪', uncertain: '继续观察' };
  const history = h(
    'div',
    { class: 'review-history' },
    h('h3', {}, `复盘记录 · ${entry.reviews.length} 次`),
    entry.reviews.length
      ? entry.reviews.map((review) =>
          h(
            'div',
            { class: 'review-entry' },
            h(
              'div',
              { class: 'journal-meta' },
              h('span', { class: 'badge accent' }, verdicts[review.verdict]),
              h('span', {}, dateTime(review.created_at)),
            ),
            h('p', {}, review.conclusion),
            review.comparison?.status === 'available'
              ? h(
                  'p',
                  { class: `mono ${tone(review.comparison.change_pct)}` },
                  `当次复盘价格变化 ${pct(review.comparison.change_pct)}`,
                )
              : h('p', { class: 'muted' }, review.comparison?.message ?? '当次没有可用价格对照。'),
            review.snapshot ? sourceLine(review.snapshot) : null,
          ),
        )
      : h(
          'p',
          { class: 'inline-note' },
          '还没有复盘。结论可以验证、证伪或继续观察；每次追加都会保留。',
        ),
  );
  const conclusion = h('textarea', {
    required: true,
    maxlength: 5000,
    id: 'review-conclusion',
    rows: 4,
    placeholder: '对照原先的验证条件，说明发生了什么，哪些判断需要修正。',
  });
  const verdict = h(
    'select',
    { id: 'review-verdict', required: true },
    Object.entries(verdicts).map(([value, label]) => h('option', { value }, label)),
  );
  const formError = h('div', { class: 'form-error', role: 'alert' });
  const save = h('button', { type: 'submit', class: 'button primary' }, icon('check'), '追加复盘');
  const form = h(
    'form',
    { class: 'review-form' },
    h('h3', {}, '追加一次复盘'),
    field('复盘判断', verdict),
    field('复盘结论', conclusion),
    formError,
    save,
  );
  form.addEventListener('input', () => {
    dirty = true;
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    formError.textContent = '';
    try {
      await busy(save, async () => {
        await request(`journals/${entry.id}/reviews`, 'POST', {
          conclusion: conclusion.value,
          verdict: verdict.value,
        });
        dirty = false;
        toast('已追加复盘，原始研究与既有结论保留。');
        await render();
      });
    } catch (error) {
      formError.textContent = error.message;
    }
  });
  const archive = button(
    entry.archived ? '恢复研究' : '归档研究',
    run(async () => {
      await request(`journals/${entry.id}`, 'PATCH', { archived: !entry.archived });
      await render();
      toast(entry.archived ? '研究已恢复。' : '已归档，可在研究日志中恢复。');
    }),
    'quiet',
  );
  const revisions = h(
    'details',
    { class: 'revision-list' },
    h('summary', {}, `历史修改版本 · ${entry.revisions.length} 个`),
    entry.revisions.map((revision, index) =>
      h(
        'pre',
        {},
        `版本 ${index + 1} · ${dateTime(revision.revised_at)}\n${revision.title}\n\n研究理由：${revision.thesis}\n验证条件：${revision.validation}\n风险：${revision.risk}\n计划复盘：${revision.review_date}`,
      ),
    ),
  );
  setPage(
    h('a', { class: 'back-link', href: '#journals' }, icon('back'), '返回研究日志'),
    heading(
      entry.title,
      `${entry.name} · ${entry.symbol.toUpperCase()} · 创建于 ${dateTime(entry.created_at)}`,
      [archive, link('编辑研究', `#edit/${entry.id}`, 'secondary')],
    ),
    h(
      'div',
      { class: 'content-grid' },
      h(
        'section',
        { class: 'panel' },
        h(
          'div',
          { class: 'panel-head' },
          h(
            'div',
            { class: 'journal-meta' },
            journalStatus(entry),
            h('span', {}, `计划复盘 ${entry.review_date}`),
          ),
          link('股票详情', `#stock/${entry.symbol}`, 'quiet', 'arrow'),
        ),
        h(
          'div',
          { class: 'research-body' },
          fields.map(([label, text]) =>
            h('section', { class: 'research-section' }, h('h3', {}, label), h('p', {}, text)),
          ),
        ),
        revisions,
        h(
          'div',
          { class: 'panel-head' },
          h(
            'div',
            {},
            h('h2', {}, '研究前后日线'),
            h('p', {}, '横虚线为原始价格基准；创建日期落在区间内时显示竖虚线。'),
          ),
        ),
        trendBox,
        trendSource,
        history,
        form,
      ),
      h(
        'aside',
        { class: 'side-stack' },
        panel('后续价格对照', '只使用研究创建之后的观察值', comparisonBox),
        panel(
          '创建时固定的行情',
          '研究修改不会改写基准',
          h(
            'div',
            { class: 'panel-body' },
            entry.baseline
              ? h(
                  'div',
                  {},
                  h('div', { class: 'quote-price' }, fmt(entry.baseline.data.price)),
                  sourceLine(entry.baseline),
                )
              : h('p', {}, '创建时没有有效行情，本条记录不计算价格变化。'),
          ),
        ),
        h(
          'div',
          { class: 'note-box' },
          h('strong', {}, '复盘不是只看涨跌'),
          '行情对照使用未复权价格，不计分红、成本和成交。验证条件是否兑现，需要结合你的研究依据判断。',
        ),
      ),
    ),
  );
  const [quote, historical] = await Promise.allSettled([
    request(`quote/${entry.symbol}`),
    request(`history/${entry.symbol}`),
  ]);
  if (generation !== id) return;
  if (historical.status === 'fulfilled') {
    cleanups.push(
      createChart(trendBox, historical.value, 120, {
        price: entry.baseline?.data?.price,
        date: new Date(Date.parse(entry.created_at) + 8 * 3600000).toISOString().slice(0, 10),
      }),
    );
    trendSource.replaceChildren(sourceLine(historical.value));
  } else
    trendBox.replaceChildren(
      h('p', { class: 'inline-note' }, '历史日线暂时不可用，研究内容与复盘记录仍可查看。'),
    );
  const result = compareReview(
    entry,
    quote.status === 'fulfilled' ? quote.value : null,
    historical.status === 'fulfilled' ? historical.value : null,
  );
  if (result.status === 'available')
    comparisonBox.replaceChildren(
      h('div', { class: `comparison-value ${tone(result.change_pct)}` }, pct(result.change_pct)),
      h(
        'div',
        { class: 'comparison-detail' },
        `基准 ${fmt(result.baseline_price)} → 后续 ${fmt(result.price)}`,
      ),
      h('div', { class: 'comparison-detail' }, `后续观察 ${dateTime(result.as_of)}`),
      h('p', { class: 'inline-note' }, result.basis),
      sourceLine(result),
    );
  else
    comparisonBox.replaceChildren(
      h('p', { class: 'inline-note' }, result.message),
      quote.status === 'rejected' && historical.status === 'rejected'
        ? h(
            'p',
            { class: 'warning-text inline-note' },
            '在线数据均不可用，保存过的研究与复盘仍可查看。',
          )
        : null,
    );
}

function downloadBackup(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob),
    a = h('a', { href: url, download: `stockshub-backup-${chinaDate()}.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function dataPage() {
  const exportButton = button(
    '导出完整备份',
    run(() =>
      busy(
        exportButton,
        async () => {
          downloadBackup(await request('backup'));
          toast('备份已导出，请保存到可靠位置。');
        },
        '正在导出…',
      ),
    ),
    'primary',
    'download',
  );
  const input = h('input', {
    id: 'backup-file',
    type: 'file',
    accept: '.json,application/json',
    class: 'file-input',
  });
  const result = h('p', { class: 'inline-note', role: 'status' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    input.disabled = true;
    result.textContent = '正在验证并合并备份…';
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('备份不能超过 5 MB。');
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error('文件不是有效 JSON。');
      }
      const imported = await request('restore', 'POST', data);
      await readPersonal();
      result.textContent = `已合并 ${imported.watchlist} 只自选、${imported.journals} 篇研究；跳过 ${imported.skipped} 个已有研究 ID。已有内容未覆盖。`;
      toast('备份已验证并合并。');
    } catch (error) {
      result.textContent = `未导入：${error.message}`;
    } finally {
      input.disabled = false;
      input.value = '';
    }
  });
  const persist = button(
    '申请保留浏览器数据',
    run(async () => {
      const granted = navigator.storage?.persist ? await navigator.storage.persist() : false;
      toast(
        granted
          ? '浏览器已允许持久存储，仍建议定期导出备份。'
          : '浏览器未授予持久存储，请使用导出备份保护记录。',
      );
    }),
    'secondary',
  );
  setPage(
    heading('数据与备份', '你的研究属于你。明确数据来源，也保留迁移的能力。'),
    h(
      'div',
      { class: 'backup-grid' },
      panel(
        '导出我的研究',
        '自选、原始快照、修改版本与全部复盘',
        h(
          'div',
          { class: 'panel-body' },
          h(
            'p',
            {},
            '导出为 JSON 文件，可在本机版和 Pages 版之间迁移。行情缓存不在个人备份中；研究创建和复盘时固定的快照会保留。',
          ),
          exportButton,
        ),
      ),
      panel(
        '从备份恢复',
        '合并导入，不覆盖已有研究 ID',
        h(
          'div',
          { class: 'panel-body' },
          h(
            'p',
            {},
            '选择 StocksHub v1 备份。全部记录通过验证后才写入；重复 ID 跳过，导入失败不会部分修改个人数据。文件最大 5 MB。',
          ),
          h('label', { class: 'sr-only', for: 'backup-file' }, '选择 StocksHub JSON 备份'),
          input,
          result,
        ),
      ),
    ),
    h(
      'section',
      { class: 'panel spaced' },
      h(
        'div',
        { class: 'panel-head' },
        h('h2', {}, '当前数据环境'),
        h(
          'span',
          { class: 'badge accent' },
          config.mode === 'browser' ? 'Pages / 浏览器模式' : '本机 / SQLite 模式',
        ),
      ),
      h(
        'dl',
        { class: 'data-facts' },
        h('dt', {}, '个人记录保存位置'),
        h(
          'dd',
          {},
          config.mode === 'browser'
            ? '当前浏览器 IndexedDB；不会自动跨设备同步或上传到 GitHub。'
            : '本机 SQLite，默认 local/stockshub.db。可通过 --database 或 STOCKSHUB_DB 配置。',
        ),
        h('dt', {}, '行情来源'),
        h(
          'dd',
          {},
          '腾讯证券免费公开数据。Pages 版通过限定来源的 JSONP 读取；不可用时回退到本地缓存或公开起始快照。',
        ),
        h('dt', {}, '行情与历史时间'),
        h(
          'dd',
          {},
          '行情显示来源时间；历史截止日来自最后一条日线。读取时间与数据时间分开保存，缓存不冒充新行情。',
        ),
        h('dt', {}, '公开快照覆盖'),
        h(
          'dd',
          {},
          snapshot
            ? `${snapshot.instruments?.length ?? 0} 只起始股票，生成于 ${dateTime(snapshot.generated_at)}。其他股票通过在线搜索与按需读取获取。`
            : '本机按需读取免费行情，并保留 SQLite 缓存；在线不可用时可回退到仓库内的起始快照。',
        ),
        h('dt', {}, '价格与均线口径'),
        h(
          'dd',
          {},
          '未复权日线，最多约 320 个交易日；均线在本地计算。价格变化不含分红、费用与实际成交。',
        ),
        h('dt', {}, '时效提示规则'),
        h(
          'dd',
          {},
          '数据距当前超过 72 个自然小时会提示；节假日、停牌可能造成更长间隔。筛选排除备用缓存和时间异常数据。',
        ),
        h('dt', {}, '个人记录数量'),
        h('dd', {}, `${state.watchlist.length} 只自选 · ${state.journals.length} 篇研究（含归档）`),
      ),
    ),
    config.mode === 'browser'
      ? h(
          'div',
          { class: 'note-box spaced' },
          h('strong', {}, '浏览器存储不是云同步'),
          '清除网站数据、使用无痕模式或设备故障都可能导致记录丢失。请定期导出；换浏览器、换设备或改用本机版时，通过备份导入。',
          h('div', { class: 'actions spaced' }, persist),
        )
      : null,
  );
}

async function render() {
  const id = ++generation;
  cleanups.forEach((cleanup) => cleanup());
  cleanups = [];
  const [route = 'watchlist', argument] = (location.hash.slice(1) || 'watchlist').split('/');
  lastHash = location.hash;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const section = ['stock'].includes(route)
      ? 'watchlist'
      : ['new', 'edit', 'journal'].includes(route)
        ? 'journals'
        : route;
    if (a.dataset.nav === section) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  document.title = `${titles[route] ?? 'StocksHub'} · StocksHub`;
  main.setAttribute('aria-busy', 'true');
  main.replaceChildren(loading('正在读取个人记录…'));
  try {
    await readPersonal();
    if (generation !== id) return;
    if (route === 'watchlist') await watchlistPage(id);
    else if (route === 'stock') await stockPage(argument, id);
    else if (route === 'journals') journalsPage();
    else if (route === 'reviews') journalsPage(true);
    else if (route === 'new') await journalForm(argument, null, id);
    else if (route === 'edit') await journalForm(null, argument, id);
    else if (route === 'journal') await journalPage(argument, id);
    else if (route === 'data') dataPage();
    else
      setPage(
        empty(
          '这个页面不存在',
          '请返回自选研究，继续查看自己的记录。',
          link('返回自选', '#watchlist', 'primary'),
        ),
      );
  } catch (error) {
    if (generation === id) setPage(errorState(error, run(render)));
  } finally {
    if (generation === id) main.setAttribute('aria-busy', 'false');
  }
}

function setupSearch() {
  const input = document.querySelector('#stock-search'),
    results = document.querySelector('#search-results');
  let timer,
    version = 0,
    selected = -1,
    options = [];
  function hide() {
    results.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  function choose(stock) {
    input.value = '';
    version++;
    hide();
    location.hash = `stock/${stock.symbol}`;
  }
  function select(index) {
    selected = Math.max(0, Math.min(options.length - 1, index));
    results
      .querySelectorAll('[role=option]')
      .forEach((node, i) => node.setAttribute('aria-selected', i === selected));
    if (selected >= 0) input.setAttribute('aria-activedescendant', `search-option-${selected}`);
  }
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const token = ++version,
      query = input.value.trim();
    selected = -1;
    options = [];
    input.removeAttribute('aria-activedescendant');
    if (!query) {
      hide();
      return;
    }
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    results.replaceChildren(
      h('div', { class: 'search-message', role: 'status' }, '正在搜索 A 股…'),
    );
    timer = setTimeout(async () => {
      try {
        const data = await request(`search?q=${encodeURIComponent(query)}`);
        if (token !== version) return;
        options = data.items;
        results.replaceChildren(
          ...options.map((stock, i) =>
            h(
              'button',
              {
                type: 'button',
                role: 'option',
                id: `search-option-${i}`,
                class: 'search-result',
                'aria-selected': 'false',
                onMouseDown: (event) => event.preventDefault(),
                onClick: () => choose(stock),
              },
              h('strong', {}, stock.name),
              h('span', {}, stock.symbol.toUpperCase()),
            ),
          ),
          ...(data.warning ? [h('div', { class: 'search-message' }, data.warning)] : []),
          ...(!options.length
            ? [h('div', { class: 'search-message' }, '没有匹配的 A 股。试试完整代码、名称或拼音。')]
            : []),
        );
      } catch (error) {
        if (token === version)
          results.replaceChildren(
            h('div', { class: 'search-message', role: 'alert' }, error.message),
          );
      }
    }, 300);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      version++;
      hide();
    }
    if (['ArrowDown', 'ArrowUp'].includes(event.key) && options.length && !results.hidden) {
      event.preventDefault();
      select(selected + (event.key === 'ArrowDown' ? 1 : -1));
    }
    if (event.key === 'Enter' && options.length && !results.hidden) {
      event.preventDefault();
      choose(options[Math.max(0, selected)]);
    }
  });
  document.addEventListener('click', (event) => {
    if (!document.querySelector('#search-box').contains(event.target)) {
      version++;
      hide();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (
      event.key === '/' &&
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)
    ) {
      event.preventDefault();
      input.focus();
    }
  });
}

async function init() {
  document.querySelector('.skip-link').addEventListener('click', (event) => {
    event.preventDefault();
    main.focus();
    main.scrollIntoView({ block: 'start' });
  });
  document
    .querySelectorAll('[data-icon]')
    .forEach((el) => el.replaceChildren(icon(el.dataset.icon)));
  try {
    const setup = await createClient();
    api = setup.client;
    config = setup.config;
    snapshot = setup.snapshot;
    document.querySelector('#storage-mode').textContent =
      config.mode === 'browser' ? '浏览器本地存储' : '本机 SQLite 存储';
    document.querySelector('#storage-hint').textContent =
      config.mode === 'browser'
        ? '个人研究不上传。跨设备使用请导出与导入备份。'
        : '记录保存在这台电脑，可通过备份迁移。';
    setupSearch();
    window.addEventListener('hashchange', () => {
      if (dirty && !confirm('研究尚未保存。离开页面会丢失当前修改，是否离开？')) {
        history.replaceState(null, '', lastHash || '#watchlist');
        return;
      }
      dirty = false;
      run(render)();
      window.scrollTo(0, 0);
    });
    window.addEventListener('beforeunload', (event) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    window.addEventListener('online', () => toast('网络已恢复，可刷新行情。'));
    window.addEventListener('offline', () => toast('当前离线。已保存的研究与复盘仍可使用。'));
    await render();
    if (config.mode === 'browser' && 'serviceWorker' in navigator)
      navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch (error) {
    setPage(errorState(error, () => location.reload()));
  }
}

init();
