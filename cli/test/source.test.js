import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startApp, META } from '../../server/test/helpers.js';
import { tmpDir, write, read, exists, collect } from './helpers.js';
import { SOURCE } from './render-fixture.js';
import { sha256 } from '../src/hashes.js';
import { source, SOURCE_MARK } from '../src/commands/source.js';
import { propose } from '../src/commands/propose.js';
import { listFromServer } from '../src/commands/list.js';

async function setup(t) {
  const s = await startApp(t);
  s.store.commit({ ...META, source: 'web', changes: SOURCE });
  const token = s.tokens.issue({ name: 'cli-p', scope: 'propose' }).token;
  const work = tmpDir('guideline-src-');
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  return { s, env: { GUIDELINE_TOKEN: token, GUIDELINE_SERVER: s.base }, folder: path.join(work, 'src') };
}
// 명령은 cwd 의 guideline.json 에서 서버를 찾는다. 이 저장소 루트에도 guideline.json 이 있으므로 빈 폴더를 cwd 로 준다.
const NEUTRAL = tmpDir('guideline-cwd-');
process.on('exit', () => fs.rmSync(NEUTRAL, { recursive: true, force: true }));
const cap = async (fn, opts) => {
  const o = collect();
  const e = collect();
  const code = await fn({ out: o.out, err: e.out, cwd: NEUTRAL, ...opts });
  return { code, out: o.text(), err: e.text() };
};

test('source 는 최신 원본을 풀고 받은 리비전을 적는다. 비어 있지 않은 폴더는 2', async t => {
  const { s, env, folder } = await setup(t);
  const r = await cap(source, { dir: folder, env });
  assert.equal(r.code, 0, r.err);
  assert.equal(read(folder, 'rules/base/00-a.md'), SOURCE['rules/base/00-a.md']);
  assert.deepEqual([...fs.readFileSync(path.join(folder, 'skills/s/img/a.png'))], [1, 2, 3]);
  assert.deepEqual(JSON.parse(read(folder, SOURCE_MARK)), { server: s.base, revision: 1 });
  assert.equal((await cap(source, { dir: folder, env })).code, 2);
});

test('propose --from 은 받은 리비전과 비교해 더함·바뀜·지움을 올리고 점 파일은 뺀다', async t => {
  const { s, env, folder } = await setup(t);
  await cap(source, { dir: folder, env });
  write(folder, 'rules/base/02-new.md', '---\nload: always\n---\n\n# 새\n');
  write(folder, 'rules/base/01-b.md', SOURCE['rules/base/01-b.md'].replace('본문 B', '고친 B'));
  fs.rmSync(path.join(folder, 'agents/rev.md'));
  write(folder, '.DS_Store', 'x');
  write(folder, 'rules/.hidden.md', 'x');
  assert.equal((await cap(propose, { from: folder, env })).code, 2);
  const r = await cap(propose, { from: folder, env, title: '새 지침' });
  assert.equal(r.code, 0, r.err);
  const p = s.proposals.get(1);
  assert.deepEqual(p.changes.map(c => [c.path, c.content === null ? null : c.content.toString(), c.base]), [
    ['agents/rev.md', null, sha256(Buffer.from(SOURCE['agents/rev.md']))],
    ['rules/base/01-b.md', SOURCE['rules/base/01-b.md'].replace('본문 B', '고친 B'), sha256(Buffer.from(SOURCE['rules/base/01-b.md']))],
    ['rules/base/02-new.md', '---\nload: always\n---\n\n# 새\n', null],
  ]);
  assert.equal(p.project, null);
});

test('propose --from --dry-run 은 제목 없이도 변경을 보이고 보내지 않는다', async t => {
  const { s, env, folder } = await setup(t);
  await cap(source, { dir: folder, env });
  write(folder, 'rules/base/02-new.md', '---\nload: always\n---\n\n# 새\n');
  const r = await cap(propose, { from: folder, env, dryRun: true });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /더함 {2}rules\/base\/02-new\.md/);
  assert.equal(s.proposals.list({}).length, 0);
});

test('propose --from 도 admin 토큰이면 바로 반영하고, --review 면 제안한다', async t => {
  const { s, env, folder } = await setup(t);
  const admin = { ...env, GUIDELINE_TOKEN: s.tokens.issue({ name: 'cli-a', scope: 'admin' }).token };
  await cap(source, { dir: folder, env: admin });
  write(folder, 'rules/base/02-new.md', '---\nload: always\n---\n\n# 새\n');
  const reviewed = await cap(propose, { from: folder, env: admin, title: '검토', review: true });
  assert.equal(reviewed.code, 0, reviewed.err);
  assert.equal(s.proposals.list({ status: 'pending' }).length, 1);
  assert.equal(s.store.headRevision(), 1);
  const r = await cap(propose, { from: folder, env: admin, title: '바로' });
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /반영 완료: r2 — /);
  assert.match(r.out, /admin 토큰이라 검토 없이 바로 반영함/);
  assert.equal(s.store.headRevision(), 2);
});

test('propose --from 은 표지 파일이 없으면 2', async t => {
  const { env, folder } = await setup(t);
  fs.mkdirSync(folder, { recursive: true });
  const r = await cap(propose, { from: folder, env, title: 'x' });
  assert.equal(r.code, 2);
  assert.match(r.err, /guideline source 로 받은 폴더가 아님/);
});

test('listFromServer 는 서버 원본의 목록을 보인다', async t => {
  const { env } = await setup(t);
  const r = await cap(listFromServer, { env, json: true });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out).stacks.map(x => x.name), ['base', 'deploy-agent__deploy.kbrainc.dev']);
  assert.ok(exists);
});
