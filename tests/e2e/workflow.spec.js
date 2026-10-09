import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';

function quoteString(symbol) {
  const p = Array(90).fill('');
  const now = new Date(Date.now() - 60000);
  const china = new Date(now.getTime() + 8 * 3600000)
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14);
  Object.assign(p, {
    1: symbol === 'sh600519' ? '贵州茅台' : '测试股票',
    2: symbol.slice(2),
    3: '100',
    4: '99',
    5: '99',
    6: '1000',
    30: china,
    31: '1',
    32: '1.01',
    33: '102',
    34: '98',
    37: '1000',
    38: '1',
    39: '20',
    45: '10',
    46: '2',
  });
  return p.join('~');
}
async function mockProviders(page) {
  await page.route('https://qt.gtimg.cn/**', async (route) => {
    const symbol = route.request().url().split('q=')[1];
    if (symbol === 'sz002415') return route.abort();
    await route.fulfill({
      contentType: 'application/javascript; charset=utf-8',
      body: `v_${symbol}=${JSON.stringify(quoteString(symbol))};`,
    });
  });
  await page.route('https://smartbox.gtimg.cn/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript; charset=utf-8',
      body: 'v_hint="sh~600519~贵州茅台~gzmt~GP-A";',
    }),
  );
  await page.route('https://web.ifzq.gtimg.cn/**', async (route) => {
    const url = new URL(route.request().url()),
      symbol = url.searchParams.get('param').split(',')[0];
    if (symbol === 'sz002475') return route.abort();
    const day = Array.from({ length: 100 }, (_, i) => {
      const date = new Date(Date.now() - (100 - i) * 86400000).toISOString().slice(0, 10),
        price = 90 + i / 10;
      return [
        date,
        String(price),
        String(price + 0.2),
        String(price + 1),
        String(price - 1),
        '1000',
      ];
    });
    await route.fulfill({
      contentType: 'application/javascript',
      body: `${url.searchParams.get('_var')}=${JSON.stringify({ code: 0, data: { [symbol]: { day } } })};`,
    });
  });
}
test.beforeEach(async ({ page, context }) => {
  // Codex's Windows browser subprocess can reject loopback sockets. Keep the
  // actual HTTP server, status, headers and bodies, but relay through Playwright.
  // Linux CI exercises normal native browser networking without this relay.
  if (process.platform === 'win32')
    await context.route(/^http:\/\/127\.0\.0\.1:876[67]\//, async (route) => {
      await route.fulfill({ response: await route.fetch() });
    });
  await mockProviders(page);
});

test('complete research workflow persists, versions, reviews and restores', async ({
  page,
}, info) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: '自选研究', exact: true })).toBeVisible();
  const search = page.getByRole('combobox', { name: '搜索 A 股代码、名称或拼音' });
  await search.fill('600519');
  await expect(page.getByRole('option', { name: /贵州茅台/ })).toBeVisible();
  await search.press('ArrowDown');
  await search.press('Enter');
  await expect(page.locator('.quote-price')).toHaveText('100.00');
  await expect(page.locator('.chart-plot svg')).toBeVisible();
  await page.getByRole('button', { name: '加入自选', exact: true }).click();
  await expect(page.getByRole('button', { name: '已加入自选', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '写研究', exact: true }).click();
  await page.getByLabel('研究标题').fill(`财报研究 ${info.project.name}`);
  await page
    .getByLabel('研究理由', { exact: true })
    .fill('根据本次财报观察利润率变化，等待下一期验证。');
  await page
    .getByLabel('验证条件', { exact: true })
    .fill('下期利润率继续提升；如果下降则重新评估。');
  await page.getByLabel('风险与相反证据', { exact: true }).fill('需求变化可能影响结论。');
  await page.getByLabel('计划复盘日期').fill('2020-01-01');
  await page.getByRole('button', { name: '保存研究', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: `财报研究 ${info.project.name}`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('暂无研究创建之后的行情，等待后续数据。', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: `财报研究 ${info.project.name}`, exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: '编辑研究', exact: true }).click();
  await page.getByLabel('研究理由', { exact: true }).fill('新增观察：需要关注经营现金流。');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByText('历史修改版本 · 1 个', { exact: true })).toBeVisible();
  await page.locator('[data-nav=reviews]').click();
  await expect(
    page.getByRole('heading', { name: `财报研究 ${info.project.name}`, exact: true }),
  ).toBeVisible();
  await page.getByRole('link', { name: '查看记录', exact: true }).first().click();
  await page.getByLabel('复盘判断').selectOption('uncertain');
  await page.getByLabel('复盘结论').fill('尚未发布下一期财报，继续观察，不以短期涨跌代替验证。');
  await page.getByRole('button', { name: '追加复盘', exact: true }).click();
  await expect(page.getByRole('heading', { name: '复盘记录 · 1 次', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '归档研究', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复研究', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '恢复研究', exact: true }).click();
  await page.locator('[data-nav=data]').click();
  const pendingDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出完整备份', exact: true }).click();
  const download = await pendingDownload;
  const backup = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
  expect(backup.journals.some((e) => e.title === `财报研究 ${info.project.name}`)).toBeTruthy();
  expect(
    backup.journals.find((e) => e.title === `财报研究 ${info.project.name}`).reviews,
  ).toHaveLength(1);
  await page.getByLabel('选择 StocksHub JSON 备份').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByText(/已合并 0 只自选、0 篇研究/)).toBeVisible();
  await page.getByLabel('选择 StocksHub JSON 备份').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"not":"a backup"}'),
  });
  await expect(page.getByText(/未导入：/)).toBeVisible();
  expect(errors).toEqual([]);
});

test('one missing history endpoint does not hide the valid quote', async ({ page }) => {
  await page.goto('./#stock/sz002475');
  await expect(page.locator('.quote-price')).toHaveText('100.00');
  await expect(page.locator('.chart-panel .error-state')).toBeVisible();
  await expect(page.getByRole('link', { name: '写研究', exact: true })).toBeVisible();
});

test('screening can be run repeatedly without damaging row controls', async ({ page }) => {
  await page.goto('./#stock/sh600519');
  await expect(page.locator('.quote-price')).toHaveText('100.00');
  const add = page.getByRole('button', { name: '加入自选', exact: true });
  if (await add.count()) await add.click();
  await page.locator('[data-nav=watchlist]').click();
  await expect(page.locator('[data-price]').first()).toHaveText('100.00');
  await page.getByLabel('筛选规则').selectOption('change');
  await page.getByLabel('涨跌幅阈值（%）').fill('2');
  await page.getByRole('button', { name: '运行筛选', exact: true }).click();
  await expect(page.getByText(/匹配 0 只/)).toBeVisible();
  await page.getByLabel('筛选规则').selectOption('all');
  await page.getByRole('button', { name: '运行筛选', exact: true }).click();
  await expect(page.getByRole('link', { name: '贵州茅台', exact: true }).first()).toBeVisible();
  await page.getByLabel('筛选规则').selectOption('ma20');
  await page.getByRole('button', { name: '运行筛选', exact: true }).click();
  await expect(page.getByText(/匹配 1 只/)).toBeVisible();
  await expect(page.getByRole('button', { name: '移除', exact: true }).first()).toBeVisible();
});

test('mobile, tablet, desktop and wide layouts do not overflow', async ({ page }) => {
  await page.goto('./');
  for (const width of [320, 375, 768, 1024, 1440, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByRole('heading', { name: '自选研究', exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
    await expect(page.locator('[data-nav=data]')).toBeVisible();
  }
});

test('Pages works after a real offline reload and preserves edited research', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== 'pages', 'Offline shell applies to static Pages mode.');
  await page.goto('./#new/sh600519');
  await page.getByLabel('研究标题').fill('离线研究');
  await page.getByLabel('研究理由', { exact: true }).fill('记录可以离线访问。');
  await page.getByLabel('验证条件', { exact: true }).fill('恢复网络后继续核对。');
  await page.getByRole('button', { name: '保存研究', exact: true }).click();
  await expect(page.getByRole('heading', { name: '离线研究', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.unrouteAll({ behavior: 'wait' });
  await context.unrouteAll({ behavior: 'wait' });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: '离线研究', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '编辑研究', exact: true }).click();
  await page.getByLabel('研究理由', { exact: true }).fill('断网后仍然能够编辑并保存。');
  await page.getByRole('button', { name: '保存修改', exact: true }).click();
  await expect(page.getByText('断网后仍然能够编辑并保存。', { exact: true })).toBeVisible();
  await context.setOffline(false);
});

test('backups migrate SQLite journals, versions and reviews into Pages', async ({
  page,
  request,
}, info) => {
  test.skip(info.project.name !== 'pages', 'One cross-mode round trip is sufficient.');
  const response = await request.post('http://127.0.0.1:8767/api/journals', {
    data: {
      symbol: 'sh600519',
      name: '贵州茅台',
      title: '跨模式完整迁移',
      thesis: '本机创建的研究理由',
      validation: '迁移后保留快照和历史版本',
      risk: '',
      review_date: '2099-01-01',
    },
  });
  expect(response.ok()).toBeTruthy();
  const entry = await response.json();
  await request.patch(`http://127.0.0.1:8767/api/journals/${entry.id}`, {
    data: {
      symbol: entry.symbol,
      name: entry.name,
      title: entry.title,
      thesis: '本机修改后的理由',
      validation: entry.validation,
      risk: '',
      review_date: entry.review_date,
    },
  });
  await request.post(`http://127.0.0.1:8767/api/journals/${entry.id}/reviews`, {
    data: { verdict: 'uncertain', conclusion: '本机保存的复盘结论' },
  });
  const backup = await (await request.get('http://127.0.0.1:8767/api/backup')).json();
  await page.goto('./#data');
  await page
    .getByLabel('选择 StocksHub JSON 备份')
    .setInputFiles({
      name: 'sqlite-backup.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(backup)),
    });
  await expect(page.getByText(/已合并/)).toBeVisible();
  await page.goto(`./#journal/${entry.id}`);
  await expect(page.getByRole('heading', { name: entry.title, exact: true })).toBeVisible();
  await expect(page.getByText('历史修改版本 · 1 个', { exact: true })).toBeVisible();
  await expect(page.getByText('本机保存的复盘结论', { exact: true })).toBeVisible();
  await expect(page.locator('.quote-price')).toHaveText('100.00');
});

test('imported text stays text and keyboard skip link preserves the current route', async ({
  page,
}) => {
  const id = 'safe-text-' + Date.now();
  const title = '<img src=x onerror=window.hacked=true>';
  const entry = {
    id,
    symbol: 'sh600519',
    name: '贵州茅台',
    title,
    thesis: '<script>window.hacked=true</script>',
    validation: '检查外部文本不会执行',
    risk: '',
    review_date: '2099-01-01',
    created_at: '2020-01-01T00:00:00Z',
    updated_at: '2020-01-01T00:00:00Z',
    baseline: null,
    reviews: [],
    revisions: [],
    archived: false,
  };
  await page.goto('./#data');
  await page
    .getByLabel('选择 StocksHub JSON 备份')
    .setInputFiles({
      name: 'safe-text.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify({
          format: 'stockshub-backup',
          version: 1,
          watchlist: [],
          journals: [entry],
        }),
      ),
    });
  await expect(page.getByText(/已合并/)).toBeVisible();
  await page.goto(`./#journal/${id}`);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.locator('main img, main script')).toHaveCount(0);
  expect(await page.evaluate(() => window.hacked)).toBeUndefined();
  await page.locator('.skip-link').focus();
  await page.locator('.skip-link').press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  expect(page.url()).toContain('#journal/');
});
