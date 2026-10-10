import { t, template } from '../../../cli/src/i18n.js';

// 새 파일 화면의 빈 틀. 내용은 언어팩의 templates/new-file/ 이고, 모양은 templates/authoring.md 의 템플릿과 같다.

/** @type {Record<string, { label: string, file: string, content: string }>} */
export const TEMPLATES = {
  empty: { get label() { return t('web.template.empty'); }, file: '', content: '' },
  readme: { get label() { return t('web.template.readme'); }, file: 'README.md', get content() { return template('new-file/readme.md'); } },
  always: {
    get label() { return t('web.template.always'); },
    get file() { return t('web.template.ruleFile'); },
    get content() { return `---\nload: always\n---\n\n${template('new-file/rule.md')}`; },
  },
  reference: {
    get label() { return t('web.template.reference'); },
    get file() { return t('web.template.ruleFile'); },
    get content() { return `---\nload: reference\nwhen: "${t('web.template.when')}"\n---\n\n${template('new-file/rule.md')}`; },
  },
  setup: { get label() { return t('web.template.setup'); }, file: 'SETUP.md', get content() { return template('new-file/setup.md'); } },
  skill: { get label() { return t('web.template.skill'); }, file: 'SKILL.md', get content() { return template('new-file/skill.md'); } },
  agent: { get label() { return t('web.template.agent'); }, get file() { return t('web.template.agentFile'); }, get content() { return template('new-file/agent.md'); } },
  mcp: { get label() { return t('web.template.mcp'); }, file: 'README.md', get content() { return template('new-file/mcp.md'); } },
};
