---
name: stockshub-research
description: Read local A-share quotes, watchlists and research journals from StocksHub 2.0; preserve data provenance and observation time.
---

# StocksHub 2.0 本机 API

先启动 `python proxy_server.py`，默认地址 `http://127.0.0.1:8765`。这些接口只存在于本机版，GitHub Pages 版不提供远端 HTTP API；Pages 用户的数据保存在浏览器，需手动导出。

只在用户明确要求时写入、修改、归档或恢复其研究。市场数据只用于研究，不得把未知或缓存日期的数据描述为实时，不得虚构收益、补齐缺失数据或把涨跌当作研究假设已经验证。

| 方法 | 路径 | 返回 / 用途 |
|---|---|---|
| GET | `/health` | 状态与版本 |
| GET | `/api/search?q=茅台` | `{items, source, offline, warning?}`，仅 A 股 |
| GET | `/api/quote/sh600519` | 带源时间的行情信封 |
| GET | `/api/history/sh600519` | 未复权日线信封 |
| GET / POST | `/api/watchlist` | `{items}` / 新增股票 |
| DELETE | `/api/watchlist/sh600519` | 移除自选，保留相关研究 |
| GET / POST | `/api/journals` | `{items}` / 创建研究 |
| GET / PATCH | `/api/journals/{id}` | 查看 / 编辑并保留版本 |
| POST | `/api/journals/{id}/reviews` | 追加复盘，不能覆盖既有复盘 |
| GET | `/api/backup` | 完整个人 JSON 备份 |
| POST | `/api/restore` | 验证后合并；相同研究 ID 跳过 |

股票 ID 必须带市场，如 `sh600519`、`sz000001`、`bj920001`。`000001` 不唯一，不能猜测是股票还是指数。行情和日线支持 `?refresh=1` 强制重读。

行情信封：

```json
{
  "symbol": "sh600519",
  "source": "腾讯证券",
  "as_of": "2026-10-08T15:00:00+08:00",
  "fetched_at": "2026-10-08T07:01:00+00:00",
  "cache_status": "fresh",
  "data": {"price": 100.0, "change_pct": 1.0}
}
```

上面只是格式示例，不是实际行情。`cache_status` 为 `fresh`、`cached` 或 `fallback`，指读取方式，不能保证数据的新鲜度；必须同时检查 `as_of`。日线有 `basis: "unadjusted"`，`data` 为 `{date,open,close,high,low,volume}` 数组。量为股，额与市值为元。缺失数字为 `null`。

写入必须使用 `Content-Type: application/json`，最大 5 MB。本机服务不开放跨站 CORS。错误返回非 2xx 和 `{error}`。

```json
{
  "symbol": "sh600519",
  "name": "贵州茅台",
  "title": "研究主题",
  "thesis": "观察事实与研究理由",
  "validation": "可以验证或证伪的条件",
  "risk": "风险和相反证据",
  "review_date": "2026-11-01"
}
```

创建会尝试读取行情并固定基准；无法读取仍保存，`baseline` 为 `null`。修改研究需要完整字段，不得更换股票；仅归档时 PATCH `{"archived":true}`，恢复用 `false`。

追加复盘：`{"verdict":"uncertain","conclusion":"具体复盘结论"}`。`verdict` 可为 `confirmed`、`rejected`、`uncertain`。价格变化只采用创建之后的未复权观察值，不含分红、费用，不代表交易收益。

不要调用旧版情绪、策略、研报或 AI 分析接口；2.0 已移除。所有代理适配文件以本文件为唯一 API 文档来源。
