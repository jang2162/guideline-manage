import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createStore, sha256, WriteError } from '../src/store.js';
import { createProposals, ProposalError } from '../src/proposals.js';
import { clock, META } from './helpers.js';

function setup() {
  const db = openDb(':memory:');
  const now = clock();
  const store = createStore(db, { now });
  store.commit({ ...META, source: 'web', changes: { 'rules/base/00-a.md': 'a\nb\nc\nd\ne\n', 'skills/s/x.png': Buffer.from([0, 1, 2]) } });
  const proposals = createProposals(db, store, { now });
  return { db, store, proposals };
}
const h = s => sha256(Buffer.from(s));
const input = (changes, extra = {}) => ({ title: '제목', tokenId: null, author: 'admin', changes, ...extra });

test('create 는 제안을 저장하고 get·list·pendingCount 가 돌려준다', () => {
  const { proposals } = setup();
  const id = proposals.create(input([{ path: 'rules/base/00-a.md', content: Buffer.from('a\nB\nc\nd\ne\n'), base: h('a\nb\nc\nd\ne\n') }], { project: 'p' }));
  const p = proposals.get(id);
  assert.equal(p.status, 'pending');
  assert.equal(p.project, 'p');
  assert.equal(p.changes[0].content.toString(), 'a\nB\nc\nd\ne\n');
  assert.equal(proposals.pendingCount(), 1);
  assert.deepEqual(proposals.list({}).map(x => [x.id, x.changeCount]), [[id, 1]]);
  assert.equal(proposals.get(999), null);
});

test('create 는 틀린 입력을 400 으로 거부한다', () => {
  const { proposals } = setup();
  const same = [{ path: 'rules/base/00-a.md', content: Buffer.from('a\nb\nc\nd\ne\n'), base: h('a\nb\nc\nd\ne\n') }];
  const err = (fn, re) => assert.throws(fn, e => e instanceof ProposalError && e.status === 400 && re.test(e.message));
  err(() => proposals.create(input(same)), /바뀐 것 없음/);
  err(() => proposals.create(input([])), /변경 없음/);
  err(() => proposals.create(input(same, { title: '' })), /제목/);
  err(() => proposals.create(input([{ path: '../x.md', content: Buffer.from('x'), base: null }])), /\.\./);
  err(() => proposals.create(input([{ path: 'rules/a.md', content: Buffer.from([0xff]), base: null }])), /UTF-8/);
  err(() => proposals.create(input([
    { path: 'rules/b.md', content: Buffer.from('x'), base: null },
    { path: 'rules/b.md', content: Buffer.from('y'), base: null },
  ])), /두 번/);
});

test('accept: 기준이 그대로면 제안대로, 원본이 바뀌었으면 합쳐서 리비전 하나', () => {
  const { store, proposals } = setup();
  const id = proposals.create(input([
    { path: 'rules/base/00-a.md', content: Buffer.from('a\nb\nc\nD\ne\n'), base: h('a\nb\nc\nd\ne\n') },
    { path: 'rules/base/01-new.md', content: Buffer.from('new\n'), base: null },
  ], { author: 'cli-x' }));
  store.commit({ ...META, changes: { 'rules/base/00-a.md': 'A\nb\nc\nd\ne\n' } });
  assert.equal(proposals.plan(proposals.get(id).changes).files[0].result, 'merged');
  const rev = proposals.accept(id);
  assert.equal(store.fileAt('rules/base/00-a.md', rev).toString(), 'A\nb\nc\nD\ne\n');
  assert.equal(store.fileAt('rules/base/01-new.md', rev).toString(), 'new\n');
  const info = store.revision(rev);
  assert.equal(info.source, 'proposal');
  assert.equal(info.author, 'cli-x');
  assert.equal(info.message, `제안 #${id}: 제목`);
  const p = proposals.get(id);
  assert.equal(p.status, 'accepted');
  assert.equal(p.revisionId, rev);
  assert.throws(() => proposals.accept(id), e => e.status === 409 && /이미 끝난 제안/.test(e.message));
});

test('충돌이 하나라도 있으면 수락하지 않고 409 와 충돌 목록을 낸다', () => {
  const { store, proposals } = setup();
  const id = proposals.create(input([
    { path: 'rules/base/00-a.md', content: Buffer.from('a\nb\nT\nd\ne\n'), base: h('a\nb\nc\nd\ne\n') },
    { path: 'rules/base/02-ok.md', content: Buffer.from('ok\n'), base: null },
  ]));
  store.commit({ ...META, changes: { 'rules/base/00-a.md': 'a\nb\nO\nd\ne\n' } });
  const head = store.headRevision();
  assert.throws(() => proposals.accept(id), e => e.status === 409 && e.extra.conflicts[0].path === 'rules/base/00-a.md');
  assert.equal(store.headRevision(), head);
  assert.equal(proposals.get(id).status, 'pending');
  const f = proposals.plan(proposals.get(id).changes).files[0];
  assert.equal(f.result, 'conflict');
  assert.match(f.conflictText, /<<<<<<< 원본/);
});

test('plan 의 충돌 경우: 바이너리, 삭제 대 수정, 새 파일인데 이미 있음, 원본에서 지워짐', () => {
  const { store, proposals } = setup();
  store.commit({ ...META, changes: { 'skills/s/x.png': Buffer.from([9]), 'rules/base/03-has.md': 'has\n' } });
  const { conflicts } = proposals.plan([
    { path: 'skills/s/x.png', content: Buffer.from([7]), base: sha256(Buffer.from([0, 1, 2])) },
    { path: 'rules/base/00-a.md', content: null, base: h('old\n') },
    { path: 'rules/base/03-has.md', content: Buffer.from('mine\n'), base: null },
  ]);
  assert.deepEqual(conflicts.map(c => c.path), ['skills/s/x.png', 'rules/base/00-a.md', 'rules/base/03-has.md']);
  store.commit({ ...META, changes: { 'rules/base/03-has.md': null } });
  assert.equal(proposals.plan([{ path: 'rules/base/03-has.md', content: Buffer.from('x\n'), base: h('has\n') }]).conflicts.length, 1);
});

test('이미 원본과 같은 변경만 남으면 리비전 없이 수락된다', () => {
  const { store, proposals } = setup();
  const id = proposals.create(input([{ path: 'rules/base/00-a.md', content: Buffer.from('z\n'), base: h('a\nb\nc\nd\ne\n') }]));
  store.commit({ ...META, changes: { 'rules/base/00-a.md': 'z\n' } });
  assert.equal(proposals.accept(id), null);
  assert.equal(proposals.get(id).status, 'accepted');
});

test('수락 직전에 다른 저장이 끼면 409 「다시 시도한다」 이고 제안은 대기로 남는다', () => {
  const { store, proposals } = setup();
  const id = proposals.create(input([{ path: 'rules/base/00-a.md', content: Buffer.from('q\n'), base: h('a\nb\nc\nd\ne\n') }]));
  const commit = store.commit;
  store.commit = arg => {
    store.commit = commit;
    commit({ ...META, changes: { 'rules/base/00-a.md': 'race\n' } });
    return commit(arg);
  };
  assert.throws(() => proposals.accept(id), e => e.status === 409 && /다시 시도/.test(e.message));
  assert.equal(proposals.get(id).status, 'pending');
});

test('reject·setChange·dropChange 는 대기 중에만 된다', () => {
  const { store, proposals } = setup();
  const id = proposals.create(input([
    { path: 'rules/base/00-a.md', content: Buffer.from('x\n'), base: h('a\nb\nc\nd\ne\n') },
    { path: 'rules/base/05-y.md', content: Buffer.from('y\n'), base: null },
  ]));
  store.commit({ ...META, changes: { 'rules/base/00-a.md': 'moved\n' } });
  proposals.setChange(id, 'rules/base/00-a.md', Buffer.from('fixed\n'));
  const c = proposals.get(id).changes.find(x => x.path === 'rules/base/00-a.md');
  assert.equal(c.content.toString(), 'fixed\n');
  assert.equal(c.base, h('moved\n'));
  proposals.dropChange(id, 'rules/base/05-y.md');
  assert.equal(proposals.get(id).changes.length, 1);
  assert.throws(() => proposals.dropChange(id, 'rules/base/00-a.md'), e => e.status === 400);
  assert.throws(() => proposals.setChange(id, 'rules/none.md', Buffer.from('x')), e => e.status === 404);
  proposals.reject(id, '안 맞음');
  assert.equal(proposals.get(id).status, 'rejected');
  assert.equal(proposals.get(id).note, '안 맞음');
  assert.throws(() => proposals.setChange(id, 'rules/base/00-a.md', Buffer.from('z')), e => e.status === 409);
});

test('submit(apply) 는 충돌이면 저장하지 않고, 아니면 바로 수락한다', () => {
  const { store, proposals } = setup();
  store.commit({ ...META, changes: { 'rules/base/00-a.md': 'O\n' } });
  assert.throws(() => proposals.submit(input([{ path: 'rules/base/00-a.md', content: Buffer.from('T\n'), base: h('a\nb\nc\nd\ne\n') }]), { apply: true }),
    e => e.status === 409);
  assert.equal(proposals.list({}).length, 0);
  const r = proposals.submit(input([{ path: 'rules/base/06-z.md', content: Buffer.from('z\n'), base: null }]), { apply: true });
  assert.equal(r.status, 'accepted');
  assert.equal(store.fileAt('rules/base/06-z.md', r.revision).toString(), 'z\n');
  const plain = proposals.submit(input([{ path: 'rules/base/07-w.md', content: Buffer.from('w\n'), base: null }]), { apply: false });
  assert.deepEqual([plain.status, plain.revision], ['pending', null]);
});

test('list 는 상태와 토큰으로 거른다', () => {
  const { proposals } = setup();
  const a = proposals.create(input([{ path: 'rules/x1.md', content: Buffer.from('1'), base: null }], { tokenId: 7 }));
  const b = proposals.create(input([{ path: 'rules/x2.md', content: Buffer.from('2'), base: null }]));
  proposals.reject(b, '');
  assert.deepEqual(proposals.list({ tokenId: 7 }).map(x => x.id), [a]);
  assert.deepEqual(proposals.list({ status: 'rejected' }).map(x => x.id), [b]);
  assert.deepEqual(proposals.list({}).map(x => x.id), [b, a]);
});

test('submit(apply) 가 쓰기 검사에 걸리면 400 이고 제안을 남기지 않는다', () => {
  const { proposals } = setup();
  assert.throws(() => proposals.submit(input([{ path: 'rules/base/00-a.md/x.md', content: Buffer.from('x\n'), base: null }]), { apply: true }),
    WriteError);
  assert.equal(proposals.list({}).length, 0);
});
