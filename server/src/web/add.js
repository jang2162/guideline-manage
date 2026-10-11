// 목록 화면의 블록 추가: 스택·스킬·서브에이전트·MCP 를 바로 목록에 뜨는 최소 파일까지 한 리비전으로 만든다.
// 카탈로그 규칙은 그대로다. README 만 있는 스택이나 server.json 없는 MCP 는 목록에서 빠지므로 첫 지침 파일·server.json 틀을 함께 만든다.
import { HttpError, readForm, redirect } from '../http.js';
import { WriteError } from '../store.js';
import { checkOrigin, requireAdminWeb } from './auth.js';
import { html } from './layout.js';
import { sendView } from './frame.js';
import { blockHref, TAB } from './blocks.js';
import { TEMPLATES } from './templates.js';
import { t, template } from '../../../cli/src/i18n.js';
import { setFrontmatterValue, categoriesValue } from '../../../cli/src/frontmatter.js';

const KINDS = ['stack', 'skill', 'agent', 'mcp'];
export const NAME = /^[a-z][a-z0-9-]{0,63}$/;
export const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** frontmatter 의 name 줄과 첫 # 제목의 <…> 자리표시를 이름으로 채운다. */
function fillName(text, name) {
  return text.replace(/^name: .*$/m, `name: ${name}`).replace(/^(# [^\n]*?)<[^>\n]+>/m, `$1${name}`);
}

/** 표시 이름과 분류를 frontmatter 에 넣는다. frontmatter 가 없으면 만든다. */
function withMeta(text, { label = '', categories = [] }) {
  const withCats = categories.length ? setFrontmatterValue(text, 'categories', categoriesValue(categories), { raw: true }) : text;
  return label ? setFrontmatterValue(withCats, 'label', label) : withCats;
}

/**
 * 블록 하나를 이루는 처음 파일들.
 * @returns {Record<string, string>} 저장 경로 → 내용
 */
export function blockStarter(kind, name, meta) {
  if (kind === 'stack') {
    return {
      [`rules/${name}/README.md`]: withMeta(fillName(template('new-file/readme.md'), name), meta),
      [`rules/${name}/00-general.md`]: TEMPLATES.always.content,
    };
  }
  if (kind === 'skill') return { [`skills/${name}/SKILL.md`]: withMeta(fillName(template('new-file/skill.md'), name), meta) };
  if (kind === 'agent') return { [`agents/${name}.md`]: withMeta(fillName(template('new-file/agent.md'), name), meta) };
  return {
    [`mcp/${name}/README.md`]: withMeta(fillName(template('new-file/mcp.md'), name), meta),
    [`mcp/${name}/server.json`]: template('new-file/server.json'),
  };
}

function addForm(ctx, kind, { status = 200, error = null, values = {} } = {}) {
  sendView(ctx, status, {
    title: t('web.add.title', { kind: t(`web.add.kind.${kind}`) }),
    tab: TAB[kind],
    body: html`${error ? html`<p class="error">${error}</p>` : ''}
<form method="post" action="/add" class="stack">
<input type="hidden" name="kind" value="${kind}">
<label>${t('web.add.name')} <input name="name" value="${values.name ?? ''}" required pattern="[a-z][a-z0-9\\-]{0,63}"></label>
${kind === 'stack' ? html`<label>${t('web.add.domain')} <input name="domain" value="${values.domain ?? ''}" placeholder="gitlab.example.com"></label>` : ''}
<label>${t('web.add.label')} <input name="label" value="${values.label ?? ''}"></label>
<label>${t('web.add.categories')} <input name="categories" value="${values.categories ?? ''}"></label>
<button>${t('web.add.submit')}</button>
</form>`,
  });
}

/** /add 화면과 처리를 등록한다. 관리자만. */
export function registerAdd(router) {
  router.add('GET', '/add', ctx => {
    if (!requireAdminWeb(ctx)) return;
    const kind = ctx.url.searchParams.get('kind') ?? '';
    if (!KINDS.includes(kind)) throw new HttpError(404, t('web.noBlock'));
    addForm(ctx, kind);
  });
  router.add('POST', '/add', async ctx => {
    if (!requireAdminWeb(ctx)) return;
    checkOrigin(ctx);
    const form = await readForm(ctx.req);
    const kind = form.get('kind') ?? '';
    if (!KINDS.includes(kind)) throw new HttpError(404, t('web.noBlock'));
    const values = { name: (form.get('name') ?? '').trim(), domain: (form.get('domain') ?? '').trim(), categories: (form.get('categories') ?? '').trim(), label: (form.get('label') ?? '').trim() };
    const fail = error => addForm(ctx, kind, { status: 400, error, values });
    if (!NAME.test(values.name)) return fail(t('web.add.badName'));
    if (kind === 'stack' && values.domain && !DOMAIN.test(values.domain)) return fail(t('web.add.badDomain'));
    const name = kind === 'stack' && values.domain ? `${values.name}__${values.domain}` : values.name;
    const categories = values.categories.split(',').map(c => c.trim()).filter(Boolean);
    const files = blockStarter(kind, name, { label: values.label, categories });
    const prefix = kind === 'agent' ? null : `${Object.keys(files)[0].split('/').slice(0, 2).join('/')}/`;
    const taken = [...ctx.store.headHashes().keys()].some(p => (prefix ? p.startsWith(prefix) : p in files));
    if (taken) return fail(t('web.add.exists'));
    try {
      ctx.store.commit({
        author: 'admin', source: 'web', message: t('web.add.message', { name }),
        changes: files, base: Object.fromEntries(Object.keys(files).map(p => [p, null])),
      });
    } catch (e) {
      if (e instanceof WriteError) return fail(e.problems.map(x => x.message).join('\n'));
      throw e;
    }
    redirect(ctx.res, blockHref(kind, name));
  });
}
