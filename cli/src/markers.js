import { currentLocale } from './i18n.js';

// 사람이 쓴 지침 안에서 도구가 찾아 읽는 표지 제목. 언어팩이 번역하면 파서가 못 읽는 제목을
// 안내하게 되므로 코드에 고정한다. 영어가 정본이고 한국어도 읽는다. [영어, 한국어]
export const OVERRIDES_SECTIONS = ['Overrides of other stacks', '다른 스택을 바꾸는 것'];
export const BUILD_SECTIONS = ['Build on apply', '반영할 때 항목 만들기'];

const MARKERS = { overridesSection: OVERRIDES_SECTIONS, buildSection: BUILD_SECTIONS };

/** 안내 문장에 넣을 표지 제목: ko 설정이면 한국어 표지, 그 밖은 영어 표지. */
export function marker(name) {
  return MARKERS[name][currentLocale().lang === 'ko' ? 1 : 0];
}
