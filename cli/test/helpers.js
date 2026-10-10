import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** 임시 디렉터리를 만든다. 테스트가 끝나면 호출자가 지운다. */
export function tmpDir(prefix = 'guideline-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function write(root, rel, content) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}

export function read(root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

export function exists(root, rel) {
  return fs.existsSync(path.join(root, rel));
}

/** 명령 출력을 모은다. */
export function collect() {
  const lines = [];
  return { out: s => lines.push(s), text: () => lines.join('\n') };
}

export const ALWAYS = '---\nload: always\n---\n\n';
export const reference = when => `---\nload: reference\nwhen: "${when}"\n---\n\n`;

/** 문서 저장소 흉내: 스택 base 2개(always·reference), 스택 demo 1개(always), 뼈대 스택 empty, 스킬 1개 */
export function makeDocsRepo() {
  const root = tmpDir('guideline-docs-');
  write(root, 'rules/base/00-alpha.md', `${ALWAYS}# alpha\n\nA1\n`);
  write(root, 'rules/base/01-beta.md', `${reference('베타 작업을 할 때')}# beta\n\nB1\n`);
  write(root, 'rules/demo/00-rules.md', `${ALWAYS}# demo rules\n\nD1\n`);
  write(root, 'rules/empty/README.md', '뼈대\n');
  write(root, 'skills/demo-skill/SKILL.md', '---\nname: demo-skill\ndescription: 데모\n---\n\n본문\n');
  return root;
}

/**
 * pnpm 실행을 대신한다. 호출 인자를 calls 에 기록하고 정해진 종료 코드를 돌려준다.
 * statusFor 를 주면 호출 인자별로 다른 종료 코드를 낼 수 있다(없으면 status 를 쓴다).
 * @param {{ status?: number, onCall?: Function, statusFor?: (args: string[], cwd: string) => number | undefined }} [opts]
 */
export function fakePnpm({ status = 0, onCall, statusFor } = {}) {
  const calls = [];
  const run = (args, cwd) => {
    calls.push({ args, cwd });
    onCall?.({ args, cwd });
    const resolved = statusFor ? statusFor(args, cwd) : undefined;
    return { status: resolved ?? status };
  };
  run.calls = calls;
  return run;
}

/**
 * 목록의 갈래(세팅 문서, 바꿈 표, 무시됨, 경고, 서브에이전트, MCP 의 여러 형태, 분류)를 모두 건드리는 문서 저장소.
 * 서버로 가져올 수 있게 이름이 . 으로 시작하는 파일은 두지 않는다.
 */
export function makeRichDocsRepo() {
  const root = makeDocsRepo();
  write(root, 'rules/base/README.md', '---\ncategories: [공통]\n---\n\n# base\n');
  write(root, 'rules/base/02-git.md', `${ALWAYS}# git\n\n## 워크트리는 저장소 안에\n\n본문\n`);
  write(root, 'rules/base/SETUP.md', '# base 세팅\n\n## 확인\n\n없음\n');
  write(root, 'rules/base/오타.md', '규칙 아님\n');
  write(root, 'rules/demo/01-bad.md', '---\nload: sometimes\n---\n\n# bad\n');
  write(root, 'rules/orca/00-switch.md', '---\nload: always\ncategories: [orca]\n---\n\n# orca\n\n## 바꾸는 절\n\n본문\n');
  write(root, 'rules/orca/README.md', [
    '# orca', '', '## 다른 스택을 바꾸는 것', '',
    '| 이 스택의 절 | 바꾸는 절 |', '| --- | --- |',
    '| `00-switch.md` 「바꾸는 절」 | `base/02-git.md` 「워크트리는 저장소 안에」 |',
    '| `00-switch.md` 「바꾸는 절」 | `base/00-alpha.md` 「없는 절」 |', '',
  ].join('\n'));
  write(root, 'skills/no-skill/README.md', '없음\n');
  write(root, 'skills/cat-skill/SKILL.md', '---\nname: cat-skill\ndescription: 분류\ncategories: [a, ]\n---\n\n본문\n');
  write(root, 'agents/code-reviewer.md', '---\nname: code-reviewer\ndescription: 검토\ncategories: [검토]\n---\n\n# 검토\n');
  write(root, 'agents/bad.md', '---\nname: other\ndescription: x\n---\n');
  write(root, 'agents/notes.txt', '메모\n');
  write(root, 'mcp/context7/server.json', JSON.stringify({ type: 'stdio', command: 'npx', args: ['-y', 'c7'] }));
  write(root, 'mcp/gitlab/server.json', JSON.stringify({
    type: 'http', url: 'https://gitlab.example.com/mcp', headers: { Authorization: 'Bearer ${GITLAB_TOKEN}' },
  }));
  write(root, 'mcp/gitlab/README.md', '---\ncategories: [gitlab]\n---\n\n# gitlab\n');
  write(root, 'mcp/builder/README.md', '# builder\n\n## 반영할 때 항목 만들기\n\n내용\n');
  write(root, 'mcp/both/server.json', JSON.stringify({ type: 'stdio', command: 'x' }));
  write(root, 'mcp/both/README.md', '# both\n\n## 반영할 때 항목 만들기\n\n내용\n');
  write(root, 'mcp/leaky/server.json', JSON.stringify({ type: 'stdio', command: 'x', env: { TOKEN: 'secret' } }));
  write(root, 'mcp/file.txt', '디렉터리 아님\n');
  return root;
}

/**
 * 디렉터리 아래 모든 파일을 상대 경로 → 내용 표로 읽는다.
 * @param {string} root
 * @param {string} [dir]
 * @returns {Record<string, Buffer>}
 */
export function filesOf(root, dir = '') {
  const out = {};
  for (const d of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${d.name}` : d.name;
    if (d.isDirectory()) Object.assign(out, filesOf(root, rel));
    else out[rel] = fs.readFileSync(path.join(root, rel));
  }
  return out;
}
