import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpDir } from './helpers.js';
import { credentialsPath, getToken, saveToken, removeToken } from '../src/credentials.js';

function where(t) {
  const home = tmpDir('guideline-home-');
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, env: {} };
}

test('XDG_CONFIG_HOME 이 있으면 그 아래, 없으면 ~/.config 아래', t => {
  const w = where(t);
  assert.equal(credentialsPath(w), path.join(w.home, '.config', 'guideline', 'credentials.json'));
  assert.equal(credentialsPath({ ...w, env: { XDG_CONFIG_HOME: '/x' } }), path.join('/x', 'guideline', 'credentials.json'));
});

test('서버 origin 마다 저장하고 권한은 0600', t => {
  const w = where(t);
  saveToken('http://localhost:3000/', { token: 'glt_a', name: 'cli-a' }, w);
  saveToken('https://g.example.com', { token: 'glt_b', name: 'cli-b' }, w);
  assert.equal(getToken('http://localhost:3000', w), 'glt_a');
  assert.equal(getToken('https://g.example.com/x', w), 'glt_b');
  assert.equal(fs.statSync(credentialsPath(w)).mode & 0o777, 0o600);
  assert.equal(removeToken('http://localhost:3000', w), true);
  assert.equal(getToken('http://localhost:3000', w), null);
  assert.equal(removeToken('http://localhost:3000', w), false);
});

test('GUIDELINE_TOKEN 이 파일보다 먼저다', t => {
  const w = where(t);
  saveToken('http://localhost:3000', { token: 'glt_file', name: 'n' }, w);
  assert.equal(getToken('http://localhost:3000', { ...w, env: { GUIDELINE_TOKEN: 'glt_env' } }), 'glt_env');
});
