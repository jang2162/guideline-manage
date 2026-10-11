import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, ConfigError } from '../src/config.js';

const TOKEN = 'x'.repeat(32);
const ok = { ADMIN_TOKEN: TOKEN, PUBLIC_URL: 'https://guideline.example.com' };

test('loadConfig 는 기본값을 채운다', () => {
  const c = loadConfig(ok);
  assert.equal(c.adminToken, TOKEN);
  assert.equal(c.publicUrl.origin, 'https://guideline.example.com');
  assert.equal(c.dataDir, '/data');
  assert.equal(c.port, 3000);
  assert.equal(c.backupKeep, 14);
  assert.equal(c.trustProxy, false);
  assert.equal(c.publicRead, true, '기본은 공개');
  assert.equal(loadConfig({ ...ok, PUBLIC_READ: '0' }).publicRead, false);
  const d = loadConfig({ ...ok, DATA_DIR: '/tmp/g', PORT: '0', BACKUP_KEEP: '30', TRUST_PROXY: '1' });
  assert.deepEqual([d.dataDir, d.port, d.backupKeep, d.trustProxy], ['/tmp/g', 0, 30, true]);
});

test('loadConfig 는 잘못된 값마다 이유를 담은 ConfigError', () => {
  const cases = [
    [{ PUBLIC_URL: ok.PUBLIC_URL }, 'ADMIN_TOKEN is not set'],
    [{ ...ok, ADMIN_TOKEN: 'short' }, 'ADMIN_TOKEN must be at least 32 characters'],
    [{ ADMIN_TOKEN: TOKEN }, 'PUBLIC_URL is not set'],
    [{ ...ok, PUBLIC_URL: 'guideline.example.com' }, 'PUBLIC_URL must be an address starting with http:// or https://'],
    [{ ...ok, PUBLIC_URL: 'ftp://x' }, 'PUBLIC_URL must be an address starting with http:// or https://'],
    [{ ...ok, PORT: 'abc' }, 'PORT is not a valid integer'],
    [{ ...ok, PORT: '70000' }, 'PORT is not a valid integer'],
    [{ ...ok, BACKUP_KEEP: '0' }, 'BACKUP_KEEP must be 1 or more'],
    [{ ...ok, PUBLIC_READ: 'yes' }, 'PUBLIC_READ must be 0 or 1'],
  ];
  for (const [env, message] of cases) {
    assert.throws(() => loadConfig(env), e => e instanceof ConfigError && e.message === message, message);
  }
});
