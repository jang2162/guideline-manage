import { t } from './i18n.js';

// 도메인 스택: `<도구>__<도메인>`. 같은 도구라도 돌아가는 서버(회사·인스턴스)가 다르면 규칙이 달라 스택을 나눈다.
const SEP = '__';
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/**
 * @param {string} name 스택 이름
 * @returns {{ tool: string, domain: string | null }}
 */
export function splitStackName(name) {
  const i = name.indexOf(SEP);
  return i === -1 ? { tool: name, domain: null } : { tool: name.slice(0, i), domain: name.slice(i + SEP.length) };
}

/** `__` 가 있는데 도메인 모양이 아니면 경고 문구. 없거나 맞으면 null. */
export function stackNameProblem(name) {
  const { domain } = splitStackName(name);
  if (domain === null || DOMAIN.test(domain)) return null;
  return t('catalog.badDomain');
}
