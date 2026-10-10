import { asTree, joinPath, readText } from './tree.js';
import { t } from './i18n.js';
import { BUILD_SECTIONS, marker } from './markers.js';

const NAME = '[A-Za-z_][A-Za-z0-9_]*';
const REF = new RegExp(`\\$\\{(${NAME})\\}`, 'g');
const WHOLE_REF = new RegExp(`^\\$\\{${NAME}\\}$`);
const BEARER_REF = new RegExp(`^Bearer \\$\\{${NAME}\\}$`);

function isObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 객체면 항목들, 아니면 빈 배열. */
function entries(v) {
  return isObject(v) ? Object.entries(v) : [];
}

function hasRef(v) {
  return typeof v === 'string' && v.includes('${');
}

/** MCP README 의 항목 만들기 절 제목. 영어가 정본이고 한국어도 읽는다. */
export { BUILD_SECTIONS };
/** 한국어 제목(이전 이름). */
export const BUILD_SECTION = BUILD_SECTIONS[1];

/**
 * README.md 의 `## 반영할 때 항목 만들기` 절 본문. 하위 절(`###`)은 본문에 든다.
 * @param {import('./tree.js').Tree} tree
 * @param {string} dir mcp/<이름> 의 트리 안 경로('' 는 트리 루트)
 * @returns {string | null} 절이 없으면 null, 비었으면 ''
 */
function buildSection(tree, dir) {
  const text = readText(tree, joinPath(dir, 'README.md'));
  if (text === null) return null;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(l => BUILD_SECTIONS.some(h => l.trimEnd() === `## ${h}`));
  if (start === -1) return null;
  const body = lines.slice(start + 1);
  const end = body.findIndex(l => /^#{1,2} /.test(l));
  return body.slice(0, end === -1 ? body.length : end).join('\n').trim();
}

/**
 * mcp/<이름>/ 을 목록에 넣을 수 있는지 판정한다.
 * server.json 이 없고 README.md 에 「반영할 때 항목 만들기」 절이 있으면 반영할 때 만드는 서버(build)다.
 * server.json 과 그 절이 함께 있으면 server.json 으로 판정하고 ambiguous 를 붙인다.
 * @param {string | import('./tree.js').Tree} src mcp/<이름>/ 의 디스크 경로, 또는 문서 저장소 트리
 * @param {string} [dir] src 가 트리일 때 mcp/<이름> 의 상대 경로. src 가 그 디렉터리의 디스크 경로면 생략한다
 * @returns {({ server: object } | { build: true } | { reason: string }) & { ambiguous?: true }}
 */
export function readServer(src, dir = '') {
  const tree = asTree(src);
  const section = buildSection(tree, dir);
  if (!tree.exists(joinPath(dir, 'server.json'))) {
    if (section) return { build: true };
    if (section === '') return { reason: t('mcp.emptyBuild', { section: marker('buildSection') }) };
    return { reason: t('mcp.noServerJson') };
  }
  const result = readServerJson(tree, dir);
  return section === null ? result : { ...result, ambiguous: true };
}

/** server.json 을 읽어 형식을 검사한다. */
function readServerJson(tree, dir) {
  let server;
  try {
    server = JSON.parse(readText(tree, joinPath(dir, 'server.json')));
  } catch {
    return { reason: t('mcp.badServerJson') };
  }
  if (!isObject(server)) return { reason: t('mcp.badServerJson') };
  const nonEmpty = v => typeof v === 'string' && v !== '';
  const ok = (server.type === 'stdio' && nonEmpty(server.command)) || (server.type === 'http' && nonEmpty(server.url));
  if (!ok) return { reason: t('mcp.badType') };
  const shapeOk = (!('env' in server) || isObject(server.env))
    && (!('headers' in server) || isObject(server.headers))
    && (!('args' in server) || (Array.isArray(server.args) && server.args.every(a => typeof a === 'string')));
  if (!shapeOk) return { reason: t('mcp.badShape') };
  return { server };
}

/**
 * env·headers 값에서 `${이름}` 으로 참조하는 환경 변수 이름. 정렬하고 중복을 없앤다.
 * @param {object} server
 * @returns {string[]}
 */
export function envVars(server) {
  const names = new Set();
  for (const [, v] of [...entries(server.env), ...entries(server.headers)]) {
    if (typeof v !== 'string') continue;
    for (const m of v.matchAll(REF)) names.add(m[1]);
  }
  return [...names].sort();
}

/**
 * 비밀값이 박혔거나 Codex 로 옮길 수 없는 참조를 찾는다. env, headers, command, args, url 순서로 낸다.
 * @param {object} server readServer 가 돌려준 server
 * @returns {string[]}
 */
export function serverWarnings(server) {
  const warnings = [];
  for (const [key, v] of entries(server.env)) {
    if (!hasRef(v)) warnings.push(t('mcp.envNotRef', { key }));
    else if (v !== `\${${key}}`) warnings.push(t('mcp.envSelfRef', { key }));
  }
  for (const [key, v] of entries(server.headers)) {
    if (!hasRef(v)) warnings.push(t('mcp.headerNotRef', { key }));
    else if (!WHOLE_REF.test(v) && !(key.toLowerCase() === 'authorization' && BEARER_REF.test(v))) {
      warnings.push(t('mcp.headerCodex', { key }));
    }
  }
  if (hasRef(server.command)) warnings.push(t('mcp.refInCommand'));
  if (Array.isArray(server.args) && server.args.some(hasRef)) warnings.push(t('mcp.refInArgs'));
  if (hasRef(server.url)) warnings.push(t('mcp.refInUrl'));
  return warnings;
}
