import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './helpers.js';
import { configDir } from '../src/config-dir.js';
import { credentialsPath } from '../src/credentials.js';
import { configPath } from '../src/i18n.js';
import { readDefaults, writeDefaults, defaultsFor, DefaultsError } from '../src/defaults.js';

function where(t) {
  const home = tmpDir('guideline-home-');
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, env: {} };
}

test('configDir 은 XDG_CONFIG_HOME 이 있으면 그 아래, 없으면 ~/.config 아래 guideline 이고 두 경로가 이것을 따른다', t => {
  const w = where(t);
  assert.equal(configDir(w), path.join(w.home, '.config', 'guideline'));
  const x = { ...w, env: { XDG_CONFIG_HOME: '/x' } };
  assert.equal(configDir(x), path.join('/x', 'guideline'));
  assert.equal(credentialsPath(x), path.join(configDir(x), 'credentials.json'));
  assert.equal(configPath(x), path.join(configDir(x), 'config.json'));
});

test('defaults 는 파일이 없으면 비어 있다', t => {
  assert.deepEqual(readDefaults(where(t)), { version: 1, servers: {} });
  assert.equal(defaultsFor('https://g.example.com', where(t)), null);
});

test('defaults 는 origin 별로 저장하고 0600 으로 쓴다', t => {
  const w = where(t);
  writeDefaults({ version: 1, servers: { 'https://g.example.com': { add: ['skills/b', 'rules/a'], remove: ['rules/x'] } } }, w);
  const file = path.join(configDir(w), 'defaults.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(configDir(w)).mode & 0o777, 0o700);
  assert.deepEqual(defaultsFor('https://g.example.com/some/path', w), { add: ['rules/a', 'skills/b'], remove: ['rules/x'] });
  assert.equal(defaultsFor('http://other:3000', w), null);
  assert.deepEqual(readDefaults(w).servers['https://g.example.com'].add, ['rules/a', 'skills/b']);
});

test('defaults 는 깨진 파일을 DefaultsError 로 거절해 덮어쓰지 않는다', t => {
  const w = where(t);
  fs.mkdirSync(configDir(w), { recursive: true });
  fs.writeFileSync(path.join(configDir(w), 'defaults.json'), '{');
  assert.throws(() => readDefaults(w), DefaultsError);
});

test('defaults 는 이미 느슨한 권한으로 있던 파일도 0600 으로 좁힌다', t => {
  const w = where(t);
  const file = path.join(configDir(w), 'defaults.json');
  fs.mkdirSync(configDir(w), { recursive: true });
  fs.writeFileSync(file, '{"version":1,"servers":{}}', { mode: 0o644 });
  fs.chmodSync(file, 0o644);
  writeDefaults({ version: 1, servers: {} }, w);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});

test('defaults 는 서버 키를 origin 으로 맞춰 쓰고 합친다', t => {
  const w = where(t);
  writeDefaults({ version: 1, servers: { 'https://g.example.com/': { add: ['rules/a'], remove: [] }, 'https://g.example.com/x': { add: ['skills/b'], remove: ['rules/z'] } } }, w);
  assert.deepEqual(readDefaults(w).servers, { 'https://g.example.com': { add: ['rules/a', 'skills/b'], remove: ['rules/z'] } });
  assert.deepEqual(defaultsFor('https://g.example.com', w), { add: ['rules/a', 'skills/b'], remove: ['rules/z'] });
  assert.throws(() => writeDefaults({ version: 1, servers: { 'not a url': { add: [], remove: [] } } }, w), DefaultsError);
});

test('defaults 는 손으로 쓴 끝 슬래시 키도 찾는다', t => {
  const w = where(t);
  fs.mkdirSync(configDir(w), { recursive: true });
  fs.writeFileSync(path.join(configDir(w), 'defaults.json'), '{"version":1,"servers":{"https://g.example.com/":{"add":["rules/a"],"remove":[]}}}');
  assert.deepEqual(defaultsFor('https://g.example.com', w), { add: ['rules/a'], remove: [] });
});
