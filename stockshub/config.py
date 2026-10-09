from dataclasses import dataclass
from pathlib import Path
import os

ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Config:
    database: Path = Path(os.environ.get('STOCKSHUB_DB', str(ROOT / 'local' / 'stockshub.db')))
    host: str = '127.0.0.1'
    port: int = 8765
    timeout: float = 8
    quote_ttl: int = 60
    history_ttl: int = 3600
    max_body: int = 5 * 1024 * 1024
