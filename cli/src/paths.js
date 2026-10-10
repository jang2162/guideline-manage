import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 이 패키지(앱 저장소)의 루트. cli/src/ 에서 두 단계 위. */
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 패키지가 소유하는 자산(관리 스킬, 작성 규칙 템플릿). */
export const assetsDir = path.join(packageRoot, 'assets');

/** 앱(이 패키지)의 버전. */
export function packageVersion() {
  return JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;
}
