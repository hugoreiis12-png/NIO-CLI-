import { test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { HEADROOM_PORT, HEADROOM_URL, HEADROOM_URL_CONTAINER, headroomComposePath, headroomHealthy } from './headroom.js';

test('HEADROOM_URL: default no host, com /v1', () => {
  expect(HEADROOM_PORT).toBe(8787);
  expect(HEADROOM_URL).toBe('http://127.0.0.1:8787/v1');
  expect(HEADROOM_URL_CONTAINER).toBe('http://host.docker.internal:8787/v1');
});

test('headroomComposePath: resolve pro headroom/docker-compose.yml do pacote', () => {
  const p = headroomComposePath();
  expect(p.endsWith('headroom/docker-compose.yml')).toBe(true);
  expect(existsSync(p)).toBe(true); // o arquivo existe no repo
});

test('headroomHealthy: devolve boolean sem lançar', async () => {
  expect(typeof (await headroomHealthy())).toBe('boolean');
});
