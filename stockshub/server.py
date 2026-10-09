"""Loopback HTTP application. Static files are explicitly allowlisted."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit
from . import __version__
from .config import Config, ROOT
from .domain import ValidationError, symbol, validate_stock
from .providers import ProviderError, TencentProvider
from .service import Service
from .store import Store, encode

LOG = logging.getLogger('stockshub')
CSP = ("default-src 'self'; script-src 'self' https://qt.gtimg.cn https://smartbox.gtimg.cn https://web.ifzq.gtimg.cn; "
       "style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'")


def handler_for(service):
    class Handler(BaseHTTPRequestHandler):
        server_version = 'StocksHub/' + __version__
        protocol_version = 'HTTP/1.1'

        def do_GET(self):
            self.dispatch('GET')

        def do_POST(self):
            self.dispatch('POST')

        def do_PATCH(self):
            self.dispatch('PATCH')

        def do_DELETE(self):
            self.dispatch('DELETE')

        def dispatch(self, method):
            try:
                # Reject DNS rebinding, including read access to private journals.
                host = urlsplit('http://' + self.headers.get('Host', '')).hostname
                if host not in ('localhost', '127.0.0.1', '::1'):
                    self.respond({'error': '仅允许通过本机地址访问。'}, 403)
                    return
                if method != 'GET':
                    origin = self.headers.get('Origin')
                    expected = 'http://' + self.headers.get('Host', '')
                    if (origin and origin != expected) or self.headers.get('Sec-Fetch-Site') == 'cross-site':
                        self.respond({'error': '禁止跨站写入本地研究数据。'}, 403)
                        return
                parsed = urlsplit(self.path)
                path, query = unquote(parsed.path), parse_qs(parsed.query)
                if method == 'GET' and path == '/site-config.json':
                    self.respond({'mode': 'server', 'version': __version__})
                    return
                if method == 'GET' and path == '/health':
                    self.respond({'status': 'ok', 'version': __version__, 'mode': 'server'})
                    return
                if path.startswith('/api/'):
                    self.route(method, path[5:].strip('/').split('/'), query)
                elif method == 'GET':
                    self.static(path)
                else:
                    self.respond({'error': '接口不存在。'}, 404)
            except ValidationError as exc:
                self.respond({'error': str(exc)}, 400)
            except KeyError:
                self.respond({'error': '记录不存在。'}, 404)
            except ProviderError as exc:
                self.respond({'error': str(exc)}, 502)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception:
                LOG.exception('Request failed')
                self.respond({'error': '本地服务处理失败，请检查终端日志后重试。'}, 500)

        def body(self):
            if self.headers.get_content_type() != 'application/json':
                raise ValidationError('写入请求必须使用 application/json。')
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if size <= 0 or size > service.config.max_body:
                    raise ValidationError('请求为空或超过 5 MB。')
                data = json.loads(self.rfile.read(size), parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
                if not isinstance(data, dict):
                    raise ValueError()
                return data
            except (ValueError, UnicodeError):
                raise ValidationError('请求必须是有效 JSON 对象，且不超过 5 MB。') from None

        def route(self, method, parts, query):
            key = parts[0]
            if method == 'GET' and key in ('quote', 'history') and len(parts) == 2:
                self.respond(service.market(key, parts[1], query.get('refresh') == ['1']))
            elif method == 'GET' and parts == ['search']:
                self.respond(service.search(query.get('q', [''])[0]))
            elif parts == ['watchlist'] and method == 'GET':
                self.respond({'items': service.store.watchlist()})
            elif parts == ['watchlist'] and method == 'POST':
                self.respond(service.store.add_stock(validate_stock(self.body())), 201)
            elif key == 'watchlist' and len(parts) == 2 and method == 'DELETE':
                service.store.remove_stock(symbol(parts[1]))
                self.respond({'removed': True})
            elif parts == ['journals'] and method == 'GET':
                self.respond({'items': service.store.journals()})
            elif parts == ['journals'] and method == 'POST':
                self.respond(service.create_journal(self.body()), 201)
            elif key == 'journals' and len(parts) == 2 and method == 'GET':
                self.respond(service.store.journal(parts[1]))
            elif key == 'journals' and len(parts) == 2 and method == 'PATCH':
                self.respond(service.update_journal(parts[1], self.body()))
            elif key == 'journals' and len(parts) == 3 and parts[2] == 'reviews' and method == 'POST':
                self.respond(service.add_review(parts[1], self.body()), 201)
            elif parts == ['backup'] and method == 'GET':
                self.respond(service.store.backup())
            elif parts == ['restore'] and method == 'POST':
                self.respond(service.store.restore(self.body()))
            else:
                self.respond({'error': '接口不存在。'}, 404)

        def static(self, path):
            if path == '/':
                path = '/index.html'
            if path != '/index.html' and not path.startswith(('/assets/', '/data/')):
                self.respond({'error': '文件不存在。'}, 404)
                return
            target = (ROOT / path.lstrip('/')).resolve()
            allowed_root = ROOT if path == '/index.html' else ROOT / path.split('/')[1]
            if not target.is_relative_to(allowed_root) or not target.is_file():
                self.respond({'error': '文件不存在。'}, 404)
                return
            mime = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
                    '.json': 'application/json', '.svg': 'image/svg+xml'}.get(target.suffix)
            if mime is None:
                self.respond({'error': '文件不存在。'}, 404)
                return
            self.send_content(target.read_bytes(), mime + '; charset=utf-8')

        def respond(self, data, status=200):
            self.send_content(encode(data).encode('utf-8'), 'application/json; charset=utf-8', status)

        def send_content(self, content, mime, status=200):
            self.send_response(status)
            self.send_header('Content-Type', mime)
            self.send_header('Content-Length', str(len(content)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Content-Security-Policy', CSP)
            self.send_header('Referrer-Policy', 'no-referrer')
            self.end_headers()
            self.wfile.write(content)

        def log_message(self, fmt, *args):
            LOG.info('%s %s', self.address_string(), fmt % args)
    return Handler


def create_server(config=None, provider=None):
    config = config or Config()
    service = Service(Store(config.database), provider or TencentProvider(config.timeout), config)
    return ThreadingHTTPServer((config.host, config.port), handler_for(service))


def main():
    parser = argparse.ArgumentParser(description='启动 StocksHub 本机研究工作台。')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--database', type=Path, default=Config().database)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    server = create_server(Config(database=args.database.resolve(), port=args.port))
    print(f'StocksHub: http://127.0.0.1:{server.server_port}', flush=True)
    print(f'Database: {args.database.resolve()}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
