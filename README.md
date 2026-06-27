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

## AI Agent Skill

这个项目包含一个 Hermes Agent skill，让 AI 可以直接调用 API 获取数据。

### 什么是 Skill

Skill 是 Hermes Agent 的知识库文件，告诉 AI 如何使用特定工具或 API。安装后，AI 会自动识别相关问题并调用正确的 API。

### 安装 Skill

```bash
# 1. 创建 skill 目录
mkdir -p ~/.hermes/skills/stockshub-api

# 2. 复制 skill 文件
cp skill/stockshub-api.md ~/.hermes/skills/stockshub-api/SKILL.md

# 3. 验证安装
hermes skills list | grep stockshub
```

### 使用方式

安装后，直接用自然语言提问即可：

```
"上证指数今天多少？"
"帮我查一下贵州茅台的PE"
"今天涨停的股票有哪些？"
"白酒板块的股票列表"
"搜索名字带新能源的股票"
```

AI 会自动：
1. 加载 stockshub-api skill
2. 调用对应的 API
3. 格式化返回结果

### 触发词

以下关键词会自动触发 skill：

- 市场类：大盘、指数、涨跌、涨停、跌停、情绪
- 股票类：股票、A股、股价、行情、K线
- 分析类：板块、行业、概念、策略、研报

### API 端点

| 端点 | 说明 | 示例 |
|------|------|------|
| `/api/search` | 搜索股票 | `?q=茅台` |
| `/api/quote/{code}` | 实时行情 | `/quote/600519` |
| `/api/detail/{code}` | 基本面 | `/detail/600519` |
| `/api/kline/{code}` | K线数据 | `/kline/600519` |
| `/api/market-stats` | 市场统计 | 涨跌家数 |
| `/api/market-leaders` | 排行榜 | 涨幅榜/跌幅榜 |
| `/api/hot-sectors` | 热门板块 | 行业/概念 |
| `/api/strategies` | 策略列表 | 选股策略 |
| `/api/research/{code}` | 研报摘要 | 个股研报 |

详见 [skill/stockshub-api.md](skill/stockshub-api.md)

## 兼容性

支持多种 AI Agent：

| Agent | 配置文件 | 安装命令 |
|-------|---------|---------|
| Hermes | `skill/stockshub-api.md` | `cp skill/stockshub-api.md ~/.hermes/skills/stockshub-api/SKILL.md` |
| Claude Code | `skill/CLAUDE.md` | `cp skill/CLAUDE.md ./CLAUDE.md` |
| Codex | `skill/codex.md` | `cp skill/codex.md ./codex.md` |
| Cursor | `skill/.cursorrules` | `cp skill/.cursorrules ./.cursorrules` |
| OpenClaw | `skill/openclaw/` | `cp skill/openclaw/* ~/.openclaw/skills/` |

所有格式都包含相同的 API 文档，只是格式不同。

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
