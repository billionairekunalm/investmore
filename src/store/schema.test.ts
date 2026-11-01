import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import * as S from './store';
import { TABLES, fromRow, toRow, type Kind } from './schema';
import { loadDemo } from '../lib/demo';
import { uid } from '../domain/util';

// Parse the migration: table → column → { type, notNull }
const sql = readFileSync(new URL('../../supabase/migrations/0001_init.sql', import.meta.url), 'utf8');
const tables = new Map<string, Map<string, { type: string; notNull: boolean }>>();
for (const m of sql.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/g)) {
  const colsMap = new Map<string, { type: string; notNull: boolean }>();
  for (const line of m[2].split('\n')) {
    const c = line.trim().match(/^([a-z_]+) (text|integer|bigint|boolean|date|timestamptz|jsonb)\b(.*)$/);
    if (c && !['check', 'unique', 'primary'].includes(c[1])) colsMap.set(c[1], { type: c[2], notNull: /not null|primary key/.test(c[3]) });
  }
  tables.set(m[1], colsMap);
}
const SQL_TYPE: Record<Kind, string> = { text: 'text', int: 'integer', money: 'bigint', bool: 'boolean', date: 'date', ts: 'timestamptz', json: 'jsonb' };

describe('schema.ts ↔ 0001_init.sql', () => {
  it.each(TABLES.map((t) => [t.table, t] as const))('%s: same columns and types', (_n, spec) => {
    const sqlCols = tables.get(spec.table);
    expect(sqlCols, `table ${spec.table} missing from SQL`).toBeDefined();
    for (const c of spec.cols) expect(sqlCols!.get(c.col)?.type, `${spec.table}.${c.col}`).toBe(SQL_TYPE[c.kind]);
    expect([...sqlCols!.keys()].sort()).toEqual(spec.cols.map((c) => c.col).sort());
  });
});

describe('real records survive the round trip', () => {
  beforeAll(() => {
    const d = S.emptyDB();
    const admin = uid();
    d.employees.push({ id: admin, name: 'Owner', phone: '9000000001', email: 'owner@academy.test', role: 'super_admin', active: true, createdAt: new Date().toISOString() });
    S.__setDB(d, admin);
    S.updateSettings({ bookingPolicy: 'additional' });
    loadDemo();
  });

  it.each(TABLES.map((t) => [t.table, t] as const))('%s: no field lost, required columns filled, values unchanged', (_n, spec) => {
    const rows = S.getDB()[spec.key] as unknown as Record<string, unknown>[];
    const known = new Set(spec.cols.map((c) => c.field));
    const notNull = [...(tables.get(spec.table) ?? [])].filter(([, v]) => v.notNull).map(([k]) => k);
    for (const rec of rows) {
      for (const k of Object.keys(rec)) expect(known.has(k), `${spec.table}: field "${k}" has no column`).toBe(true);
      const row = toRow(spec, rec);
      for (const col of notNull) expect(row[col], `${spec.table}.${col} is NOT NULL`).not.toBeNull();
      const back = fromRow(spec, JSON.parse(JSON.stringify(row)));
      for (const c of spec.cols) {
        if (c.kind === 'ts' && rec[c.field]) expect(Date.parse(String(back[c.field]))).toBe(Date.parse(String(rec[c.field])));
        else expect(back[c.field], `${spec.table}.${c.field}`).toEqual(rec[c.field]);
      }
    }
  });
});
