import fs from 'node:fs';
import path from 'node:path';
import { checkPack, listLocales, normalizeLang, t } from '../i18n.js';

/**
 * 언어팩 작성자 도구. check 는 언어팩 폴더를 정본(en)과 비교하고, list 는 쓸 수 있는 언어를 보인다.
 * @param {{ action?: string, dir?: string, json?: boolean, out?: (s: string) => void, err?: (s: string) => void, env?: object, home?: string }} opts
 * @returns {number}
 */
export function locale({ action, dir, json = false, out = console.log, err = console.error, env = process.env, home }) {
  if (action === 'check') {
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      err(t('locale.noDir', { dir: dir ?? '' }));
      return 2;
    }
    const { code, problems } = checkPack(path.resolve(dir));
    if (json) out(JSON.stringify({ problems }, null, 2));
    else if (problems.length === 0) out(t('locale.checkOk'));
    else for (const p of problems) out(`${p.kind}\t${p.message}`);
    return code;
  }
  if (action === 'list') {
    const locales = listLocales({ env, home });
    const now = normalizeLang(env.GUIDELINE_LANG);
    if (json) out(JSON.stringify({ current: now, locales }, null, 2));
    else for (const l of locales) out(`${l.code === now ? '*' : ' '} ${l.code}\t${l.name}\t${l.version}\t${l.where}`);
    return 0;
  }
  err(t('locale.usage'));
  return 2;
}
