import { frontmatter, yamlString } from './frontmatter.js';
import { t } from './i18n.js';

const LOADS = ['always', 'reference'];

/**
 * 지침 파일 frontmatter 의 칸(load)과 읽을 때(when)를 읽는다. 없다고 always 로 추정하지 않는다.
 * @param {string} text 지침 파일 내용
 * @returns {{ load: 'always' | 'reference', when: string | null } | { warning: string }}
 */
export function readTier(text) {
  const fm = frontmatter(text);
  if (!fm?.load) return { warning: t('tiers.noLoad') };
  const load = yamlString(fm.load);
  const when = fm.when ? yamlString(fm.when) : '';
  if (load === null || when === null) return { warning: t('tiers.badYaml') };
  if (!LOADS.includes(load)) return { warning: t('tiers.badLoad') };
  if (load === 'reference' && !when) return { warning: t('tiers.noWhen') };
  if (load === 'always' && when) return { warning: t('tiers.whenWithAlways') };
  return { load, when: when || null };
}
