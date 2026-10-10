import fs from 'node:fs';
import path from 'node:path';

const AUTO = /^guideline-\d{8}-\d{6}\.db$/;

/** UTC 기준 YYYYMMDD-HHmmss. */
export function stamp(date) {
  const iso = date.toISOString();
  return `${iso.slice(0, 10).replaceAll('-', '')}-${iso.slice(11, 19).replaceAll(':', '')}`;
}

function vacuumInto(db, file) {
  db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`);
}

/**
 * 자동 백업 하나를 만든다. 같은 이름(같은 초)이 이미 있으면 그대로 둔다.
 * @returns {string} 백업 파일 경로
 */
export function backupNow(db, dir, now = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `guideline-${stamp(now)}.db`);
  if (!fs.existsSync(file)) vacuumInto(db, file);
  return file;
}

/**
 * 자동 백업이 keep 개를 넘으면 오래된 것부터 지운다. 마이그레이션 전 백업은 이름이 달라 건드리지 않는다.
 * @returns {string[]} 지운 파일 이름
 */
export function pruneBackups(dir, keep) {
  const names = fs.readdirSync(dir).filter(n => AUTO.test(n)).sort();
  const removed = names.slice(0, Math.max(0, names.length - keep));
  for (const n of removed) fs.rmSync(path.join(dir, n));
  return removed;
}

/** 스키마를 올리기 직전의 백업. 자동으로 지우지 않는다. */
export function migrationBackup(db, dir, toVersion, now = new Date()) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `guideline-pre-v${toVersion}-${stamp(now)}.db`);
  vacuumInto(db, file);
  return file;
}

/**
 * 지금 한 번, 그 뒤 intervalMs 마다 백업하고 오래된 것을 지운다. 실패는 로그만 남기고 서버는 계속 돈다.
 * @param {{ intervalMs?: number, now?: () => Date, log?: (m: string) => void }} [opts]
 * @returns {() => void} 멈추는 함수
 */
export function scheduleBackups(db, dir, keep, { intervalMs = 24 * 60 * 60 * 1000, now = () => new Date(), log = console.error } = {}) {
  const run = () => {
    try {
      backupNow(db, dir, now());
      pruneBackups(dir, keep);
    } catch (e) {
      log(`backup failed: ${e.message}`);
    }
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
