# StocksHub API

A-share market data API for stock queries.

## Quick Start

```bash
# Start server
python3 proxy_server.py

# API base: http://localhost
```

## API Endpoints

### Market

```bash
# 大盘指数
curl "http://localhost/api/quote/sh000001"    # 上证指数
curl "http://localhost/api/quote/399001"      # 深证成指
curl "http://localhost/api/quote/399006"      # 创业板指

# 市场统计
curl "http://localhost/api/market-stats"      # 涨跌家数
curl "http://localhost/api/market-sentiment"  # 情绪分数
curl "http://localhost/api/market-leaders"    # 排行榜
curl "http://localhost/api/hot-sectors"       # 热门板块
```

### Stock

```bash
# 搜索
curl "http://localhost/api/search?q=茅台"

# 行情（实时）
curl "http://localhost/api/quote/600519"

# 详情（基本面）
curl "http://localhost/api/detail/600519"

# K线
curl "http://localhost/api/kline/600519"

# 按行业/概念
curl "http://localhost/api/stocks-by-industry/白酒"
curl "http://localhost/api/stocks-by-concept/人工智能"
```

### Analysis

```bash
# 策略
curl "http://localhost/api/strategies"
curl "http://localhost/api/strategy/放量突破"

# 研报
curl "http://localhost/api/research/600519"
curl "http://localhost/api/external-reports"

# AI分析
curl "http://localhost/api/market-analysis"
```

## Response Examples

### Quote
```json
{
  "code": "600519",
  "name": "贵州茅台",
  "price": 1184.076,
  "changePct": 0.3747,
  "volume": 12345678,
  "amount": 1234567890
}
```

### Detail
```json
{
  "code": "600519",
  "name": "贵州茅台",
  "industry": "白酒",
  "marketCap": 1500000000000,
  "trailingPE": 15.91,
  "pbRatio": 8.5,
  "concepts": ["白酒", "消费"]
}
```

## Python Example

```python
import urllib.request
import json

def fetch_json(url):
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())

# 获取指数
index = fetch_json("http://localhost/api/quote/sh000001")
print(f"上证: {index['price']:.2f}")

# 搜索
results = fetch_json("http://localhost/api/search?q=茅台")
for s in results:
    print(f"{s['code']} {s['name']}")
```

## Notes

- Rate limit: ~10 req/s
- Local proxy: `http://localhost` (auto CORS)
- Direct API: `https://stockshub.app`
- Database: 2,042 A-share stocks
