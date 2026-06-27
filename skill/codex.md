# StocksHub API

A-share market data API.

## API

```bash
# 市场
curl "http://localhost/api/quote/sh000001"    # 上证指数
curl "http://localhost/api/market-stats"      # 涨跌统计
curl "http://localhost/api/market-leaders"    # 排行榜
curl "http://localhost/api/hot-sectors"       # 热门板块

# 股票
curl "http://localhost/api/search?q=茅台"     # 搜索
curl "http://localhost/api/quote/600519"      # 行情
curl "http://localhost/api/detail/600519"     # 详情
curl "http://localhost/api/kline/600519"      # K线

# 分析
curl "http://localhost/api/strategies"        # 策略列表
curl "http://localhost/api/research/600519"   # 研报
```

## Python

```python
import urllib.request, json

def api(path):
    with urllib.request.urlopen(f"http://localhost{path}", timeout=10) as r:
        return json.loads(r.read())

# 使用
index = api("/api/quote/sh000001")
stocks = api("/api/search?q=茅台")
detail = api("/api/detail/600519")
```
