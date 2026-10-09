"""Isolated test servers. Fake data is never part of the shipped application."""
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
from pathlib import Path
import sys
import tempfile
from threading import Thread

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from stockshub.config import Config
from stockshub.domain import now_iso
from stockshub.providers import ProviderError
from stockshub.server import create_server


class TestProvider:
    name = '自动化测试来源'
    def search(self, query):
        return [{'symbol': 'sh600519', 'code': '600519', 'exchange': 'SH', 'name': '贵州茅台'}]
    def quote(self, code):
        if code == 'sz002415':
            raise ProviderError('测试：来源不可用')
        return {'symbol': code, 'source': self.name, 'as_of': (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(),
                'fetched_at': now_iso(), 'cache_status': 'fresh', 'data': {'name': '贵州茅台' if code == 'sh600519' else '测试股票',
                'price': 100, 'prev_close': 99, 'change': 1, 'change_pct': 1.01, 'high': 102, 'low': 98, 'open': 99,
                'volume': 100000, 'amount': 10000000, 'turnover': 1, 'pe': 20, 'pb': 2, 'market_cap': 1e9}}
    def history(self, code):
        if code in ('sz002415', 'sz002475'):
            raise ProviderError('测试：历史来源不可用')
        bars = []
        for offset in range(100, 0, -1):
            date = (datetime.now(timezone.utc) - timedelta(days=offset)).date().isoformat()
            price = 100 - offset / 10
            bars.append({'date': date, 'open': price - .1, 'close': price, 'low': price - 1, 'high': price + 1, 'volume': 100000})
        return {'symbol': code, 'source': self.name, 'basis': 'unadjusted', 'as_of': bars[-1]['date'] + 'T15:00:00+08:00',
                'fetched_at': now_iso(), 'cache_status': 'fresh', 'data': bars}


class StaticHandler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    def do_GET(self):
        if not self.path.startswith('/stockshub-dashboard/'):
            self.send_error(404)
            return
        self.path = self.path[len('/stockshub-dashboard'):]
        super().do_GET()
    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    with tempfile.TemporaryDirectory() as directory:
        local = create_server(Config(database=Path(directory) / 'test.db', port=8767), TestProvider())
        static = ThreadingHTTPServer(('127.0.0.1', 8766), partial(StaticHandler, directory=str(ROOT / 'site')))
        Thread(target=local.serve_forever, daemon=True).start()
        print('Test servers ready: static :8766/stockshub-dashboard/, SQLite :8767', flush=True)
        try:
            static.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            local.shutdown(); local.server_close(); static.server_close()
