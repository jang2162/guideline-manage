import os from 'node:os';
import path from 'node:path';

/** 로그인·언어·머신 기본값이 함께 사는 폴더. XDG_CONFIG_HOME 이 있으면 그 아래, 없으면 ~/.config 아래 guideline. */
export function configDir({ env = process.env, home = os.homedir() } = {}) {
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'guideline');
}
