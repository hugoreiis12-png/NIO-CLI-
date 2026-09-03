import { test, expect } from 'bun:test';
import { HEADROOM_PORT, HEADROOM_URL, HEADROOM_URL_CONTAINER, headroomHealthy } from './headroom.js';

test('HEADROOM_URL: default no host, com /v1', () => {
  expect(HEADROOM_PORT).toBe(8787);
  expect(HEADROOM_URL).toBe('http://127.0.0.1:8787/v1');
  expect(HEADROOM_URL_CONTAINER).toBe('http://host.docker.internal:8787/v1');
});

test('headroomHealthy: devolve boolean sem lançar', async () => {
  expect(typeof (await headroomHealthy())).toBe('boolean');
});
