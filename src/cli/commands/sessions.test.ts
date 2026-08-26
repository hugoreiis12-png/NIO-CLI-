import { test, expect } from 'bun:test';
import { matchByIdPrefix } from './sessions.js';
import type { Session } from '../../core/session.js';

function mk(id: string): Session {
  return {
    id,
    userId: 1,
    name: 'x',
    profile: 'dba',
    status: 'active',
    projectPath: '/x',
    ide: 'other',
    config: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

test('matchByIdPrefix: filtra sessões pelo prefixo do id', () => {
  const s = [mk('abcd1234'), mk('abef5678'), mk('zzzz0000')];
  expect(matchByIdPrefix(s, 'ab')).toHaveLength(2);
  expect(matchByIdPrefix(s, 'abcd')).toHaveLength(1);
  expect(matchByIdPrefix(s, 'zz')[0]?.id).toBe('zzzz0000');
  expect(matchByIdPrefix(s, 'nope')).toHaveLength(0);
});
