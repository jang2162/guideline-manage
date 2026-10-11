import { HttpError, readJson, redirect, sendJson, parseCookies } from '../http.js';
import { checkOrigin } from './auth.js';
import { html, sendPage } from './layout.js';
import { dbTree } from '../db-tree.js';
import { catalogView } from '../../../cli/src/catalog-view.js';
import { buildSelection } from '../../../cli/src/selection.js';
import { t } from '../../../cli/src/i18n.js';

const COOKIE = 'gf';
const AGENTS = ['claude', 'codex'];
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 쿠키의 링크 토큰으로 폼을 찾는다. 없거나 틀리면 404. */
function formOf(ctx) {
  const f = ctx.forms.checkLink(ctx.params.id, parseCookies(ctx.req.headers.cookie)[COOKIE]);
  if (!f) throw new HttpError(404, t('web.form.badLink'));
  return f;
}

function pendingOf(ctx) {
  const f = formOf(ctx);
  if (f.status !== 'pending') throw new HttpError(409, t('web.form.closed'));
  return f;
}

const needsForm = p => p.isNew === true;

function chosenOf(body) {
  const agents = body?.chosen?.agents;
  if (!Array.isArray(agents) || agents.length === 0 || !agents.every(a => AGENTS.includes(a))) throw new HttpError(400, t('web.form.needAgent'));
  return { form: 'ruler', agents: [...new Set(agents)] };
}

function subtitle(p) {
  return `${p.path} · ${p.isNew ? t('web.form.newProject') : p.nested ? t('web.form.nested') : 'ruler'}`;
}

function formBody(f) {
  const p = f.payload.project;
  return html`<div id="form-app" data-id="${f.id}" data-status="${f.status}">
<p class="meta" id="subtitle">${subtitle(p)}</p>
<p class="error" id="error" hidden></p>
<section id="choose" class="choose" hidden>
<div class="field">${t('web.form.agents')}
<label><input type="checkbox" name="agent" value="claude" checked> claude</label>
<label><input type="checkbox" name="agent" value="codex" checked> codex</label>
</div>
</section>
<section id="dirty" class="warn" hidden>
<p>${p.gitRepo ? t('web.form.dirty') : t('web.form.notGit')} ${t('web.form.mayMix')}</p>
<label><input type="checkbox" id="force"> ${t('web.form.force')}</label>
</section>
<section id="checklist">
<div class="toolbar"><span class="meta">${t('web.form.byCategory')}</span><div id="chips" class="chips"></div><button type="button" class="secondary" id="reset">${t('web.form.reset')}</button></div>
<div id="list"></div>
</section>
<section id="finished" hidden><p id="finished-text"></p></section>
</div>
<footer id="bar" class="form-bar">
<span id="summary"></span>
<button type="button" class="secondary" data-cancel>${t('web.cancel')}</button>
<button type="button" id="submit">${t('web.form.submit')}</button>
</footer>
<dialog id="diff"><form method="dialog"><header><b id="diff-title"></b><button class="secondary">${t('web.close')}</button></header><div id="diff-body"></div></form></dialog>`;
}

/** /forms/* 를 등록한다. 링크 토큰(쿠키)이 권한이다. 관리자 세션은 필요 없다. */
export function registerForms(router) {
  router.add('GET', '/forms/:id', ctx => {
    const k = ctx.url.searchParams.get('k');
    if (k !== null) {
      const f = ctx.forms.checkLink(ctx.params.id, k);
      if (!f) throw new HttpError(404, t('web.form.badLink'));
      if (f.status === 'pending') ctx.forms.open(f.id);
      const secure = ctx.config.publicUrl.protocol === 'https:' ? '; Secure' : '';
      const at = `/forms/${encodeURIComponent(f.id)}`;
      redirect(ctx.res, at, { 'Set-Cookie': `${COOKIE}=${encodeURIComponent(k)}; Path=${at}; HttpOnly; SameSite=Strict${secure}` });
      return;
    }
    const f = formOf(ctx);
    sendPage(ctx.res, 200, { title: t('web.form.title'), nav: false, wide: true, scripts: ['/static/forms.js'], body: formBody(f) });
  });

  router.add('GET', '/forms/:id/data', ctx => {
    const f = formOf(ctx);
    sendJson(ctx.res, 200, {
      status: f.status,
      project: f.payload.project,
      items: f.payload.items,
      overrides: f.payload.overrides,
      // 에이전트가 고른 블록(가상 이름 → 이유). 옛 CLI 의 폼에는 없다.
      recommend: f.payload.recommend ?? {},
      // CLI 가 별칭을 입힌 원본의 목록을 실어 보내면 그것을 쓴다(여러 출처)
      catalog: f.payload.catalog ?? catalogView(dbTree(ctx.store, f.revision)),
    }, { 'Cache-Control': 'no-store' });
  });

  router.add('GET', '/forms/:id/diff', ctx => {
    const f = formOf(ctx);
    const key = ctx.url.searchParams.get('key') ?? '';
    sendJson(ctx.res, 200, (isObj(f.payload.diffs) && f.payload.diffs[key]) || { files: [] }, { 'Cache-Control': 'no-store' });
  });

  router.add('POST', '/forms/:id/ping', async ctx => {
    checkOrigin(ctx);
    await readJson(ctx.req);
    ctx.forms.ping(pendingOf(ctx).id);
    sendJson(ctx.res, 200, { ok: true });
  });

  router.add('POST', '/forms/:id/submit', async ctx => {
    checkOrigin(ctx);
    const body = await readJson(ctx.req);
    const f = pendingOf(ctx);
    const p = f.payload.project;
    if (!p.isNew && (!p.gitRepo || p.dirty) && body?.force !== true) {
      throw new HttpError(400, t('web.form.needForce'));
    }
    const project = needsForm(p) ? chosenOf(body) : null;
    const selection = buildSelection({ revision: f.revision, items: f.payload.items, choices: isObj(body?.choices) ? body.choices : {}, project });
    if (!ctx.forms.finish(f.id, 'submitted', selection)) throw new HttpError(409, t('web.form.closed'));
    sendJson(ctx.res, 200, { ok: true });
  });

  router.add('POST', '/forms/:id/cancel', async ctx => {
    checkOrigin(ctx);
    await readJson(ctx.req);
    if (!ctx.forms.finish(pendingOf(ctx).id, 'cancelled')) throw new HttpError(409, t('web.form.closed'));
    sendJson(ctx.res, 200, { ok: true });
  });
}
