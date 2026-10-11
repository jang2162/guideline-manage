import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitStackName, stackNameProblem } from '../src/stack-name.js';

test('splitStackName 은 첫 __ 에서 도구와 도메인으로 나눈다', () => {
  assert.deepEqual(splitStackName('deploy-package__gitlab.develma.com'), { tool: 'deploy-package', domain: 'gitlab.develma.com' });
  assert.deepEqual(splitStackName('base'), { tool: 'base', domain: null });
});

test('stackNameProblem 은 __ 뒤가 도메인 모양이 아니거나 __ 가 둘 이상이면 경고한다', () => {
  assert.equal(stackNameProblem('a__b.com'), null);
  assert.equal(stackNameProblem('base'), null);
  assert.match(stackNameProblem('a__b'), /도메인 모양이 아님/);
  assert.match(stackNameProblem('a__b.com__c.com'), /도메인 모양이 아님/);
  assert.match(stackNameProblem('a__B.com'), /도메인 모양이 아님/);
});
