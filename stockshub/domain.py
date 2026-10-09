"""Validation and price comparisons, independent of network and storage."""
from datetime import datetime, timezone, timedelta, date
import math
import re
import uuid

CHINA = timezone(timedelta(hours=8))
SYMBOL = re.compile(r'^(sh(?:600|601|603|605|688|689)\d{3}|sz(?:000|001|002|003|300|301)\d{3}|bj(?:4\d|8\d|92)\d{4})$')


class ValidationError(ValueError):
    pass


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def symbol(value):
    if not isinstance(value, str) or not SYMBOL.fullmatch(value.lower()):
        raise ValidationError('请输入带市场前缀的 A 股代码，例如 sh600519 或 sz000001。')
    return value.lower()


def text(value, label, limit=5000, required=True):
    if not isinstance(value, str) or len(value.strip()) > limit or (required and not value.strip()):
        raise ValidationError(f'{label}不能为空，且不能超过 {limit} 个字符。' if required else f'{label}不能超过 {limit} 个字符。')
    return value.strip()


def valid_date(value):
    try:
        if not isinstance(value, str) or date.fromisoformat(value).isoformat() != value:
            raise ValueError()
    except ValueError:
        raise ValidationError('复盘日期必须是有效日期，格式为 YYYY-MM-DD。') from None
    return value


def record_id(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}', value):
        raise ValidationError('记录 ID 只能包含字母、数字、短横线和下划线。')
    return value


def number(value):
    if isinstance(value, bool) or value is None or value == '':
        return None
    try:
        result = float(value)
        return result if math.isfinite(result) else None
    except (TypeError, ValueError):
        return None


def validate_stock(data):
    if not isinstance(data, dict):
        raise ValidationError('股票数据格式无效。')
    code = symbol(data.get('symbol'))
    return {'symbol': code, 'code': code[2:], 'name': text(data.get('name'), '股票名称', 80),
            'exchange': code[:2].upper()}


def journal_fields(data):
    if not isinstance(data, dict):
        raise ValidationError('研究记录格式无效。')
    return {**validate_stock(data), 'title': text(data.get('title'), '研究标题', 120),
            'thesis': text(data.get('thesis'), '研究理由'),
            'validation': text(data.get('validation'), '验证条件'),
            'risk': text(data.get('risk', ''), '风险', required=False),
            'review_date': valid_date(data.get('review_date'))}


def new_journal(data, baseline=None):
    return {**journal_fields(data), 'id': uuid.uuid4().hex, 'created_at': now_iso(),
            'updated_at': now_iso(), 'baseline': baseline, 'reviews': [], 'revisions': [], 'archived': False}


def comparison(entry, quote=None, history=None, now=None):
    """Only observations after note creation count; prices are unadjusted."""
    baseline = entry.get('baseline')
    if not baseline or not baseline.get('as_of') or not baseline.get('data'):
        return {'status': 'no_baseline', 'message': '创建时没有可用行情，不能计算价格变化。'}
    base = number(baseline['data'].get('price'))
    if base is None or base <= 0:
        return {'status': 'no_baseline', 'message': '基准价格无效。'}
    try:
        created = datetime.fromisoformat(entry['created_at'])
        base_at = datetime.fromisoformat(baseline['as_of'])
        cutoff = max(created, base_at)
    except (KeyError, TypeError, ValueError):
        return {'status': 'no_baseline', 'message': '基准时间无效。'}
    observations = []
    now = now or datetime.now(timezone.utc)
    if history and history.get('basis') == 'unadjusted':
        for bar in history.get('data', []):
            try:
                at = datetime.fromisoformat(bar['date'] + 'T15:00:00+08:00')
                price = number(bar.get('close'))
                if bar['date'] == str(history.get('as_of', ''))[:10]:
                    at = min(at, datetime.fromisoformat(history['as_of']))
                if cutoff < at <= now and price and price > 0:
                    observations.append((at, price, history))
            except (KeyError, ValueError, TypeError):
                continue
    if quote and quote.get('as_of'):
        try:
            at = datetime.fromisoformat(quote['as_of'])
            price = number(quote.get('data', {}).get('price'))
            if cutoff < at <= now and price and price > 0:
                observations.append((at, price, quote))
        except (KeyError, ValueError, TypeError):
            pass
    if not observations:
        return {'status': 'waiting', 'message': '暂无研究创建之后的行情，等待后续数据。'}
    at, price, packet = max(observations, key=lambda item: item[0])
    return {'status': 'available', 'baseline_price': base, 'baseline_as_of': baseline['as_of'],
            'price': price, 'as_of': at.isoformat(), 'source': packet['source'],
            'cache_status': packet.get('cache_status', 'unknown'), 'warning': packet.get('warning'),
            'change_pct': round((price / base - 1) * 100, 4),
            'basis': '未复权价格变化，不含分红、费用，不代表交易收益。'}


def validate_snapshot(snapshot, expected_symbol):
    if not isinstance(snapshot, dict) or snapshot.get('symbol') != expected_symbol:
        raise ValidationError('行情快照的股票标识不一致。')
    text(snapshot.get('source'), '数据来源', 100)
    if datetime.fromisoformat(snapshot['as_of']).tzinfo is None:
        raise ValidationError('行情快照缺少时间。')
    raw = snapshot.get('data', {}).get('price')
    value = number(raw)
    if not isinstance(raw, (int, float)) or isinstance(raw, bool) or value is None or value <= 0:
        raise ValidationError('行情快照价格无效。')


def validate_backup(data):
    if not isinstance(data, dict) or data.get('format') != 'stockshub-backup' or data.get('version') != 1:
        raise ValidationError('请选择 StocksHub 导出的 v1 备份文件。')
    watches, entries = data.get('watchlist'), data.get('journals')
    if not isinstance(watches, list) or not isinstance(entries, list) or len(watches) > 1000 or len(entries) > 10000:
        raise ValidationError('备份内容或记录数量无效。')
    stocks = [validate_stock(item) for item in watches]
    journals, seen = [], set()
    for item in entries:
        if not isinstance(item, dict):
            raise ValidationError('备份研究记录格式无效。')
        fields = journal_fields(item)
        entry_id = record_id(item.get('id'))
        if entry_id in seen:
            raise ValidationError('备份中存在重复的研究 ID。')
        seen.add(entry_id)
        try:
            for field in ('created_at', 'updated_at'):
                if datetime.fromisoformat(item[field]).tzinfo is None:
                    raise ValueError()
            baseline = item.get('baseline')
            if baseline is not None:
                validate_snapshot(baseline, fields['symbol'])
            reviews, revisions = item.get('reviews', []), item.get('revisions', [])
            if not isinstance(reviews, list) or not isinstance(revisions, list) or len(reviews) > 1000 or len(revisions) > 1000:
                raise ValueError()
            for review in reviews:
                record_id(review.get('id'))
                text(review.get('conclusion'), '复盘结论')
                if review.get('verdict') not in ('confirmed', 'rejected', 'uncertain'):
                    raise ValueError()
                if datetime.fromisoformat(review['created_at']).tzinfo is None:
                    raise ValueError()
                if review.get('snapshot') is not None:
                    validate_snapshot(review['snapshot'], fields['symbol'])
                review['comparison'] = comparison(item, review.get('snapshot'))
            for revision in revisions:
                journal_fields(revision)
                if datetime.fromisoformat(revision['revised_at']).tzinfo is None:
                    raise ValueError()
        except (KeyError, TypeError, ValueError, AttributeError):
            raise ValidationError('备份中的日期、快照或复盘记录无效。') from None
        journals.append({**fields, 'id': entry_id, 'created_at': item['created_at'],
                         'updated_at': item['updated_at'], 'baseline': baseline, 'reviews': reviews,
                         'revisions': revisions, 'archived': item.get('archived') is True})
    return stocks, journals
