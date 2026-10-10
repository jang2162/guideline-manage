import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { loadConfig, ConfigError } from './config.js';
import { openDb, SchemaTooNewError } from './db.js';
import { migrationBackup, scheduleBackups } from './backup.js';
import { createApp } from './app.js';
import { createI18n, setLocale } from '../../cli/src/i18n.js';
import { seedIfEmpty } from './seed.js';

/**
 * 설정을 읽고 DB·백업·HTTP 를 띄운다. 띄우지 못하면 이유를 error 로 내고 code 1.
 * @param {{ env: Record<string, string | undefined>, log?: (m: string) => void, error?: (m: string) => void }} opts
 * @returns {Promise<{ code: number, port?: number, close?: () => Promise<void> }>}
 */
export async function start({ env, log = console.log, error = console.error }) {
  let config;
  try {
    config = loadConfig(env);
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    error(e.message);
    return { code: 1 };
  }

  // 언어는 프로세스 하나에 하나다. 사용자 언어팩은 GUIDELINE_LOCALES_DIR 이나 DATA_DIR/locales.
  const i18n = createI18n({ env, dataDir: config.dataDir });
  setLocale(i18n);
  for (const w of i18n.warnings) error(w);

  const backups = path.join(config.dataDir, 'backups');
  try {
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.accessSync(config.dataDir, fs.constants.W_OK);
  } catch {
    error(`cannot write to ${config.dataDir}. Make DATA_HOST_DIR writable by uid 1000 (chown 1000:1000)`);
    return { code: 1 };
  }

  let db;
  try {
    db = openDb(path.join(config.dataDir, 'guideline.db'), { beforeMigrate: (d, _from, to) => migrationBackup(d, backups, to) });
  } catch (e) {
    error(e instanceof SchemaTooNewError ? e.message : `could not open the DB: ${e.message}`);
    return { code: 1 };
  }

  const stopBackups = scheduleBackups(db, backups, config.backupKeep, { log: error });
  const app = createApp({ config, db, log });
  if (env.GUIDELINE_SEED !== 'off') {
    const rev = seedIfEmpty({ store: app.store, lang: i18n.lang });
    if (rev !== null) log(`seeded the empty server with ${i18n.lang} guidelines (r${rev})`);
  }
  const server = http.createServer(app.handler);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(config.port, resolve);
    });
  } catch (e) {
    stopBackups();
    db.close();
    error(`could not listen on port ${config.port}: ${e.message}`);
    return { code: 1 };
  }

  const { port } = server.address();
  log(`guideline-server listening on port ${port} (revision r${app.store.headRevision()}, ${config.publicUrl.origin})`);
  const close = () => new Promise(resolve => {
    stopBackups();
    server.closeAllConnections();
    server.close(() => {
      db.close();
      resolve();
    });
  });
  return { code: 0, port, close };
}
