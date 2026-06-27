---
name: stockshub-api
description: Query A-share market data via StocksHub API - stocks, quotes, kline, sectors, strategies, research
triggers:
  - stock
  - A股
  - 股票
  - 行情
  - K线
  - 涨跌
  - 板块
  - 研报
  - 策略
  - 大盘
  - 指数
---

# StocksHub API

Base URL: `http://localhost` (local proxy) or `https://stockshub.app` (direct)

## Quick Reference

### Market Overview

```bash
# 大盘指数
curl "http://localhost/api/quote/sh000001"  # 上证指数
curl "http://localhost/api/quote/399001"    # 深证成指
curl "http://localhost/api/quote/399006"    # 创业板指

# 市场统计
curl "http://localhost/api/market-stats"    # 涨跌家数、涨停跌停
curl "http://localhost/api/market-sentiment" # 情绪分数
curl "http://localhost/api/market-status"   # 开盘状态

# 排行榜
curl "http://localhost/api/market-leaders"  # 涨幅榜、跌幅榜、成交量榜

# 板块
curl "http://localhost/api/hot-sectors"     # 热门行业和概念
```

### Stock Data

```bash
# 搜索股票
curl "http://localhost/api/search?q=茅台"   # 按名称/代码/拼音搜索

# 单股行情（实时）
curl "http://localhost/api/quote/600519"    # 价格、涨跌幅、成交量

# 股票详情（基本面）
curl "http://localhost/api/detail/600519"   # 市值、PE、PB、EPS、行业、概念

# K线数据
curl "http://localhost/api/kline/600519"    # 日K线 OHLCV

# 按行业/概念查股
curl "http://localhost/api/stocks-by-industry/白酒"
curl "http://localhost/api/stocks-by-concept/人工智能"
```

### Analysis

```bash
# 策略扫描
curl "http://localhost/api/strategies"              # 策略列表
curl "http://localhost/api/strategy/放量突破"        # 策略选股结果

# 研报
curl "http://localhost/api/research/600519"         # 个股研报摘要
curl "http://localhost/api/external-reports"        # 外部研报聚合

# AI分析
curl "http://localhost/api/market-analysis"         # AI市场分析
```

## Response Formats

### Quote (行情)
```json
{
  "code": "600519",
  "name": "贵州茅台",
  "price": 1184.076,
  "changePct": 0.3747,
  "change": 4.43,
  "volume": 12345678,
  "amount": 1234567890,
  "high": 1190.0,
  "low": 1175.0,
  "open": 1180.0,
  "close": 1184.0
}
```

### Detail (详情)
```json
{
  "code": "600519",
  "name": "贵州茅台",
  "industry": "白酒",
  "marketCap": 1500000000000,
  "trailingPE": 15.91,
  "pbRatio": 8.5,
  "epsTtm": 74.5,
  "dividendYield": 1.8,
  "high52w": 1800.0,
  "low52w": 1200.0,
  "concepts": ["白酒", "消费", "MSCI"]
}
```

### Market Stats (市场统计)
```json
{
  "upCount": 2500,
  "downCount": 2300,
  "flatCount": 200,
  "limitUpCount": 50,
  "limitDownCount": 10,
  "totalAmount": 1234567890000
}
```

### Leaders (排行榜)
```json
{
  "gainers": [{"code": "300650", "name": "太龙股份", "price": 14.86, "changePct": 20.03}],
  "losers": [...],
  "volumeLeaders": [...],
  "limitUps": [...],
  "limitDowns": [...]
}
```

### Sectors (板块)
```json
{
  "industries": [
    {"name": "白酒", "stockCount": 20, "avgChangePct": 2.5}
  ],
  "concepts": [
    {"name": "人工智能", "stockCount": 100, "avgChangePct": 1.8}
  ]
}
```

## Code Examples

### Python
```python
import urllib.request
import json

def fetch_json(url):
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())

# 获取上证指数
index = fetch_json("http://localhost/api/quote/sh000001")
print(f"上证指数: {index['price']:.2f} {index['changePct']:+.2f}%")

# 搜索股票
results = fetch_json("http://localhost/api/search?q=茅台")
for s in results:
    print(f"{s['code']} {s['name']}")

# 获取详情
detail = fetch_json("http://localhost/api/detail/600519")
print(f"PE: {detail['trailingPE']}, 市值: {detail['marketCap']/1e8:.0f}亿")
```

### curl One-liners
```bash
# 今日涨停股
curl -s "http://localhost/api/market-leaders" | python3 -c "import sys,json; [print(f\"{s['code']} {s['name']} +{s['changePct']:.2f}%\") for s in json.load(sys.stdin)['limitUps']]"

# 白酒板块股票
curl -s "http://localhost/api/stocks-by-industry/白酒" | python3 -c "import sys,json; [print(f\"{s['code']} {s['name']}\") for s in json.load(sys.stdin)]"

# 市场情绪
curl -s "http://localhost/api/market-sentiment" | python3 -c "import sys,json; d=json.load(sys.stdin); print(f\"情绪分数: {d['score']} ({d['label']})\")"
```

## Notes

- **Local proxy** (`localhost`): Fast for search/details (SQLite cache), auto CORS
- **Direct API** (`stockshub.app`): For external access, may have rate limits
- **Rate limit**: ~10 req/s, 429 errors = wait 10s
- **Data freshness**: Quotes/leaders = real-time, details = synced daily
- **Database**: 2,042 A-share stocks, 1,840 with full details
- **Service**: `systemctl status stockshub` (auto-restart on crash)
