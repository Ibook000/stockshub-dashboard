import json
from datetime import datetime, timezone
from threading import Lock
import uuid
from .config import ROOT
from .domain import (ValidationError, comparison, journal_fields, new_journal,
                     now_iso, symbol, text, validate_stock)
from .providers import ProviderError, SEEDS


class Service:
    def __init__(self, store, provider, config):
        self.store, self.provider, self.config = store, provider, config
        self._locks = {}
        self._guard = Lock()
        try:
            self.snapshot = json.loads((ROOT / 'data' / 'market.json').read_text(encoding='utf-8'))
        except (OSError, ValueError):
            self.snapshot = {}

    def market(self, kind, code, refresh=False):
        code = symbol(code)
        key = kind + ':' + code
        with self._guard:
            lock = self._locks.setdefault(key, Lock())
        with lock:
            cached = self.store.cached(key)
            ttl = self.config.quote_ttl if kind == 'quote' else self.config.history_ttl
            if cached and not refresh:
                age = (datetime.now(timezone.utc) - datetime.fromisoformat(cached['fetched_at'])).total_seconds()
                if 0 <= age < ttl:
                    return {**cached, 'cache_status': 'cached'}
            try:
                data = getattr(self.provider, kind)(code)
                self.store.cache(key, data)
                return data
            except ProviderError:
                fallback = cached or self.snapshot.get('quotes' if kind == 'quote' else 'histories', {}).get(code)
                if fallback:
                    return {**fallback, 'cache_status': 'fallback', 'warning': '在线来源不可用，显示上次保存的数据。'}
                raise

    def safe_quote(self, code):
        try:
            return self.market('quote', code)
        except ProviderError:
            return None

    def search(self, query):
        query = text(query, '搜索内容', 80).lower()
        local = self.store.watchlist() + [{'symbol': code, 'code': code[2:], 'name': name,
                                          'exchange': code[:2].upper()} for code, name in SEEDS]
        matches = {s['symbol']: s for s in local if query in s['symbol'] or query in s['name'].lower()}
        try:
            for stock in self.provider.search(query):
                matches[stock['symbol']] = stock
            return {'items': list(matches.values())[:30], 'source': self.provider.name, 'offline': False}
        except ProviderError:
            return {'items': list(matches.values())[:30], 'source': '本地自选与起始列表', 'offline': True,
                    'warning': '在线搜索不可用；当前结果只覆盖本地列表。'}

    def create_journal(self, body):
        fields = journal_fields(body)
        return self.store.create_journal(new_journal(fields, self.safe_quote(fields['symbol'])))

    def update_journal(self, entry_id, body):
        def update(entry):
            if set(body) == {'archived'} and isinstance(body['archived'], bool):
                entry['archived'] = body['archived']
                return
            fields = journal_fields(body)
            if fields['symbol'] != entry['symbol']:
                raise ValidationError('研究创建后不能更换股票；请创建新的研究。')
            entry['revisions'].append({**journal_fields(entry), 'revised_at': now_iso()})
            entry.update(fields)
        return self.store.mutate_journal(entry_id, update)

    def add_review(self, entry_id, body):
        conclusion = text(body.get('conclusion'), '复盘结论')
        verdict = body.get('verdict')
        if verdict not in ('confirmed', 'rejected', 'uncertain'):
            raise ValidationError('请选择验证、证伪或待观察。')
        existing = self.store.journal(entry_id)
        snapshot = self.safe_quote(existing['symbol'])
        def update(entry):
            entry['reviews'].append({'id': uuid.uuid4().hex, 'conclusion': conclusion, 'verdict': verdict,
                                     'created_at': now_iso(), 'snapshot': snapshot,
                                     'comparison': comparison(entry, snapshot)})
        return self.store.mutate_journal(entry_id, update)
