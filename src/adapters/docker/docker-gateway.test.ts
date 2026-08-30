import { describe, expect, test } from 'bun:test';
import {
  composeArgs,
  runArgs,
  stackDeployArgs,
  serviceScaleArgs,
} from './docker-gateway.js';

describe('composeArgs', () => {
  test('up: detach por default, -f quando há file', () => {
    expect(composeArgs('up', { file: 'a.yml' })).toEqual(['compose', '-f', 'a.yml', 'up', '-d']);
  });
  test('up: --no-detach e --build', () => {
    expect(composeArgs('up', { detach: false, build: true })).toEqual(['compose', 'up', '--build']);
  });
  test('down: sem flags', () => {
    expect(composeArgs('down')).toEqual(['compose', 'down']);
  });
  test('logs: --tail + serviço', () => {
    expect(composeArgs('logs', { tail: 50, service: 'api' })).toEqual([
      'compose',
      'logs',
      '--tail',
      '50',
      'api',
    ]);
  });
  test('restart: serviço opcional', () => {
    expect(composeArgs('restart', { service: 'db' })).toEqual(['compose', 'restart', 'db']);
    expect(composeArgs('restart')).toEqual(['compose', 'restart']);
  });
  test('ps', () => {
    expect(composeArgs('ps', { file: 'x.yml' })).toEqual(['compose', '-f', 'x.yml', 'ps']);
  });
});

describe('runArgs', () => {
  test('só imagem', () => {
    expect(runArgs({ image: 'redis:7' })).toEqual(['run', 'redis:7']);
  });
  test('nome + portas + env + volumes + detach + cmd', () => {
    expect(
      runArgs({
        image: 'node:20',
        name: 'app',
        ports: ['3000:3000', '9229:9229'],
        env: { NODE_ENV: 'dev' },
        volumes: ['./src:/app/src'],
        detach: true,
        cmd: ['npm', 'start'],
      }),
    ).toEqual([
      'run',
      '-d',
      '--name',
      'app',
      '-p',
      '3000:3000',
      '-p',
      '9229:9229',
      '-e',
      'NODE_ENV=dev',
      '-v',
      './src:/app/src',
      'node:20',
      'npm',
      'start',
    ]);
  });
});

test('stackDeployArgs', () => {
  expect(stackDeployArgs('nio-cluster', '/tmp/gen.yml')).toEqual([
    'stack',
    'deploy',
    '-c',
    '/tmp/gen.yml',
    'nio-cluster',
  ]);
});

test('serviceScaleArgs', () => {
  expect(serviceScaleArgs('nio-cluster_api', 3)).toEqual(['service', 'scale', 'nio-cluster_api=3']);
});
