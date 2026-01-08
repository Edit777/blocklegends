#!/usr/bin/env python3
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

SOURCE_PATH = Path(__file__).resolve().parents[1] / 'products_export_1 (17).csv'
OUTPUT_PATH = Path(__file__).resolve().parents[1] / 'assets' / 'bl-pool-index.json'

KEY_FIELD = 'Collection Key (product.metafields.custom.collection_key)'
RARITY_FIELD = 'Rarity (product.metafields.custom.rarity)'
REAL_NAME_FIELD = 'Real Name (product.metafields.custom.real_name)'
TITLE_FIELD = 'Title'
EXCLUDE_FIELD = 'Exclude from Mystery (product.metafields.custom.exclude_from_mystery)'
STATUS_FIELD = 'Status'
HANDLE_FIELD = 'Handle'
TITLE_EXCLUDE = 'mystery figure'

EXCLUDED_HANDLES = {
    'mystery-add-on',
}

RARITY_MAP = {
    'special': 'legendary',
    'mythical': 'legendary',
}

ALLOWED_RARITIES = {
    'common',
    'rare',
    'epic',
    'legendary',
}

def normalize_bool(value: str) -> bool:
    value = (value or '').strip().lower()
    return value in {'true', '1', 'yes', 'y'}


def normalize_pool_key(value: str) -> str:
    return (value or '').strip().lower()


def normalize_identity(real_name: str, title: str) -> str:
    identity = (real_name or '').strip()
    if identity:
        return ' '.join(identity.split())

    cleaned = (title or '').strip()
    return ' '.join(cleaned.split())


def normalize_title(value: str) -> str:
    return ' '.join((value or '').strip().lower().split())


def normalize_rarity(value: str) -> str:
    rarity = (value or '').strip().lower()
    if not rarity:
        return ''
    rarity = RARITY_MAP.get(rarity, rarity)
    return rarity if rarity in ALLOWED_RARITIES else ''


def main() -> None:
    if not SOURCE_PATH.exists():
        raise SystemExit(f'Missing source CSV: {SOURCE_PATH}')

    pools: dict[str, dict[str, str]] = {}

    with SOURCE_PATH.open(newline='', encoding='utf-8') as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            status = (row.get(STATUS_FIELD) or '').strip().lower()
            if status != 'active':
                continue

            if normalize_bool(row.get(EXCLUDE_FIELD)):
                continue

            title_value = normalize_title(row.get(TITLE_FIELD))
            if title_value == TITLE_EXCLUDE:
                continue

            handle_value = (row.get(HANDLE_FIELD) or '').strip().lower()
            if handle_value in EXCLUDED_HANDLES:
                continue

            pool_key = normalize_pool_key(row.get(KEY_FIELD) or '')
            if not pool_key:
                continue

            identity = normalize_identity(row.get(REAL_NAME_FIELD), row.get(TITLE_FIELD))
            if not identity:
                continue

            rarity = normalize_rarity(row.get(RARITY_FIELD))

            pool_entry = pools.setdefault(pool_key, {})
            if identity in pool_entry:
                if pool_entry[identity]:
                    continue
                if rarity:
                    pool_entry[identity] = rarity
                continue

            if rarity:
                pool_entry[identity] = rarity
            else:
                pool_entry[identity] = ''

    generated_at = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')

    payload = {}
    for pool_key, identities in sorted(pools.items()):
        per_rarity = {k: 0 for k in ALLOWED_RARITIES}
        for rarity in identities.values():
            if rarity in per_rarity:
                per_rarity[rarity] += 1

        payload[pool_key] = {
            'totalDistinct': len(identities),
            'perRarityDistinct': {
                'common': per_rarity['common'],
                'rare': per_rarity['rare'],
                'epic': per_rarity['epic'],
                'legendary': per_rarity['legendary'],
            },
            'generatedAt': generated_at,
        }

    OUTPUT_PATH.write_text(json.dumps(payload, indent=2, sort_keys=True) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
