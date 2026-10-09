#!/usr/bin/env python3
"""Build an allowlisted Pages artifact; no local database is ever packaged."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from stockshub.domain import now_iso
from stockshub.providers import SEEDS, TencentProvider, ProviderError


def refresh_snapshot(destination=ROOT / 'data' / 'market.json'):
    provider = TencentProvider(timeout=8)
    try:
        previous = json.loads(destination.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        previous = {}
    result = {'format': 'stockshub-public-market', 'version': 1, 'generated_at': now_iso(),
              'instruments': [], 'quotes': {}, 'histories': {}, 'failures': []}

    def fetch(item):
        code, name = item
        data = {'symbol': code, 'name': name, 'code': code[2:], 'exchange': code[:2].upper()}
        packets = {}
        for kind, key in [('quote', 'quotes'), ('history', 'histories')]:
            try:
                packets[key] = getattr(provider, kind)(code)
            except ProviderError as exc:
                old = previous.get(key, {}).get(code)
                if old:
                    packets[key] = {**old, 'cache_status': 'fallback', 'warning': '更新失败，保留上次公开快照。'}
                packets.setdefault('failures', []).append({'symbol': code, 'kind': kind, 'error': str(exc)})
        return data, packets

    with ThreadPoolExecutor(max_workers=4) as pool:
        for stock, packets in pool.map(fetch, SEEDS):
            result['instruments'].append(stock)
            for key in ('quotes', 'histories'):
                if key in packets:
                    result[key][stock['symbol']] = packets[key]
            result['failures'].extend(packets.get('failures', []))
    if not result['quotes'] or not result['histories']:
        raise RuntimeError('No usable public market data. Refusing to publish an empty snapshot.')
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix('.tmp')
    temporary.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':'), allow_nan=False), encoding='utf-8')
    temporary.replace(destination)
    print(f'Public snapshot: {len(result["quotes"])} quotes, {len(result["histories"])} histories, {len(result["failures"])} failures')
    return result


def build(output=ROOT / 'site', refresh=False):
    output = output.resolve()
    if output == ROOT or output in ROOT.parents or output == ROOT / 'local' or output == ROOT / '.git':
        raise ValueError('Output must be a dedicated build directory.')
    if refresh:
        refresh_snapshot()
    # Copy only explicit public inputs; do not recursively copy the workspace.
    allowed = {Path(name) for name in ('index.html', 'site-config.json', 'sw.js', '.nojekyll')}
    for name in ('assets', 'data'):
        allowed.update(path.relative_to(ROOT) for path in (ROOT / name).rglob('*') if path.is_file())
    if output.exists():
        unexpected = [path.relative_to(output) for path in output.rglob('*') if path.is_file() and path.relative_to(output) not in allowed]
        if unexpected:
            raise ValueError('Output contains unexpected files; use an empty dedicated directory. Refusing to publish them.')
    output.mkdir(parents=True, exist_ok=True)
    for name in ('index.html', 'site-config.json', 'sw.js'):
        shutil.copyfile(ROOT / name, output / name)
    for name in ('assets', 'data'):
        shutil.copytree(ROOT / name, output / name, dirs_exist_ok=True)
    (output / '.nojekyll').write_text('', encoding='utf-8')
    print(f'Static site: {output}')
    return output


def main():
    parser = argparse.ArgumentParser(description='Build public GitHub Pages site and optional free market snapshots.')
    parser.add_argument('--refresh', action='store_true', help='Refresh only the public starter-stock snapshots before build.')
    parser.add_argument('--output', type=Path, default=ROOT / 'site')
    args = parser.parse_args()
    build(args.output, args.refresh)


if __name__ == '__main__':
    main()
