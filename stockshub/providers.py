"""Replaceable free market provider. All responses retain observation time."""
import json
import re
import urllib.request
from datetime import datetime
from urllib.parse import urlencode
from .domain import CHINA, ValidationError, now_iso, number, symbol

SEEDS = [
    ('sh600519', '贵州茅台'), ('sz000001', '平安银行'), ('sz300750', '宁德时代'),
    ('sh601318', '中国平安'), ('sz002594', '比亚迪'), ('sh600036', '招商银行'),
    ('sh601899', '紫金矿业'), ('sh600900', '长江电力'), ('sz000333', '美的集团'),
    ('sz000858', '五粮液'), ('sh688981', '中芯国际'), ('sh601088', '中国神华'),
]


class ProviderError(RuntimeError):
    pass


def envelope(code, data, as_of, basis=None):
    result = {'symbol': code, 'source': '腾讯证券', 'as_of': as_of,
              'fetched_at': now_iso(), 'cache_status': 'fresh', 'data': data}
    if basis:
        result['basis'] = basis
    return result


def parse_quote(body, code):
    symbol(code)
    match = re.search(r'v_' + re.escape(code) + r'="([^"]*)"', body)
    parts = match.group(1).split('~') if match else []
    if len(parts) < 47 or parts[2] != code[2:]:
        raise ProviderError('数据源没有返回该股票的有效行情。')
    try:
        as_of = datetime.strptime(parts[30], '%Y%m%d%H%M%S').replace(tzinfo=CHINA).isoformat()
    except ValueError:
        raise ProviderError('行情缺少有效数据时间。') from None
    data = {'name': parts[1], 'price': number(parts[3]), 'prev_close': number(parts[4]),
            'open': number(parts[5]), 'change': number(parts[31]), 'change_pct': number(parts[32]),
            'high': number(parts[33]), 'low': number(parts[34]), 'volume': number(parts[6]),
            'amount': number(parts[37]), 'turnover': number(parts[38]), 'pe': number(parts[39]),
            'market_cap': number(parts[45]), 'pb': number(parts[46])}
    if data['price'] is None or data['price'] <= 0:
        raise ProviderError('暂无有效成交价格，可能停牌或数据缺失。')
    for key, factor in [('volume', 100), ('amount', 10000), ('market_cap', 100000000)]:
        if data[key] is not None:
            data[key] *= factor
    return envelope(code, data, as_of)


def parse_history(payload, code):
    symbol(code)
    rows = payload.get('data', {}).get(code, {}).get('day', [])
    bars = {}
    for row in rows:
        if not isinstance(row, list) or len(row) < 6:
            continue
        try:
            datetime.strptime(row[0], '%Y-%m-%d')
            op, close, high, low, volume = [number(value) for value in row[1:6]]
            if any(value is None for value in (op, close, high, low, volume)):
                continue
            if low <= 0 or low > min(op, close) or high < max(op, close) or volume < 0:
                continue
            bars[row[0]] = {'date': row[0], 'open': op, 'close': close, 'high': high,
                            'low': low, 'volume': volume * 100}
        except (ValueError, TypeError):
            continue
    data = sorted(bars.values(), key=lambda row: row['date'])
    if not data:
        raise ProviderError('数据源没有返回可用的未复权日线。')
    last_date = data[-1]['date']
    as_of = datetime.fromisoformat(last_date + 'T15:00:00+08:00')
    precision = 'close'
    quotes = payload.get('data', {}).get(code, {}).get('qt', {}).get(code, [])
    if len(quotes) > 30 and quotes[30][:8] == last_date.replace('-', ''):
        try:
            actual = datetime.strptime(quotes[30], '%Y%m%d%H%M%S').replace(tzinfo=CHINA)
            if actual < as_of:
                as_of, precision = actual, 'intraday'
        except ValueError:
            pass
    if as_of > datetime.now(CHINA):
        as_of, precision = datetime.fromisoformat(last_date + 'T00:00:00+08:00'), 'date'
    return {**envelope(code, data, as_of.isoformat(), 'unadjusted'), 'time_precision': precision}


def parse_search(body):
    match = re.search(r'v_hint="(.*)"', body)
    if not match:
        raise ProviderError('搜索数据格式无效。')
    try:
        hint = json.loads('"' + match.group(1) + '"')
    except json.JSONDecodeError:
        raise ProviderError('搜索数据无法解析。') from None
    result, seen = [], set()
    for raw in hint.split('^'):
        parts = raw.split('~')
        if len(parts) < 5 or parts[4] != 'GP-A':
            continue
        code = parts[0] + parts[1]
        try:
            symbol(code)
        except ValidationError:
            continue
        if code not in seen:
            result.append({'symbol': code, 'code': code[2:], 'name': parts[2], 'exchange': code[:2].upper()})
            seen.add(code)
    return result[:30]


class TencentProvider:
    name = '腾讯证券'

    def __init__(self, timeout=8):
        self.timeout = timeout

    def read(self, url, encoding='utf-8'):
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://gu.qq.com/'})
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as response:
                payload = response.read(2 * 1024 * 1024 + 1)
                if len(payload) > 2 * 1024 * 1024:
                    raise ProviderError('数据响应超过大小限制。')
                return payload.decode(encoding)
        except (OSError, ValueError) as exc:
            raise ProviderError('免费数据源暂时无法连接，请稍后重试。') from exc

    def search(self, query):
        return parse_search(self.read('https://smartbox.gtimg.cn/s3/?' + urlencode({'q': query, 't': 'all'}), 'gb18030'))

    def quote(self, code):
        return parse_quote(self.read('https://qt.gtimg.cn/q=' + symbol(code), 'gb18030'), code)

    def history(self, code):
        url = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?' + urlencode({'param': symbol(code) + ',day,,,320,bfq'})
        try:
            return parse_history(json.loads(self.read(url)), code)
        except (json.JSONDecodeError, AttributeError) as exc:
            raise ProviderError('历史数据格式无效。') from exc
