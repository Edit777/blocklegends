#!/usr/bin/env python3
import csv
import json
from datetime import datetime
from pathlib import Path

SOURCE_PATH = Path(__file__).resolve().parents[1] / 'products_export_1 (17).csv'
OUTPUT_PATH = Path(__file__).resolve().parents[1] / 'assets' / 'bl-pool-index.json'

KEY_FIELD = 'Collection Key (product.metafields.custom.collection_key)'
RARITY_FIELD = 'Rarity (product.metafields.custom.rarity)'
EXCLUDE_FIELD = 'Exclude from Mystery (product.metafields.custom.exclude_from_mystery)'
STATUS_FIELD = 'Status'
HANDLE_FIELD = 'Handle'

ALLOWED_RARITIES = {
    'common',
    'rare',
    'epic',
    'legendary',
    'special',
    'mythical',
}


def normalize_bool(value: str) -> bool:
    value = (value or '').strip().lower()
    return value in {'true', '1', 'yes', 'y'}


def main() -> None:
    if not SOURCE_PATH.exists():
        raise SystemExit(f'Missing source CSV: {SOURCE_PATH}')

    pools = {}

    with SOURCE_PATH.open(newline='', encoding='utf-8') as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            status = (row.get(STATUS_FIELD) or '').strip().lower()
            if status != 'active':
                continue

            if normalize_bool(row.get(EXCLUDE_FIELD)):
                continue

            pool_key = (row.get(KEY_FIELD) or '').strip().lower()
            rarity = (row.get(RARITY_FIELD) or '').strip().lower()
            handle_value = (row.get(HANDLE_FIELD) or '').strip()

            if not pool_key or rarity not in ALLOWED_RARITIES:
                continue

            pool_entry = pools.setdefault(pool_key, {})
            rarity_entry = pool_entry.setdefault(rarity, set())
            if handle_value:
                rarity_entry.add(handle_value)

    payload = {
        'generated_at': datetime.utcnow().isoformat(timespec='seconds') + 'Z',
        'source': SOURCE_PATH.name,
        'pools': {}
    }

    for pool_key, rarities in sorted(pools.items()):
        payload['pools'][pool_key] = {}
        for rarity_key, handles in sorted(rarities.items()):
            handle_list = sorted(handles)
            payload['pools'][pool_key][rarity_key] = {
                'count': len(handle_list),
                'handles': handle_list,
            }

    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, sort_keys=True) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
