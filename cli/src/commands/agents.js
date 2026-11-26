import fs from 'node:fs';
import path from 'node:path';
import { expandPath, runGit } from '../projects.js';
import { MANIFEST, AGENTS, manifestText } from '../manifest.js';
import { PROJECT_TOML, layoutOf } from '../layout.js';
import { unitInfo } from '../unit.js';
import { writeFileAtomic } from '../apply.js';
import { readDefaultAgents, setDefaultAgents, agentsMismatch, rulerAgentsSource } from '../agents.js';
import { projectApply } from './project-apply.js';
import { defaultRunRuler, openProject } from './sync-common.js';
import { t } from '../i18n.js';

const tomlFile = dir => path.join(dir, ...PROJECT_TOML.split('/'));
const sameSet = (a, b) => !agentsMismatch(a, b);

/**
 * guideline agents: 이 단위의 코딩 에이전트를 보이고(action 없음), 더하고(add), 뺀다(remove). guideline.json 의 agents 와
 * .ruler/ruler.project.toml 의 default_agents 를 함께 고친 뒤 apply 와 같은 조합·ruler 를 돈다. 서버에 접속하지 않는다.
 * 하위 단위(모노레포)에 자기 ruler.project.toml 이 없으면 ruler 는 git 루트의 default_agents 를 따른다(pick 과 같은 규칙): 보일 때는 루트의
 * 것을 보이고, 바꿀 때는 그 단위의 guideline.json 만 바꾼다(루트의 파일은 건드리지 않는다).
 * 0 완료·바뀐 것 없음, 1 매니페스트를 읽을 수 없음·반영 실패, 2 인자·이름 문제, 받은 적 없음·옛 배치(apply 가 열지 못함), default_agents 를 한 줄로
 * 읽을 수 없음. 2 와 쓰기 전의 1 은 아무것도 쓰지 않는다.
 * @returns {Promise<number>}
 */
export async function agents({
  action, names = [], project, json = false, env = process.env, out = console.log, err = console.error, cwd = process.cwd(),
  runRuler = defaultRunRuler, git = runGit,
}) {
  const dir = project !== undefined ? expandPath(project) : cwd;
  if (action !== undefined && action !== 'add' && action !== 'remove') {
    err(t('agents.unknownAction', { action }));
    return 2;
  }
  if (!fs.existsSync(path.join(dir, MANIFEST))) {
    err(t('update.notYet'));
    return 2;
  }
  // apply 가 열지 못할 프로젝트(깨진 매니페스트, 잠금 없음, 옛 배치)는 쓰기 전에 멈춘다 — 쓰고 나서 apply 가 실패하면 두 파일만 바뀐 채 남는다
  const opened = openProject({ dir, err });
  if (opened.code !== undefined) return opened.code;
  const { manifest, lock } = opened;
  const layout = layoutOf(lock, dir);
  if (action !== undefined && layout !== 'guideline') {
    err(layout === 'ruler' ? t('apply.needsUpdate') : t('update.notYet'));
    return 2;
  }
  const unit = unitInfo(dir, git);
  const { own, follows, file: rulerFile, text: rulerText } = rulerAgentsSource(dir, unit);
  const ruler = readDefaultAgents(rulerText);

  if (action === undefined) return show({ manifest, ruler, rulerText, rulerFile, follows, json, out });

  if (!names.length) {
    err(t('agents.namesMissing'));
    return 2;
  }
  const unknown = [...new Set(names.filter(n => !AGENTS.includes(n)))];
  if (unknown.length) {
    err(t('agents.unknown', { names: unknown.join(', '), allowed: AGENTS.join(', ') }));
    return 2;
  }
  const current = manifest.agents;
  const next = action === 'add'
    ? [...new Set([...current, ...names])].sort()
    : current.filter(a => !names.includes(a)).sort();
  if (!next.length) {
    err(t('agents.lastOne', { names: [...new Set(names)].join(', ') }));
    return 2;
  }
  // 이 단위가 쓰는 toml 은 자기 것뿐이다(루트의 것은 그 단위에서 guideline agents 로 바꾼다)
  let nextToml = null;
  if (own !== null) {
    const mine = readDefaultAgents(own);
    if (mine.ok && mine.agents && sameSet(next, mine.agents) && sameSet(next, current)) return unchanged({ next, json, out });
    nextToml = setDefaultAgents(own, next);
    if (nextToml === null) {
      err(t('agents.tomlUnreadable', { file: PROJECT_TOML }));
      return 2;
    }
  } else if (sameSet(next, current)) {
    return unchanged({ next, json, out });
  }

  writeFileAtomic(path.join(dir, MANIFEST), manifestText({ ...manifest, agents: next }));
  if (nextToml !== null && nextToml !== own) writeFileAtomic(tomlFile(dir), nextToml);
  if (follows) err(t('agents.followsRoot', { file: PROJECT_TOML, root: follows }));
  return projectApply({ dir, json, env, out, err, runRuler, git });
}

function unchanged({ next, json, out }) {
  if (json) out(JSON.stringify({ changed: false, agents: next }, null, 2));
  else out(t('agents.unchanged', { agents: next.join(', ') }));
  return 0;
}

function show({ manifest, ruler, rulerText, rulerFile, follows, json, out }) {
  const mismatch = agentsMismatch(manifest.agents, ruler.agents);
  if (json) {
    out(JSON.stringify({ agents: manifest.agents, rulerAgents: ruler.agents, mismatch }, null, 2));
    return 0;
  }
  out(t('agents.showManifest', { agents: manifest.agents.join(', ') }));
  const file = follows ? rulerFile : PROJECT_TOML;
  if (rulerText === null) out(t('agents.showNoToml', { file }));
  else if (!ruler.ok) out(t('agents.showUnreadable', { file }));
  else if (ruler.agents === null) out(t('agents.showNoLine', { file }));
  else out(t('agents.showRuler', { file, agents: ruler.agents.join(', ') }));
  if (follows) out(t('agents.showFollowsRoot', { root: follows }));
  if (mismatch) out(t('agents.mismatch'));
  return 0;
}
