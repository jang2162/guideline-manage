import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpDir, exists, read, collect } from './helpers.js';
import { syncedProject } from './synced.js';
import { runGit } from '../src/projects.js';
import { PROJECT_TOML } from '../src/layout.js';
import { agents } from '../src/commands/agents.js';

// guideline agents: guideline.json 의 agents 와 ruler.project.toml 의 default_agents 를 함께 바꾸고 apply 한다. 프로젝트는 임시 git
// 저장소라 이 저장소의 .git 은 건드리지 않는다. ruler 는 가짜(부른 횟수만 센다).

const env = { PATH: '' };
const TOML = '# 프로젝트 설정\ndefault_agents = ["claude"]\nnested = false\n\n[gitignore]\nenabled = true\n\n[agents.claude]\noutput_path = "AGENTS.md"\n';

/** 받아서 커밋한 프로젝트(git 루트). */
function project(t, { agents: list = ['claude'], toml = TOML, sub = null, subToml = null } = {}) {
  const p = fs.realpathSync(tmpDir('guideline-agents-cmd-'));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  runGit(['init', '-q'], p);
  syncedProject(p, { agents: list, toml });
  if (sub) {
    fs.mkdirSync(path.join(p, sub), { recursive: true });
    syncedProject(path.join(p, sub), { agents: list, toml: subToml, nested: true });
  }
  // findRuler 가 찾는 자리에 ruler 를 둔다(부르는 것은 가짜 runRuler)
  fs.mkdirSync(path.join(p, 'node_modules', '.bin'), { recursive: true });
  fs.writeFileSync(path.join(p, 'node_modules', '.bin', 'ruler'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  runGit(['add', '-A'], p);
  runGit(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'c'], p);
  return p;
}

/** agents 명령을 돈다. rulerCalls 는 가짜 ruler 를 부른 횟수. */
async function run(cwd, opts) {
  const o = collect();
  const e = collect();
  let rulerCalls = 0;
  const runRuler = () => {
    rulerCalls++;
    return 0;
  };
  const code = await agents({ cwd, env, runRuler, out: o.out, err: e.out, ...opts });
  return { code, out: o.text(), err: e.text(), rulerCalls };
}

const manifestAgents = (p, rel = '') => JSON.parse(read(path.join(p, rel), 'guideline.json')).agents;
const snapshot = p => ({ manifest: read(p, 'guideline.json'), toml: exists(p, PROJECT_TOML) ? read(p, PROJECT_TOML) : null });

/** 가짜 ruler 가 PATH 에 있게(진짜 ruler 를 부르지 않게). */
function fakeRulerPath(t) {
  const bin = fs.realpathSync(tmpDir('guideline-agents-bin-'));
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  fs.writeFileSync(path.join(bin, 'ruler'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return bin;
}

test('add codex 는 두 파일을 함께 바꾸고 apply 한다(toml 의 다른 줄은 그대로)', async t => {
  const p = project(t);
  const r = await run(p, { action: 'add', names: ['codex'] });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(manifestAgents(p), ['claude', 'codex']);
  assert.equal(read(p, PROJECT_TOML), TOML.replace('default_agents = ["claude"]', 'default_agents = ["claude", "codex"]'));
  assert.equal(r.rulerCalls, 1);
  // 조합한 ruler.toml 도 새 목록을 따른다
  assert.match(read(p, '.ruler/ruler.toml'), /^default_agents = \["claude", "codex"\]$/m);
});

test('remove 로 마지막 에이전트를 지우면 2, 두 파일은 바이트 그대로', async t => {
  const p = project(t);
  const before = snapshot(p);
  const r = await run(p, { action: 'remove', names: ['claude'] });
  assert.equal(r.code, 2);
  assert.match(r.err, /에이전트가 하나는/);
  assert.deepEqual(snapshot(p), before);
  assert.equal(r.rulerCalls, 0);
});

test('AGENTS 밖의 이름은 2, 허용 이름을 알리고 아무것도 쓰지 않는다', async t => {
  const p = project(t);
  const before = snapshot(p);
  const r = await run(p, { action: 'add', names: ['codex', 'cursor'] });
  assert.equal(r.code, 2);
  assert.match(r.err, /cursor/);
  assert.match(r.err, /claude, codex, opencode/);
  assert.deepEqual(snapshot(p), before);
});

test('이름 없이 add 하면 2', async t => {
  const p = project(t);
  const r = await run(p, { action: 'add', names: [] });
  assert.equal(r.code, 2);
  assert.match(r.err, /guideline agents add/);
});

test('모르는 동작은 2', async t => {
  const p = project(t);
  const r = await run(p, { action: 'set', names: ['codex'] });
  assert.equal(r.code, 2);
  assert.match(r.err, /set/);
});

test('이미 있는 이름 add 는 0, 바뀐 것 없음, 파일과 mtime 그대로, ruler 안 돎', async t => {
  const p = project(t, { agents: ['claude', 'codex'], toml: TOML.replace('["claude"]', '["claude", "codex"]') });
  const before = snapshot(p);
  const mtimes = ['guideline.json', PROJECT_TOML].map(f => fs.statSync(path.join(p, f)).mtimeMs);
  const r = await run(p, { action: 'add', names: ['codex'] });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /바뀐 것 없음/);
  assert.deepEqual(snapshot(p), before);
  assert.deepEqual(['guideline.json', PROJECT_TOML].map(f => fs.statSync(path.join(p, f)).mtimeMs), mtimes);
  assert.equal(r.rulerCalls, 0);
});

test('없는 이름 remove 도 바뀐 것 없음', async t => {
  const p = project(t);
  const before = snapshot(p);
  const r = await run(p, { action: 'remove', names: ['opencode'] });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /바뀐 것 없음/);
  assert.deepEqual(snapshot(p), before);
});

test('guideline.json 은 같아도 toml 이 어긋나 있으면 remove 가 toml 을 맞춘다', async t => {
  const p = project(t, { toml: TOML.replace('["claude"]', '["claude", "codex"]') });
  const r = await run(p, { action: 'remove', names: ['codex'] });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(manifestAgents(p), ['claude']);
  assert.equal(read(p, PROJECT_TOML), TOML);
  assert.equal(r.rulerCalls, 1);
});

test('default_agents 가 여러 줄 배열이면 2, 두 파일 그대로', async t => {
  const multi = TOML.replace('default_agents = ["claude"]', 'default_agents = [\n  "claude",\n]');
  const p = project(t, { toml: multi });
  const before = snapshot(p);
  const r = await run(p, { action: 'add', names: ['codex'] });
  assert.equal(r.code, 2);
  assert.match(r.err, /ruler\.project\.toml/);
  assert.match(r.err, /한 줄/);
  assert.deepEqual(snapshot(p), before);
  assert.equal(r.rulerCalls, 0);
});

test('default_agents 줄이 없어도 2, 두 파일 그대로', async t => {
  const p = project(t, { toml: 'nested = false\n' });
  const before = snapshot(p);
  const r = await run(p, { action: 'add', names: ['codex'] });
  assert.equal(r.code, 2);
  assert.deepEqual(snapshot(p), before);
});

test('ruler.project.toml 이 없으면 guideline.json 만 바꾸고 toml 은 만들지 않는다', async t => {
  const p = project(t, { toml: null });
  assert.equal(exists(p, PROJECT_TOML), false);
  const r = await run(p, { action: 'add', names: ['codex'] });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(manifestAgents(p), ['claude', 'codex']);
  assert.equal(exists(p, PROJECT_TOML), false);
});

test('guideline.json 이 없으면 받은 적 없음, 2', async t => {
  const p = fs.realpathSync(tmpDir('guideline-agents-none-'));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  runGit(['init', '-q'], p);
  for (const opts of [{}, { action: 'add', names: ['codex'] }]) {
    const r = await run(p, opts);
    assert.equal(r.code, 2);
    assert.match(r.err, /guideline pick 먼저/);
  }
  assert.equal(exists(p, 'guideline.json'), false);
});

test('인자 없이 --json 은 두 목록과 어긋남', async t => {
  const p = project(t, { toml: TOML.replace('["claude"]', '["codex", "claude"]') });
  const r = await run(p, { json: true });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out), { agents: ['claude'], rulerAgents: ['codex', 'claude'], mismatch: true });
  const same = await run(project(t), { json: true });
  assert.deepEqual(JSON.parse(same.out), { agents: ['claude'], rulerAgents: ['claude'], mismatch: false });
});

test('인자 없이 글로 보이면 두 목록을 쓰고 어긋나면 고치는 법을 알린다', async t => {
  const p = project(t, { toml: TOML.replace('["claude"]', '["claude", "codex"]') });
  const r = await run(p, {});
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /guideline\.json.*claude/);
  assert.match(r.out, /default_agents.*claude, codex/);
  assert.match(r.out, /guideline agents add\|remove/);
  const same = await run(project(t), {});
  assert.doesNotMatch(same.out, /guideline agents add\|remove/);
});

test('하위 단위에 자기 ruler.project.toml 이 없으면 그 단위의 guideline.json 만 바꾸고 루트의 것은 그대로, 루트를 따른다고 알린다', async t => {
  const p = project(t, { sub: 'pkg/a' });
  const root = snapshot(p);
  const sub = path.join(p, 'pkg/a');
  const shown = await run(sub, { json: true });
  // 보이는 default_agents 는 ruler 가 따르는 루트의 것
  assert.deepEqual(JSON.parse(shown.out), { agents: ['claude'], rulerAgents: ['claude'], mismatch: false });
  const r = await run(sub, { action: 'add', names: ['codex'] });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(manifestAgents(p, 'pkg/a'), ['claude', 'codex']);
  assert.equal(exists(sub, PROJECT_TOML), false);
  assert.deepEqual(snapshot(p), root);
  assert.match(r.out + r.err, /git 루트/);
});

test('하위 단위에 자기 ruler.project.toml 이 있으면 그 단위의 두 파일을 바꾼다', async t => {
  const p = project(t, { sub: 'pkg/a', subToml: 'default_agents = ["claude"]\n' });
  const root = snapshot(p);
  const sub = path.join(p, 'pkg/a');
  const r = await run(sub, { action: 'add', names: ['codex'] });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(manifestAgents(p, 'pkg/a'), ['claude', 'codex']);
  assert.equal(read(sub, PROJECT_TOML), 'default_agents = ["claude", "codex"]\n');
  assert.deepEqual(snapshot(p), root);
});

test('명령줄 guideline agents add codex 도 같은 결과', t => {
  const p = project(t);
  const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../bin/guideline.js');
  const gitDir = path.dirname(spawnSync('/bin/sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim());
  const cliEnv = { ...process.env, GUIDELINE_LANG: 'ko', PATH: [fakeRulerPath(t), gitDir].join(path.delimiter) };
  const out = execFileSync(process.execPath, [bin, 'agents', 'add', 'codex', '--json'], { cwd: p, encoding: 'utf8', env: cliEnv });
  assert.ok(Array.isArray(JSON.parse(out).todos));
  assert.deepEqual(manifestAgents(p), ['claude', 'codex']);
  assert.match(read(p, PROJECT_TOML), /^default_agents = \["claude", "codex"\]$/m);
  const shown = JSON.parse(execFileSync(process.execPath, [bin, 'agents', '--json'], { cwd: p, encoding: 'utf8', env: cliEnv }));
  assert.deepEqual(shown, { agents: ['claude', 'codex'], rulerAgents: ['claude', 'codex'], mismatch: false });
  const bad = spawnSync(process.execPath, [bin, 'agents', 'add', 'codex', '--server', 'http://x'], { cwd: p, encoding: 'utf8', env: cliEnv });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /agents 에서 쓸 수 있는 옵션: --project, --json/);
});

test('apply 가 받지 못할 프로젝트(잠금 없음, 옛 배치)면 쓰기 전에 2, 두 파일 그대로', async t => {
  const p = project(t);
  fs.rmSync(path.join(p, 'guideline-lock.json'));
  const before = snapshot(p);
  const r = await run(p, { action: 'add', names: ['codex'] });
  assert.equal(r.code, 2);
  // .ruler/ 에 스택 폴더(생성물)가 있어 잠금 없는 이 프로젝트는 옛 배치로 보인다 — apply 와 같은 안내
  assert.match(r.err, /예전 배치/);
  assert.deepEqual(snapshot(p), before);
  assert.equal(r.rulerCalls, 0);
});

test('잠금도 .ruler/ 스택 폴더도 없으면 받은 적 없음으로 쓰기 전에 2', async t => {
  const p = fs.realpathSync(tmpDir('guideline-agents-nolock-'));
  t.after(() => fs.rmSync(p, { recursive: true, force: true }));
  runGit(['init', '-q'], p);
  fs.mkdirSync(path.join(p, '.ruler'));
  fs.writeFileSync(path.join(p, 'guideline.json'), '{\n  "version": 3,\n  "form": "ruler",\n  "agents": ["claude"],\n  "sources": {}\n}\n');
  fs.writeFileSync(path.join(p, PROJECT_TOML), TOML);
  const before = snapshot(p);
  const r = await run(p, { action: 'add', names: ['codex'] });
  assert.equal(r.code, 2);
  assert.match(r.err, /guideline pick 먼저/);
  assert.deepEqual(snapshot(p), before);
});
