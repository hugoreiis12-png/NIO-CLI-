import { test, expect } from 'bun:test';
import { assertReadOnlyQuery } from './read-only.js';

test('aceita SELECT / WITH / TABLE / VALUES', () => {
  expect(() => assertReadOnlyQuery('SELECT 1')).not.toThrow();
  expect(() => assertReadOnlyQuery('  select * from tasks  ')).not.toThrow();
  expect(() => assertReadOnlyQuery('WITH t AS (SELECT 1) SELECT * FROM t')).not.toThrow();
  expect(() => assertReadOnlyQuery('TABLE projects')).not.toThrow();
  expect(() => assertReadOnlyQuery('VALUES (1),(2)')).not.toThrow();
});

test('aceita SELECT com ; final e espaços', () => {
  expect(() => assertReadOnlyQuery('SELECT 1;  ')).not.toThrow();
});

test('rejeita escrita/DDL (INSERT/UPDATE/DELETE/DROP/CREATE)', () => {
  for (const q of [
    'INSERT INTO t VALUES (1)',
    'UPDATE t SET a=1',
    'DELETE FROM t',
    'DROP TABLE t',
    'CREATE TABLE t (a int)',
    'TRUNCATE t',
    'GRANT ALL ON t TO x',
  ]) {
    expect(() => assertReadOnlyQuery(q)).toThrow('read-only');
  }
});

test('rejeita múltiplas instruções', () => {
  expect(() => assertReadOnlyQuery('SELECT 1; DROP TABLE t')).toThrow('Múltiplas instruções');
});

test('não deixa comentário mascarar o verbo real', () => {
  expect(() => assertReadOnlyQuery('/* SELECT */ DELETE FROM t')).toThrow('read-only');
  expect(() => assertReadOnlyQuery('-- SELECT\nDROP TABLE t')).toThrow('read-only');
});

test('rejeita consulta vazia', () => {
  expect(() => assertReadOnlyQuery('   ')).toThrow('vazia');
});