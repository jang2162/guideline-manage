import { template } from '../../cli/src/i18n.js';

/** 빈 서버에 넣는 씨앗: 원본 경로 → 언어팩 템플릿 이름. */
const SEEDS = {
  'docs/authoring.md': 'authoring.md',
  'skills/guideline-sync/SKILL.md': 'skills/guideline-sync/SKILL.md',
  'skills/guideline-export/SKILL.md': 'skills/guideline-export/SKILL.md',
};

/**
 * 리비전이 하나도 없으면 서버 언어의 씨앗을 리비전 하나로 넣는다.
 * @param {{ store: ReturnType<import('./store.js').createStore>, lang: string }} opts
 * @returns {number | null} 넣은 리비전 번호, 이미 리비전이 있으면 null
 */
export function seedIfEmpty({ store, lang }) {
  if (store.headRevision() > 0) return null;
  const changes = Object.fromEntries(Object.entries(SEEDS).map(([p, name]) => [p, template(name)]));
  return store.commit({ author: 'system', message: `seed (${lang})`, source: 'seed', changes });
}
