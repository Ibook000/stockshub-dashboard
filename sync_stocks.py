#!/usr/bin/env python3
"""同步股票基础信息（stocks + details）"""
import sqlite3
import urllib.request
import json
import time

API_BASE = "https://stockshub.app"
DB_PATH = "/opt/stock-dashboard/stocks.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS stocks (
        code TEXT PRIMARY KEY, name TEXT, region TEXT DEFAULT 'CN',
        pinyin TEXT, abbr TEXT, exchange TEXT, asset_type INTEGER DEFAULT 1,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS details (
        code TEXT PRIMARY KEY, name TEXT, industry TEXT, sub_industry TEXT,
        market_cap REAL, float_market_cap REAL, trailing_pe REAL, forward_pe REAL,
        pb_ratio REAL, eps_ttm REAL, bps REAL, dividend_yield REAL,
        high_52w REAL, low_52w REAL, turnover_rate REAL, avg_price REAL,
        ma20 REAL, ma60 REAL, concepts TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('CREATE INDEX IF NOT EXISTS idx_stocks_name ON stocks(name)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_stocks_pinyin ON stocks(pinyin)')
    c.execute('CREATE INDEX IF NOT EXISTS idx_details_industry ON details(industry)')
    conn.commit()
    return conn

def fetch_json(url):
    req = urllib.request.Request(url)
    req.add_header('User-Agent', 'Mozilla/5.0')
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())

def sync_all_stocks(conn):
    """用4位前缀搜索所有股票"""
    print("Syncing all stocks with 4-digit prefixes...")
    
    c = conn.cursor()
    all_stocks = {}
    
    # 生成所有可能的4位前缀
    prefixes = []
    
    # 上交所: 6000-6099, 6010-6019, 6030-6039, 6050-6059
    for i in range(6000, 6060):
        prefixes.append(str(i))
    
    # 深交所主板: 0000-0039
    for i in range(0, 40):
        prefixes.append(f"{i:04d}")
    
    # 创业板: 3000-3019
    for i in range(3000, 3020):
        prefixes.append(str(i))
    
    # 科创板: 6880-6889
    for i in range(6880, 6890):
        prefixes.append(str(i))
    
    # 北交所: 8300-8399, 8700-8799, 4300-4399
    for i in range(8300, 8400):
        prefixes.append(str(i))
    for i in range(8700, 8800):
        prefixes.append(str(i))
    for i in range(4300, 4400):
        prefixes.append(str(i))
    
    total_prefixes = len(prefixes)
    print(f"  Searching {total_prefixes} prefixes...")
    
    for idx, prefix in enumerate(prefixes):
        try:
            data = fetch_json(f"{API_BASE}/api/search?q={prefix}")
            for s in data:
                code = s['code']
                if code not in all_stocks:
                    all_stocks[code] = s
            time.sleep(0.15)  # 限速
        except Exception as e:
            if "429" in str(e):
                print(f"    Rate limited at {prefix}, waiting 10s...")
                time.sleep(10)
            pass
        
        if (idx + 1) % 50 == 0:
            print(f"  Progress: {idx+1}/{total_prefixes} ({len(all_stocks)} stocks found)")
    
    # 写入数据库
    for code, s in all_stocks.items():
        c.execute('''INSERT OR REPLACE INTO stocks (code, name, region, pinyin, abbr, exchange, asset_type, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)''',
                  (s['code'], s['name'], s.get('region', 'CN'), s.get('pinyin', ''),
                   s.get('abbr', ''), s.get('exchange', ''), s.get('assetType', 1)))
    
    conn.commit()
    print(f"  Total: {len(all_stocks)} stocks synced")
    return list(all_stocks.keys())

def sync_details_batch(conn, max_count=None):
    """同步详情 - 全量"""
    c = conn.cursor()
    c.execute('''SELECT s.code FROM stocks s 
                 LEFT JOIN details d ON s.code = d.code 
                 WHERE d.code IS NULL''')
    missing = [row[0] for row in c.fetchall()]
    if max_count:
        missing = missing[:max_count]
    
    if not missing:
        print("All details synced!")
        return
    
    print(f"Syncing details for {len(missing)} stocks...")
    synced = 0
    errors = 0
    
    for i, code in enumerate(missing):
        try:
            data = fetch_json(f"{API_BASE}/api/detail/{code}")
            concepts = json.dumps(data.get('concepts', []), ensure_ascii=False)
            
            c.execute('''INSERT OR REPLACE INTO details 
                         (code, name, industry, sub_industry, market_cap, float_market_cap,
                          trailing_pe, forward_pe, pb_ratio, eps_ttm, bps, dividend_yield,
                          high_52w, low_52w, turnover_rate, avg_price, ma20, ma60, concepts, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)''',
                      (code, data.get('name', ''), data.get('industry', ''), data.get('subIndustry', ''),
                       data.get('marketCap', 0), data.get('floatMarketCap', 0),
                       data.get('trailingPE', 0), data.get('forwardPE', 0), data.get('pbRatio', 0),
                       data.get('epsTtm', 0), data.get('bps', 0), data.get('dividendYield', 0),
                       data.get('high52w', 0), data.get('low52w', 0), data.get('turnoverRate', 0),
                       data.get('avgPrice', 0), data.get('ma20', 0), data.get('ma60', 0),
                       concepts))
            synced += 1
            time.sleep(0.3)
        except Exception as e:
            errors += 1
            if "429" in str(e):
                time.sleep(10)
        
        if (i + 1) % 50 == 0:
            conn.commit()
            print(f"  Progress: {i+1}/{len(missing)} ({synced} synced, {errors} errors)")
    
    conn.commit()
    print(f"  Details: {synced} synced, {errors} errors")

def main():
    print("=" * 50)
    print("StocksHub - Stocks + Details Sync")
    print("=" * 50)
    
    conn = init_db()
    
    # 获取所有股票
    sync_all_stocks(conn)
    
    # 同步详情（全量）
    sync_details_batch(conn)
    
    # 统计
    c = conn.cursor()
    c.execute("SELECT COUNT(*) FROM stocks")
    stocks = c.fetchone()[0]
    c.execute("SELECT COUNT(*) FROM details")
    details = c.fetchone()[0]
    
    print("\n" + "=" * 50)
    print(f"Final: {stocks} stocks, {details} details")
    print("=" * 50)

if __name__ == "__main__":
    main()
