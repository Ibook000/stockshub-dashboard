"""Short-lived SQLite connections; personal state stays local."""
from contextlib import contextmanager
import json
import sqlite3
from .domain import now_iso, validate_backup


def encode(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


class Store:
    def __init__(self, path):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as conn:
            conn.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS watchlist (symbol TEXT PRIMARY KEY, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS journals (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, payload TEXT NOT NULL);
                PRAGMA user_version=1;
            ''')

    @contextmanager
    def connection(self):
        conn = sqlite3.connect(self.path, timeout=10)
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def watchlist(self):
        with self.connection() as conn:
            return [json.loads(row[0]) for row in conn.execute('SELECT payload FROM watchlist ORDER BY symbol')]

    def add_stock(self, stock):
        with self.connection() as conn:
            conn.execute('INSERT INTO watchlist VALUES (?, ?) ON CONFLICT(symbol) DO UPDATE SET payload=excluded.payload',
                         (stock['symbol'], encode(stock)))
        return stock

    def remove_stock(self, code):
        with self.connection() as conn:
            conn.execute('DELETE FROM watchlist WHERE symbol=?', (code,))

    def journals(self):
        with self.connection() as conn:
            entries = [json.loads(row[0]) for row in conn.execute('SELECT payload FROM journals')]
        return sorted(entries, key=lambda entry: entry['created_at'], reverse=True)

    def create_journal(self, entry):
        with self.connection() as conn:
            conn.execute('INSERT INTO journals VALUES (?, ?)', (entry['id'], encode(entry)))
        return entry

    def journal(self, entry_id):
        with self.connection() as conn:
            row = conn.execute('SELECT payload FROM journals WHERE id=?', (entry_id,)).fetchone()
        if not row:
            raise KeyError('研究记录不存在。')
        return json.loads(row[0])

    def mutate_journal(self, entry_id, update):
        with self.connection() as conn:
            conn.execute('BEGIN IMMEDIATE')
            row = conn.execute('SELECT payload FROM journals WHERE id=?', (entry_id,)).fetchone()
            if not row:
                raise KeyError('研究记录不存在。')
            entry = json.loads(row[0])
            update(entry)
            entry['updated_at'] = now_iso()
            conn.execute('UPDATE journals SET payload=? WHERE id=?', (encode(entry), entry_id))
        return entry

    def cached(self, key):
        with self.connection() as conn:
            row = conn.execute('SELECT payload FROM cache WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def cache(self, key, value):
        with self.connection() as conn:
            conn.execute('INSERT INTO cache VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload',
                         (key, encode(value)))

    def backup(self):
        return {'format': 'stockshub-backup', 'version': 1, 'exported_at': now_iso(),
                'watchlist': self.watchlist(), 'journals': self.journals()}

    def restore(self, payload):
        watches, entries = validate_backup(payload)
        added = {'watchlist': 0, 'journals': 0, 'skipped': 0}
        with self.connection() as conn:
            for stock in watches:
                cur = conn.execute('INSERT OR IGNORE INTO watchlist VALUES (?, ?)', (stock['symbol'], encode(stock)))
                added['watchlist'] += cur.rowcount
            for entry in entries:
                cur = conn.execute('INSERT OR IGNORE INTO journals VALUES (?, ?)', (entry['id'], encode(entry)))
                added['journals'] += cur.rowcount
                added['skipped'] += 1 - cur.rowcount
        return added
