import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startApp, META } from '../../server/test/helpers.js';
import { tmpDir, write, collect, makeRichDocsRepo } from './helpers.js';
import { SOURCE } from './render-fixture.js';
import { saveToken } from '../src/credentials.js';
import { manifestText } from '../src/manifest.js';
import { createI18n, setLocale, currentLocale } from '../src/i18n.js';
import { projectUpdate } from '../src/commands/project-update.js';
import { projectStatus } from '../src/commands/project-status.js';
import { projectPick } from '../src/commands/project-pick.js';
import { propose } from '../src/commands/propose.js';
import { list } from '../src/commands/list.js';
import { runGit } from '../src/projects.js';

// 영어 설정에서 사용자에게 보이는 CLI 문구에 한글이 없어야 한다. 사람이 쓴 지침 내용(차이 줄, 경로)은 빼고 본다.

const HANGUL = /[가-힣]/;
const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/guideline.js');

/** 사람이 쓴 내용이 섞이는 차이 줄을 뺀 줄들. */
const toolLines = text => text.split('\n').filter(l => !/^(\+|@@|-(?! )|-$| (?! )|--- |\+\+\+ )/.test(l));
/** JSON 출력이면 도구가 지은 문장(message·reason)만, 아니면 차이 줄을 뺀 줄. 분류 [..] 와 reference 의 when 은 사람이 쓴 것이다. */
function toolText(text) {
  try {
    const out = [];
    const walk = v => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (k === 'message' || k === 'reason' ? out.push(String(x)) : walk(x));
    };
    walk(JSON.parse(text));
    return out;
  } catch {
    return toolLines(text).map(l => l.replace(/\[[^\]]*\]/g, '').replace(/reference {2}.*/, 'reference'));
  }
}
const assertNoHangul = (text, what) => {
  const bad = toolText(text).filter(l => HANGUL.test(l));
  assert.deepEqual(bad, [], `${what} 에 한글이 보인다`);
};

function english(t) {
  const prev = currentLocale();
  setLocale(createI18n({ lang: 'en', env: {} }));
  t.after(() => setLocale(prev));
}

function run(args, cwd) {
  try {
    return execFileSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: { ...process.env, GUIDELINE_LANG: 'en', GUIDELINE_SERVER: '' } });
  } catch (e) {
    return (e.stdout ?? '') + (e.stderr ?? '');
  }
}

test('영어: 도움말·알 수 없는 명령·옵션·서버 없음에 한글이 없다', t => {
  const dir = tmpDir('guideline-empty-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assertNoHangul(run(['help'], dir), 'help');
  assertNoHangul(run(['sync'], dir), '알 수 없는 명령');
  assertNoHangul(run(['list', '--force'], dir), '알 수 없는 옵션');
  assertNoHangul(run(['list'], dir), 'list(서버 없음)');
  assertNoHangul(run(['status'], dir), 'status(받지 않음)');
  assertNoHangul(run(['update'], dir), 'update(.ruler 없음)');
  fs.mkdirSync(path.join(dir, '.ruler'));
  assertNoHangul(run(['pick', '--no-browser'], dir), 'pick(서버 없음)');
  assertNoHangul(run(['propose'], dir), 'propose(받지 않음)');
  assertNoHangul(run(['source'], dir), 'source(폴더 없음)');
  assertNoHangul(run(['login'], dir), 'login(서버 없음)');
});

test('영어: update(할 일 포함)·status·propose --dry-run·pick 의 출력에 한글이 없다', async t => {
  english(t);
  const config = tmpDir('guideline-cfg-');
  t.after(() => fs.rmSync(config, { recursive: true, force: true }));
  const env = { XDG_CONFIG_HOME: config };
  const s = await startApp(t);
  s.store.commit({ ...META, source: 'import', changes: SOURCE });
  saveToken(s.base, { token: s.tokens.issue({ name: 'cli-t', scope: 'propose' }).token, name: 'cli-t' }, { env });
  const p = tmpDir('guideline-proj-');
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  write(p, '.ruler/ruler.toml', 'default_agents = ["claude"]\n');
  write(p, 'guideline.json', manifestText({ version: 2, form: 'ruler', agents: ['claude'], sources: {
    default: { server: s.base, items: ['rules/base/00-a.md', 'rules/base/SETUP.md', 'skills/s', 'mcp/b', 'mcp/gl', 'agents/rev.md'] },
  } }));
  runGit(['init', '-q'], p);

  for (const json of [false, true]) {
    const o = collect();
    await projectUpdate({ project: p, env, json, out: o.out, err: o.out, runRuler: () => 0 });
    assert.ok(o.text().length > 0);
    assertNoHangul(o.text(), `update${json ? ' --json' : ''}`);
  }
  write(p, '.ruler/base/00-a.md', 'changed\n');
  for (const json of [false, true]) {
    const o = collect();
    await projectStatus({ project: p, env, json, out: o.out, err: o.out });
    assertNoHangul(o.text(), `status${json ? ' --json' : ''}`);
    const u = collect();
    await projectUpdate({ project: p, env, json, out: u.out, err: u.out, runRuler: () => 0 });
    assertNoHangul(u.text(), `update(건너뜀)${json ? ' --json' : ''}`);
    const d = collect();
    await propose({ project: p, env, dryRun: true, json, out: d.out, err: d.out });
    assertNoHangul(d.text(), `propose --dry-run${json ? ' --json' : ''}`);
  }
  const e = collect();
  await projectPick({ project: p, env, source: 'other', out: e.out, err: e.out, browser: false });
  assertNoHangul(e.text(), 'pick(모르는 출처)');
});

test('영어: list 의 경고·무시됨에 한글이 없다', async t => {
  english(t);
  const root = makeRichDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(root, 'rules/base/02-bad.md', '---\nload: nope\n---\n# x\n');
  write(root, 'rules/base/bad-name.md', '# x\n');
  for (const json of [false, true]) {
    const o = collect();
    await list({ root, json, out: o.out });
    // 경로와 따옴표 안의 절 제목은 사람이 쓴 내용이라 뺀다
    const data = json ? JSON.parse(o.text()) : null;
    const lines = json ? [...data.warnings.map(w => w.message), ...data.ignored.map(i => i.reason)] : o.text().split('\n');
    const tool = lines.map(l => l.replace(/\S*\/\S*/g, '').replace(/"[^"]*"|「[^」]*」/g, ''));
    assertNoHangul(tool.join('\n'), `list${json ? ' --json' : ''}`);
  }
});
