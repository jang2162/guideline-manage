// 문서 화면: docs/<이름>.md 를 사람이 읽고 관리하는 곳. 프로젝트로 보내지 않는다(cli/src/sources.js).
// 작성 규칙과 관리 지침 추가분은 에이전트도 읽는 문서라 따로 묶고, 웹에서 이름 바꾸기·삭제를 막는다(edit.js).
import { HttpError } from '../http.js';
import { isAdmin, requireReadWeb } from './auth.js';
import { html } from './layout.js';
import { sendView } from './frame.js';
import { docHref, PROTECTED_DOCS } from './blocks.js';
import { fileView } from './browse.js';
import { DOC_PATH } from '../../../cli/src/store-paths.js';
import { t } from '../../../cli/src/i18n.js';

/** 문서의 첫 `# 제목`. 없으면 파일 이름. */
function titleOf(store, p) {
  const text = store.fileAt(p)?.toString('utf8') ?? '';
  const m = /^# +(.+?)\s*#*\s*$/m.exec(text);
  return m ? m[1] : p.slice('docs/'.length);
}

function docsPage(ctx) {
  const name = (ctx.params.name ?? '').normalize('NFC');
  const all = [...ctx.store.headHashes().keys()].filter(p => DOC_PATH.test(p)).sort();
  const plain = all.filter(p => !PROTECTED_DOCS.includes(p));
  const agents = all.filter(p => PROTECTED_DOCS.includes(p));
  const current = name ? `docs/${name}` : (plain[0] ?? agents[0] ?? null);
  if (current !== null && !all.includes(current)) throw new HttpError(404, t('api.noFile'));
  const item = p => html`<li><a class="${p === current ? 'blk on' : 'blk'}" href="${docHref(p)}"${p === current ? html` aria-current="page"` : ''}><b>${titleOf(ctx.store, p)}</b><span>${p}</span></a></li>
`;
  const left = html`<ul class="side-list">${plain.map(item)}</ul>
${agents.length ? html`<p class="side-group">${t('web.docs.forAgents')}</p><ul class="side-list">${agents.map(item)}</ul>` : ''}
${isAdmin(ctx) ? html`<a class="card add" href="/new?dir=docs"><span class="card-t"><b>${t('web.docs.add')}</b></span></a>` : ''}`;
  const view = current ? fileView(ctx, current) : null;
  sendView(ctx, 200, {
    title: current ? `${t('web.tab.docs')} · ${titleOf(ctx.store, current)}` : t('web.tab.docs'),
    h1: current ? titleOf(ctx.store, current) : t('web.tab.docs'),
    tab: 'docs',
    actions: view?.actions ?? null,
    detail: { left, right: null },
    body: view ? view.body : html`<p class="meta">${t('web.noneYet')}</p>`,
  });
}

/** /docs 를 등록한다. 보기는 PUBLIC_READ 를 따른다. */
export function registerDocs(router) {
  router.add('GET', '/docs', ctx => {
    if (requireReadWeb(ctx)) docsPage(ctx);
  });
  router.add('GET', '/docs/:name', ctx => {
    if (requireReadWeb(ctx)) docsPage(ctx);
  });
}
