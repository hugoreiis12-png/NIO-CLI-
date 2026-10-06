import { test, expect } from 'bun:test';
import { isPrivateHost, isTransportTrusted, PLAIN_HTTP_HINT } from './url-trust.js';

const trusted = (raw: string): boolean => isTransportTrusted(new URL(raw));

test('https é aceito em qualquer host', () => {
  expect(trusted('https://n8n.example.com')).toBe(true);
  expect(trusted('https://192.168.1.50:5678')).toBe(true);
});

test('ACEITE: http em IP de LAN é aceito (RFC1918 nas três faixas)', () => {
  expect(trusted('http://192.168.1.50:5678')).toBe(true);
  expect(trusted('http://10.0.0.7:5678')).toBe(true);
  expect(trusted('http://172.16.0.1:5678')).toBe(true);
  expect(trusted('http://172.31.255.254:5678')).toBe(true);
});

test('http em loopback e link-local segue aceito', () => {
  expect(trusted('http://localhost:5678')).toBe(true);
  expect(trusted('http://127.0.0.1:5678')).toBe(true);
  expect(trusted('http://127.1.2.3:5678')).toBe(true);
  expect(trusted('http://169.254.10.1')).toBe(true);
  expect(trusted('http://[::1]:5678')).toBe(true);
  expect(trusted('http://[fd00::1]')).toBe(true);
  expect(trusted('http://[fe80::1]')).toBe(true);
});

test('http em host público é recusado — o segredo iria em texto puro', () => {
  expect(trusted('http://n8n.example.com')).toBe(false);
  expect(trusted('http://8.8.8.8')).toBe(false);
  // Vizinhos das bordas RFC1918: fora da faixa, logo públicos.
  expect(trusted('http://172.15.0.1')).toBe(false);
  expect(trusted('http://172.32.0.1')).toBe(false);
  expect(trusted('http://192.167.1.1')).toBe(false);
  expect(trusted('http://11.0.0.1')).toBe(false);
});

test('nome de host privado NÃO é liberado — exigiria confiar no DNS/mDNS', () => {
  expect(trusted('http://n8n.local')).toBe(false);
  expect(trusted('http://meu-servidor')).toBe(false);
});

test('protocolo que não é http(s) nunca é confiável', () => {
  expect(trusted('ftp://192.168.1.50')).toBe(false);
  expect(trusted('file:///etc/passwd')).toBe(false);
});

test('isPrivateHost: octeto fora de 0–255 e forma errada não contam como IPv4', () => {
  expect(isPrivateHost('192.168.1.256')).toBe(false);
  expect(isPrivateHost('192.168.1')).toBe(false);
  expect(isPrivateHost('192.168.1.1.1')).toBe(false);
  expect(isPrivateHost('192.168.01x.1')).toBe(false);
});

test('isPrivateHost: grupo IPv6 abreviado fora da ULA não passa', () => {
  expect(isPrivateHost('[fd::1]')).toBe(false); // 0x00fd, não 0xfd00
  expect(isPrivateHost('[fe::1]')).toBe(false);
  expect(isPrivateHost('[2001:db8::1]')).toBe(false);
});

test('a dica da política é única — os callers citam esta string', () => {
  expect(PLAIN_HTTP_HINT).toContain('LAN');
});
