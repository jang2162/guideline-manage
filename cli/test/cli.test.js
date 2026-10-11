import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeDocsRepo, tmpDir } from './helpers.js';

const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/guideline.js');

function run(args, cwd, env) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: env ?? process.env }) };
  } catch (e) {
    return { code: e.status, out: (e.stdout ?? '') + (e.stderr ?? '') };
  }
}

test('list <폴더> 는 그 폴더(원본 모양)를 읽는다', t => {
  const root = makeDocsRepo();
  const cwd = tmpDir('guideline-empty-');
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  const r = run(['list', root], cwd);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /00-alpha\.md/);
  assert.match(r.out, /demo-skill/);
  const j = run(['list', root, '--json'], cwd);
  assert.equal(j.code, 0, j.out);
  const data = JSON.parse(j.out);
  assert.deepEqual(data.stacks.map(s => s.name), ['base', 'demo']);
  assert.deepEqual(data.stacks[0].files[1], { path: 'rules/base/01-beta.md', load: 'reference', when: '베타 작업을 할 때' });
});

test('문서 저장소 안에서도 폴더 없는 list 는 서버 목록이고, update·pick 은 프로젝트 모드다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs', 'authoring.md'), '# 작성 규칙\n');
  const env = { ...process.env, GUIDELINE_SERVER: '' };
  const l = run(['list'], root, env);
  assert.equal(l.code, 2);
  assert.match(l.out, /서버 주소 없음/);
  for (const args of [['update', '--json'], ['pick', '--no-browser'], ['pick', '--new', 'x']]) {
    const r = run(args, root, env);
    assert.equal(r.code, 2, r.out);
    assert.doesNotMatch(r.out, /문서 저장소 모드/);
  }
});

test('문서 저장소가 아닌 곳에서 list 는 서버 목록이고, 서버 주소가 없으면 2', t => {
  const dir = tmpDir('guideline-empty-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = run(['list'], dir, { ...process.env, GUIDELINE_SERVER: '' });
  assert.equal(r.code, 2);
  assert.match(r.out, /서버 주소 없음/);
});

test('help 는 0, 알 수 없는 명령은 2 로 끝난다', t => {
  const dir = tmpDir('guideline-empty-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(run(['help'], dir).code, 0);
  assert.equal(run([], dir).code, 0);
  const r = run(['sync'], dir);
  assert.equal(r.code, 2);
  assert.match(r.out, /알 수 없는 명령: sync/);
});

test('명령에 허용되지 않은 옵션을 주면 종료 코드 2', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  let r = run(['list', '--force'], root);
  assert.equal(r.code, 2);
  assert.match(r.out, /알 수 없는 옵션: --force  \(list 에서 쓸 수 있는 옵션: --json, --server, --source\)/);

  r = run(['update', '--title', 'x'], root);
  assert.equal(r.code, 2);
  assert.match(r.out, /알 수 없는 옵션: --title  \(update 에서 쓸 수 있는 옵션: --project, --server, --source, --force, --json\)/);
});

test('help 명령도 옵션 검증을 받는다', t => {
  const dir = tmpDir('guideline-empty-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const r = run(['help', '--title', 'x'], dir);
  assert.equal(r.code, 2);
  assert.match(r.out, /알 수 없는 옵션: --title  \(help 에서 쓸 수 있는 옵션: 없음\)/);

  assert.equal(run(['help'], dir).code, 0, 'help 단독은 여전히 도움말 + 0');
});

test('init 은 없는 명령이고, update --installed 는 알 수 없는 옵션이다', t => {
  const dir = tmpDir('guideline-empty-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const r = run(['init'], dir);
  assert.equal(r.code, 2);
  assert.match(r.out, /알 수 없는 명령: init/);
  const u = run(['update', '--installed'], dir);
  assert.equal(u.code, 2);
  assert.match(u.out, /--installed/);
});

test('help 에 pick 이 있고, pick 에 허용되지 않은 옵션은 2', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const h = run(['help'], root);
  assert.equal(h.code, 0);
  assert.match(h.out, /pick +내보낼 지침을 웹 폼에서 선택/);
  assert.match(h.out, /--no-browser/);
  assert.match(h.out, /--recommend <파일\|->/);
  assert.match(h.out, /status +반영한 지침이 최신인지/);
  const bad = run(['pick', '--force'], root);
  assert.equal(bad.code, 2);
  assert.match(bad.out, /pick 에서 쓸 수 있는 옵션: --project, --no-browser, --new, --server, --source, --recommend, --json/);
});

test('bin 의 pick: 서버 주소가 없으면 2', t => {
  const dir = tmpDir('guideline-empty-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.ruler'));
  const r = run(['pick', '--no-browser'], dir, { ...process.env, GUIDELINE_SERVER: '' });
  assert.equal(r.code, 2);
  assert.match(r.out, /서버 주소 없음/);
});

test('server-import 명령은 없다', t => {
  const root = makeDocsRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const r = run(['server-import'], root);
  assert.equal(r.code, 2);
  assert.match(r.out, /알 수 없는 명령: server-import/);
  assert.doesNotMatch(run(['help'], root).out, /server-import/);
});

test('help 에 propose·source 가 있고, 옵션 검사를 받는다', t => {
  const dir = tmpDir('guideline-empty-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const h = run(['help'], dir);
  assert.match(h.out, /propose +고친 사본을 원본 모양으로 되돌려 지침 서버에 제안/);
  assert.match(h.out, /source +지침 서버의 최신 원본을 빈 폴더에 풀기/);
  assert.match(h.out, /--from <폴더>/);
  assert.match(h.out, /--apply +admin 토큰이면 제안 대신 바로 반영/);
  const bad = run(['propose', '--force'], dir);
  assert.equal(bad.code, 2);
  assert.match(bad.out, /propose 에서 쓸 수 있는 옵션: --project, --server, --source, --title, --message, --only, --from, --dry-run, --apply, --json/);
  const noDir = run(['source'], dir);
  assert.equal(noDir.code, 2);
  assert.match(noDir.out, /풀 폴더 지정 필요/);
});

test('help 에 --source 가 있고, 프로젝트 명령은 --source 를 받는다', t => {
  const dir = tmpDir('guideline-empty-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.match(run(['help'], dir).out, /--source <이름>/);
  const bad = run(['pick', '--source', 'x', '--force'], dir);
  assert.equal(bad.code, 2);
  assert.match(bad.out, /pick 에서 쓸 수 있는 옵션: .*--source/);
});

test('help 에 locale 이 있고, locale list 는 0', t => {
  const dir = tmpDir('guideline-empty-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.match(run(['help'], dir).out, /locale +/);
  const r = run(['locale', 'list'], dir);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /\ben\b/);
  assert.equal(run(['locale', 'list', '--force'], dir).code, 2);
});

test('CLI 는 언어 경고(모르는 언어, 깨진 언어팩)를 stderr 에 한 번 낸다', () => {
  const r = spawnSync(process.execPath, [bin, 'help'], { encoding: 'utf8', env: { ...process.env, GUIDELINE_LANG: 'jp' } });
  assert.equal(r.status, 0);
  const hits = r.stderr.split('\n').filter(l => /"jp"/.test(l));
  assert.equal(hits.length, 1, r.stderr);
});

test('명령별로 허용한 옵션은 모두 명령줄 해석표에 있다', async () => {
  const { OPTIONS, ALLOWED_OPTIONS } = await import('../src/cli.js');
  const missing = Object.entries(ALLOWED_OPTIONS).flatMap(([cmd, names]) => names.filter(n => !Object.hasOwn(OPTIONS, n)).map(n => `${cmd} --${n}`));
  assert.deepEqual(missing, []);
});

test('propose --apply 를 명령줄에서 받는다', () => {
  const folder = tmpDir('guideline-not-source-');
  const r = run(['propose', '--from', folder, '--title', 'x', '--apply'], folder);
  assert.doesNotMatch(r.out, /Unknown option/);
  assert.equal(r.code, 2);
});
