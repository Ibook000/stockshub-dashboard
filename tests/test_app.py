import copy
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
from threading import Thread
import unittest
import urllib.error
import urllib.request

from stockshub.config import Config
from stockshub.domain import ValidationError, comparison, new_journal, symbol, validate_backup
from stockshub.providers import ProviderError, envelope, parse_history, parse_quote, parse_search
from stockshub.server import create_server
from stockshub.service import Service
from stockshub.store import Store

FIELDS = {'symbol': 'sh600519', 'name': '贵州茅台', 'title': '利润率研究', 'thesis': '观察财报中的利润率变化。',
          'validation': '下期利润率保持提升；下降则重新评估。', 'risk': '需求变化', 'review_date': '2026-10-20'}


class FakeProvider:
    name = '测试来源'
    def __init__(self):
        self.fail = False
        self.calls = 0
    def quote(self, code):
        self.calls += 1
        if self.fail:
            raise ProviderError('离线')
        return {'symbol': code, 'source': self.name, 'as_of': '2026-10-08T15:00:00+08:00',
                'fetched_at': datetime.now(timezone.utc).isoformat(), 'cache_status': 'fresh',
                'data': {'price': 100.0, 'change_pct': 1.0, 'name': '贵州茅台'}}
    def history(self, code):
        if self.fail:
            raise ProviderError('离线')
        return envelope(code, [{'date': '2026-10-08', 'open': 99, 'close': 100, 'high': 101, 'low': 98, 'volume': 100}], '2026-10-08T15:00:00+08:00', 'unadjusted')
    def search(self, query):
        if self.fail:
            raise ProviderError('离线')
        return [{'symbol': 'sh600519', 'code': '600519', 'exchange': 'SH', 'name': '贵州茅台'}]


class DomainTests(unittest.TestCase):
    def test_identifiers_disambiguate_stock_and_index(self):
        self.assertEqual(symbol('SZ000001'), 'sz000001')
        for value in ['000001', 'sh000001', 'hk00700', '../../etc', 'sh600519?evil=1']:
            with self.assertRaises(ValidationError):
                symbol(value)
        for value in ['bj920001', 'bj430047', 'sz301001', 'sh688981']:
            self.assertEqual(symbol(value), value)

    def test_comparison_never_uses_precreation_or_same_snapshot(self):
        quote = FakeProvider().quote('sh600519')
        entry = {**new_journal(FIELDS, quote), 'created_at': '2026-10-09T00:00:00+08:00'}
        history = {'basis': 'unadjusted', 'source': '测试', 'data': [{'date': '2026-10-08', 'close': 105}]}
        self.assertEqual(comparison(entry, quote, history)['status'], 'waiting')
        history['data'].append({'date': '2026-10-09', 'close': 110})
        result = comparison(entry, quote, history, datetime.fromisoformat('2026-10-10T00:00:00+08:00'))
        self.assertEqual(result['status'], 'available')
        self.assertAlmostEqual(result['change_pct'], 10)

    def test_no_fabricated_baseline_and_adjusted_bars_excluded(self):
        entry = new_journal(FIELDS)
        self.assertEqual(comparison(entry)['status'], 'no_baseline')
        entry['baseline'] = FakeProvider().quote(entry['symbol'])
        entry['created_at'] = '2026-10-07T00:00:00+08:00'
        self.assertEqual(comparison(entry, history={'basis': 'qfq', 'data': [{'date': '2026-10-09', 'close': 120}]})['status'], 'waiting')

    def test_future_data_never_counts_as_an_observed_outcome(self):
        quote = FakeProvider().quote('sh600519')
        entry = {**new_journal(FIELDS, quote), 'created_at': '2026-10-08T16:00:00+08:00'}
        future = {**quote, 'as_of': '2099-01-01T15:00:00+08:00'}
        self.assertEqual(comparison(entry, future)['status'], 'waiting')

    def test_quote_parser_retains_time_and_unit_conversions(self):
        p = [''] * 48
        for index, value in {1: '贵州茅台', 2: '600519', 3: '100', 4: '99', 5: '98', 6: '23', 30: '20261008150000', 31: '1', 32: '1.01', 33: '101', 34: '97', 37: '12', 45: '8', 46: '0'}.items():
            p[index] = value
        result = parse_quote('v_sh600519="' + '~'.join(p) + '";', 'sh600519')
        self.assertEqual(result['as_of'], '2026-10-08T15:00:00+08:00')
        self.assertEqual(result['data']['volume'], 2300)
        self.assertEqual(result['data']['amount'], 120000)
        self.assertEqual(result['data']['pb'], 0)
        self.assertIsNone(result['data']['pe'])
        p[30] = ''
        with self.assertRaises(ProviderError):
            parse_quote('v_sh600519="' + '~'.join(p) + '";', 'sh600519')

    def test_history_validates_sorts_and_deduplicates_bars(self):
        rows = [['2026-10-08', '100', '101', '102', '99', '20'], ['2026-10-07', '98', '100', '102', '97', '10'],
                ['2026-10-08', '100', '101', '102', '99', '21'], ['2026-10-06', '9', '10', '8', '7', '1']]
        result = parse_history({'data': {'sh600519': {'day': rows}}}, 'sh600519')
        self.assertEqual(len(result['data']), 2)
        self.assertEqual(result['data'][0]['date'], '2026-10-07')
        self.assertEqual(result['data'][-1]['volume'], 2100)
        self.assertEqual(result['basis'], 'unadjusted')

    def test_search_excludes_indices_hk_and_non_stock_assets(self):
        data = 'v_hint="sh~600519~茅台~gzmt~GP-A^sh~000001~上证~sz~ZS^hk~00700~腾讯~tx~GP^sz~000001~平安~pa~GP-A"'
        result = parse_search(data)
        self.assertEqual([r['symbol'] for r in result], ['sh600519', 'sz000001'])


class StoreServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.temp.name) / 'nested' / 'test.db')
        self.provider = FakeProvider()
        self.service = Service(self.store, self.provider, Config(database=self.store.path))

    def tearDown(self):
        self.temp.cleanup()

    def test_sqlite_persists_watchlist_and_journal(self):
        self.store.add_stock({'symbol': 'sh600519', 'name': '贵州茅台'})
        entry = self.service.create_journal(FIELDS)
        other = Store(self.store.path)
        self.assertEqual(other.journal(entry['id'])['baseline']['data']['price'], 100)
        self.assertEqual(other.watchlist()[0]['name'], '贵州茅台')

    def test_edits_keep_snapshot_and_prior_versions(self):
        entry = self.service.create_journal(FIELDS)
        edited = self.service.update_journal(entry['id'], {**FIELDS, 'thesis': '新的理由'})
        self.assertEqual(edited['baseline'], entry['baseline'])
        self.assertEqual(edited['revisions'][0]['thesis'], FIELDS['thesis'])
        with self.assertRaises(ValidationError):
            self.service.update_journal(entry['id'], {**FIELDS, 'symbol': 'sz000001'})

    def test_reviews_are_append_only_and_archive_reversible(self):
        entry = self.service.create_journal(FIELDS)
        self.service.add_review(entry['id'], {'conclusion': '继续观察需求。', 'verdict': 'uncertain'})
        result = self.service.add_review(entry['id'], {'conclusion': '验证条件未兑现。', 'verdict': 'rejected'})
        self.assertEqual(len(result['reviews']), 2)
        self.assertEqual(result['reviews'][0]['conclusion'], '继续观察需求。')
        self.assertTrue(self.service.update_journal(entry['id'], {'archived': True})['archived'])
        self.assertFalse(self.service.update_journal(entry['id'], {'archived': False})['archived'])

    def test_cache_fallback_keeps_observation_and_fetch_timestamps(self):
        first = self.service.market('quote', 'sh600519')
        self.assertEqual(self.service.market('quote', 'sh600519')['cache_status'], 'cached')
        self.assertEqual(self.provider.calls, 1)
        self.provider.fail = True
        fallback = self.service.market('quote', 'sh600519', refresh=True)
        self.assertEqual(fallback['cache_status'], 'fallback')
        self.assertEqual(fallback['as_of'], first['as_of'])
        self.assertEqual(fallback['fetched_at'], first['fetched_at'])

    def test_journal_can_be_created_without_network_or_snapshot(self):
        self.provider.fail = True
        entry = self.service.create_journal({**FIELDS, 'symbol': 'sz002415', 'name': '海康威视'})
        self.assertIsNone(entry['baseline'])
        self.assertEqual(self.store.journal(entry['id'])['thesis'], FIELDS['thesis'])

    def test_restore_is_atomic_and_duplicate_ids_never_overwrite(self):
        entry = self.service.create_journal(FIELDS)
        backup = self.store.backup()
        backup['journals'][0]['thesis'] = '导入者改写的理由'
        result = self.store.restore(backup)
        self.assertEqual(result['skipped'], 1)
        self.assertEqual(self.store.journal(entry['id'])['thesis'], FIELDS['thesis'])
        invalid = copy.deepcopy(backup)
        invalid['watchlist'] = [{'symbol': 'sz000001', 'name': '平安银行'}]
        invalid['journals'].append({**invalid['journals'][0], 'id': 'broken', 'review_date': 'not-a-date'})
        with self.assertRaises(ValidationError):
            self.store.restore(invalid)
        self.assertEqual(self.store.watchlist(), [])

    def test_bad_snapshot_and_review_fail_before_import(self):
        self.service.create_journal(FIELDS)
        backup = self.store.backup()
        backup['journals'][0]['baseline']['symbol'] = 'sz000001'
        with self.assertRaises(ValidationError):
            validate_backup(backup)

    def test_site_build_rejects_unexpected_private_artifacts(self):
        from scripts.build_site import build
        output = Path(self.temp.name) / 'site'
        output.mkdir()
        (output / 'private.db').write_text('private')
        with self.assertRaises(ValueError):
            build(output)
        self.assertFalse((output / 'index.html').exists())


class HttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.server = create_server(Config(database=Path(cls.temp.name) / 'state.db', port=0), FakeProvider())
        cls.worker = Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close(); cls.worker.join()
        cls.temp.cleanup()

    def call(self, path, method='GET', data=None, headers=None):
        req = urllib.request.Request(self.base + path, method=method,
                                     data=json.dumps(data).encode() if data is not None else None,
                                     headers={'Content-Type': 'application/json', **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=5) as response:
                return response.status, response.read(), response.headers
        except urllib.error.HTTPError as response:
            return response.code, response.read(), response.headers

    def test_static_app_and_server_mode_configuration(self):
        status, body, headers = self.call('/')
        self.assertEqual(status, 200)
        self.assertIn(b'./assets/app.js', body)
        self.assertIn("default-src 'self'", headers['Content-Security-Policy'])
        self.assertEqual(json.loads(self.call('/site-config.json')[1])['mode'], 'server')

    def test_private_paths_and_directory_traversal_are_rejected(self):
        for path in ['/.git/config', '/stockshub/config.py', '/assets/../site-config.json', '/assets/%2e%2e/local/private.json']:
            self.assertEqual(self.call(path)[0], 404)

    def test_cross_origin_writes_and_dns_rebinding_are_rejected(self):
        self.assertEqual(self.call('/api/watchlist', 'POST', {'symbol': 'sh600519', 'name': '茅台'}, {'Origin': 'https://evil.example'})[0], 403)
        self.assertEqual(self.call('/api/journals', headers={'Host': 'evil.example'})[0], 403)

    def test_api_validates_symbols_and_restores_whole_workflow(self):
        self.assertEqual(self.call('/api/quote/000001')[0], 400)
        self.assertEqual(self.call('/api/watchlist', 'POST', {'symbol': 'sz000001', 'name': '平安银行'})[0], 201)
        status, body, _ = self.call('/api/journals', 'POST', FIELDS)
        self.assertEqual(status, 201)
        entry = json.loads(body)
        self.assertEqual(self.call('/api/journals/' + entry['id'] + '/reviews', 'POST', {'verdict': 'uncertain', 'conclusion': '持续跟踪'})[0], 201)
        backup = json.loads(self.call('/api/backup')[1])
        self.assertEqual(self.call('/api/restore', 'POST', backup)[0], 200)
        self.assertEqual(self.call('/api/watchlist/sz000001', 'DELETE')[0], 200)


if __name__ == '__main__':
    unittest.main()
