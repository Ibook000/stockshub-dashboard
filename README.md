# StocksHub Dashboard

A-share market dashboard with real-time data, built with vanilla HTML/JS and Python.

![Python](https://img.shields.io/badge/Python-3.10+-blue)
![SQLite](https://img.shields.io/badge/SQLite-3-green)
![License](https://img.shields.io/badge/License-MIT-yellow)

## Features

- **Real-time Indices** — 上证/深证/创业板 实时行情
- **Market Overview** — 涨跌统计、情绪分数、热门板块
- **Stock Search** — 按代码/名称/拼音搜索 2000+ A股
- **Stock Details** — 基本面数据：PE、PB、市值、行业、概念
- **K-line Charts** — 专业K线图（Lightweight Charts）
- **Strategy Scanner** — 多种选股策略一键扫描
- **Research Reports** — 研报摘要与外部研报聚合
- **Favorites** — 自选股（本地存储）
- **Responsive** — 移动端适配

## Quick Start

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/stockshub-dashboard.git
cd stockshub-dashboard

# Install dependencies (none required, pure stdlib)

# Sync stock data
python3 sync_stocks.py

# Start server
python3 proxy_server.py

# Open http://localhost
```

## Architecture

```
                    ┌─────────────┐
                    │   Browser   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ proxy_server│ :80
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
        ┌─────▼─────┐ ┌───▼───┐ ┌─────▼─────┐
        │ stocks.db │ │ Cache │ │ StocksHub │
        │  (local)  │ │       │ │   API     │
        └───────────┘ └───────┘ └───────────┘
```

**Local DB** — Fast search + basic info (stocks, details)
**Remote API** — Real-time data (quotes, kline, leaders)

## API Endpoints

| Endpoint | Source | Description |
|----------|--------|-------------|
| `GET /api/search?q=xxx` | Local→Remote | Search stocks |
| `GET /api/detail/{code}` | Local→Remote | Stock fundamentals |
| `GET /api/quote/{code}` | Remote | Real-time quote |
| `GET /api/kline/{code}` | Remote | K-line data |
| `GET /api/market-stats` | Remote | Market statistics |
| `GET /api/market-sentiment` | Remote | Sentiment score |
| `GET /api/market-leaders` | Remote | Gainers/Losers |
| `GET /api/hot-sectors` | Remote | Hot sectors |
| `GET /api/strategies` | Remote | Strategy list |
| `GET /api/strategy/{name}` | Remote | Strategy scan |
| `GET /api/research/{code}` | Remote | Research reports |
| `GET /api/external-reports` | Remote | External reports |
| `GET /api/market-analysis` | Remote | AI analysis |
| `GET /api/market-status` | Remote | Market status |

## Database Schema

```sql
-- Stock list
CREATE TABLE stocks (
    code TEXT PRIMARY KEY,
    name TEXT,
    pinyin TEXT,
    exchange TEXT,
    asset_type INTEGER
);

-- Fundamentals
CREATE TABLE details (
    code TEXT PRIMARY KEY,
    name TEXT,
    industry TEXT,
    market_cap REAL,
    trailing_pe REAL,
    pb_ratio REAL,
    eps_ttm REAL,
    concepts TEXT  -- JSON array
);
```

## Deployment

### Systemd Service

```bash
# Create service file
sudo tee /etc/systemd/system/stockshub.service << 'EOF'
[Unit]
Description=StocksHub Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/stock-dashboard
ExecStart=/usr/bin/python3 proxy_server.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable stockshub
sudo systemctl start stockshub
```

### Docker (optional)

```dockerfile
FROM python:3.10-slim
WORKDIR /app
COPY . .
RUN python3 sync_stocks.py
EXPOSE 80
CMD ["python3", "proxy_server.py"]
```

## Tech Stack

- **Frontend**: Vanilla HTML/CSS/JS (no framework)
- **Charts**: [Lightweight Charts](https://github.com/nicedoc/lightweight-charts) v4
- **Backend**: Python http.server (stdlib)
- **Database**: SQLite3 (stdlib)
- **API**: [StocksHub](https://stockshub.app)

Zero dependencies. Just Python 3.10+.

## Contributing

1. Fork the repo
2. Create feature branch
3. Commit changes
4. Push to branch
5. Open Pull Request

## License

MIT License - see [LICENSE](LICENSE) file.

## Acknowledgments

- [StocksHub](https://stockshub.app) for the API
- [Lightweight Charts](https://tradingview.github.io/lightweight-charts/) for K-line charts
