#!/usr/bin/env python3
"""CORS代理服务器 + 本地数据库查询（stocks + details）"""
import http.server
import urllib.request
import json
import sqlite3
import os
from urllib.parse import urlparse, parse_qs

API_BASE = "https://stockshub.app"
DB_PATH = "/opt/stock-dashboard/stocks.db"

_db_conn = None

def get_db():
    global _db_conn
    if _db_conn is None or not os.path.exists(DB_PATH):
        _db_conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _db_conn.row_factory = sqlite3.Row
    return _db_conn

def search_local(query):
    """本地搜索（stocks表）"""
    if not os.path.exists(DB_PATH):
        return None
    conn = get_db()
    c = conn.cursor()
    q = f"%{query}%"
    c.execute('''SELECT code, name, region, pinyin, abbr, exchange, asset_type as assetType
                 FROM stocks 
                 WHERE code LIKE ? OR name LIKE ? OR pinyin LIKE ? OR abbr LIKE ?
                 LIMIT 20''', (q, q, q, q))
    results = [dict(row) for row in c.fetchall()]
    return results if results else None

def get_local_detail(code):
    """本地获取详情（details表）— 映射为camelCase"""
    if not os.path.exists(DB_PATH):
        return None
    conn = get_db()
    c = conn.cursor()
    c.execute('''SELECT code, name, industry, sub_industry, market_cap, float_market_cap,
                        trailing_pe, forward_pe, pb_ratio, eps_ttm, bps, dividend_yield,
                        high_52w, low_52w, turnover_rate, avg_price, ma20, ma60, concepts
                 FROM details WHERE code = ?''', (code,))
    row = c.fetchone()
    if row:
        d = dict(row)
        return {
            'code': d['code'],
            'name': d['name'],
            'industry': d['industry'],
            'subIndustry': d['sub_industry'],
            'marketCap': d['market_cap'],
            'floatMarketCap': d['float_market_cap'],
            'trailingPE': d['trailing_pe'],
            'forwardPE': d['forward_pe'],
            'pbRatio': d['pb_ratio'],
            'epsTtm': d['eps_ttm'],
            'bps': d['bps'],
            'dividendYield': d['dividend_yield'],
            'high52w': d['high_52w'],
            'low52w': d['low_52w'],
            'turnoverRate': d['turnover_rate'],
            'avgPrice': d['avg_price'],
            'ma20': d['ma20'],
            'ma60': d['ma60'],
            'concepts': json.loads(d.get('concepts') or '[]'),
        }
    return None

class CORSProxyHandler(http.server.BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_cors_headers()
        self.end_headers()
    
    def do_GET(self):
        if self.path == '/' or self.path == '/index.html':
            with open('/opt/stock-dashboard/index.html', 'rb') as f:
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.end_headers()
                self.wfile.write(f.read())
            return
        
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)
        
        # 搜索API — 优先本地
        if path == '/api/search':
            query = params.get('q', [''])[0]
            if query:
                local_results = search_local(query)
                if local_results:
                    self.send_json(local_results)
                    return
            try:
                data = self.fetch_remote(f"{API_BASE}{self.path}")
                self.send_json(data)
            except Exception as e:
                self.send_error_response(str(e))
            return
        
        # 单股详情 — 优先本地
        if path.startswith('/api/detail/'):
            code = path.split('/')[-1]
            local_detail = get_local_detail(code)
            if local_detail:
                self.send_json(local_detail)
                return
        
        # 其他API（行情、全部股票、K线、榜单等）— 全走远程
        if path.startswith('/api/'):
            try:
                data = self.fetch_remote(f"{API_BASE}{self.path}")
                self.send_json(data)
            except Exception as e:
                self.send_error_response(str(e))
            return
        
        self.send_response(404)
        self.end_headers()
    
    def fetch_remote(self, url):
        req = urllib.request.Request(url)
        req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
        req.add_header('Accept', 'application/json')
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.loads(response.read())
    
    def send_json(self, data):
        content = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(content)
    
    def send_error_response(self, message):
        content = json.dumps({"error": message}).encode('utf-8')
        self.send_response(500)
        self.send_header('Content-Type', 'application/json')
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(content)
    
    def send_cors_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
    
    def log_message(self, format, *args):
        pass

if __name__ == '__main__':
    port = 80
    if os.path.exists(DB_PATH):
        conn = get_db()
        c = conn.cursor()
        c.execute("SELECT COUNT(*) FROM stocks")
        stocks = c.fetchone()[0]
        c.execute("SELECT COUNT(*) FROM details")
        details = c.fetchone()[0]
        print(f"Database loaded: {stocks} stocks, {details} details")
    else:
        print("Warning: Database not found. Run sync_stocks.py first.")
    
    server = http.server.HTTPServer(('0.0.0.0', port), CORSProxyHandler)
    print(f"Server started on port {port}")
    server.serve_forever()
