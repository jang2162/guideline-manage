import { memoryTree } from '../src/tree.js';
import { ALWAYS, reference } from './helpers.js';

export const DEPLOY = 'deploy-agent__deploy.kbrainc.dev';

/** 렌더링 테스트의 원본. 이름에 . 과 __ 가 든 스택, 바이너리 보조 파일, 세 갈래의 MCP 를 담는다. */
export const SOURCE = {
  'rules/base/README.md': '# base\n',
  'rules/base/00-a.md': `${ALWAYS}# 에이\n\n## 절 하나\n\n본문 A\n\n### 아래\n\n깊이\n`,
  'rules/base/01-b.md': `${reference('비 작업을 할 때')}# 비\n\n본문 B\n`,
  'rules/base/SETUP.md': '# base 세팅\n',
  [`rules/${DEPLOY}/00-x.md`]: `${reference('배포 | 할 때')}# 엑스\n`,
  [`rules/${DEPLOY}/01-y.md`]: `${ALWAYS}# 와이\n\n## 와이 절\n\n본문 Y\n`,
  'skills/s/SKILL.md': '---\nname: s\ndescription: 스\n---\n\n본문\n',
  'skills/s/img/a.png': Buffer.from([1, 2, 3]),
  'agents/rev.md': '---\nname: rev\ndescription: "검토한다"\ntools: Read\nmodel: inherit\n---\n\n# 검토\n\n지시\n',
  'mcp/c7/server.json': JSON.stringify({ type: 'stdio', command: 'npx', args: ['-y', 'c7'] }),
  'mcp/gl/server.json': JSON.stringify({ type: 'http', url: 'https://g/mcp', headers: { Authorization: 'Bearer ${GITLAB_TOKEN}' } }),
  'mcp/b/README.md': '# b\n\n## 반영할 때 항목 만들기\n\n내용\n',
};

export const ALL = [
  'agents/rev.md', 'mcp/b', 'mcp/c7', 'mcp/gl',
  'rules/base/00-a.md', 'rules/base/01-b.md', 'rules/base/SETUP.md',
  `rules/${DEPLOY}/00-x.md`, `rules/${DEPLOY}/01-y.md`, 'skills/s',
];

/** over 의 값이 null 이면 그 파일을 뺀다. */
export function renderTree(over = {}) {
  const files = { ...SOURCE, ...over };
  for (const [k, v] of Object.entries(files)) if (v === null) delete files[k];
  return memoryTree(files);
}

export function manifestOf(form, items, extra = {}) {
  return {
    version: 1,
    server: 'http://localhost:3000',
    form,
    instructionFiles: form === 'ruler' ? [] : ['AGENTS.md', 'CLAUDE.md'],
    agents: ['claude', 'codex'],
    items,
    ...extra,
  };
}

/** 메모리 프로젝트. render 는 read·exists·rulerAgentsEnabled 만 쓴다. */
export function memProject(files = {}, { rulerAgentsEnabled = false } = {}) {
  return {
    files,
    read: rel => (Object.hasOwn(files, rel) ? Buffer.from(files[rel]) : null),
    exists: rel => Object.hasOwn(files, rel),
    rulerAgentsEnabled,
  };
}

/** render 의 files(null 은 지움)를 얹은 새 파일 표. */
export function applyMem(files, changes) {
  const next = { ...files };
  for (const [p, c] of Object.entries(changes)) {
    if (c === null) delete next[p];
    else next[p] = Buffer.from(c);
  }
  return next;
}
