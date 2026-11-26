import { HttpError, readJson, redirect, sendJson, parseCookies } from '../http.js';
import { checkOrigin } from './auth.js';
import { html, sendPage } from './layout.js';
import { dbTree } from '../db-tree.js';
import { catalogView } from '../../../cli/src/catalog-view.js';
import { buildSelection, personalSelection, PERSONAL_CHOICES } from '../../../cli/src/selection.js';
import { isBlockKey } from '../../../cli/src/blocks.js';
import { t } from '../../../cli/src/i18n.js';

const COOKIE = 'gf';
const AGENTS = ['claude', 'codex', 'opencode'];
const isObj = v => typeof v === 'object' && v !== null && !Array.isArray(v);
// 폼 단계. 브라우저(forms.js)의 STEPS 와 같다.
const STEPS = ['rules', 'mcp', 'agents', 'skills', 'confirm'];

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

/** 개인 폼의 블록별 선택. 블록 키가 아니거나 모르는 값은 버린다(그대로 = 'keep'). */
function personalChoicesOf(body) {
  const raw = isObj(body?.personalChoices) ? body.personalChoices : {};
  return Object.fromEntries(Object.entries(raw).filter(([k, v]) => isBlockKey(k) && PERSONAL_CHOICES.includes(v)));
}

/**
 * 화면에 넘기는 개인 모드 재료. payload 에 다른 필드가 있어도 이것만(허용 목록). role 은 고르는 역할(pick --local --role), 없으면 null.
 * project 는 역할 폼에서 프로젝트만의 선택(「기본」 과 「내 공통 선택」 을 가른다). 옛 CLI 의 폼에는 없어 싣지 않는다.
 */
function personalData(p) {
  const out = { chosen: p.chosen, required: p.required, add: p.add, remove: p.remove, preset: p.preset, role: typeof p.role === 'string' ? p.role : null };
  if (Array.isArray(p.project) && p.project.every(k => typeof k === 'string')) out.project = p.project;
  return out;
}

/** 폼 제목: 프로젝트 폼과 로컬(개인) 폼을 이름부터 나눈다. 역할 폼은 로컬 제목에 역할 이름을 붙인다. */
function formTitle(f) {
  if (f.payload.mode !== 'personal') return t('web.form.title.project');
  const role = f.payload.personal?.role;
  return typeof role === 'string' && role ? t('web.form.title.role', { name: role }) : t('web.form.title.personal');
}

function subtitle(f) {
  const p = f.payload.project;
  if (f.payload.mode === 'personal') return `${p.path} · ${t('web.form.personal')}`;
  return `${p.path} · ${p.isNew ? t('web.form.newProject') : p.nested ? t('web.form.nested') : 'ruler'}`;
}

function formBody(f) {
  const p = f.payload.project;
  return html`<div id="form-app" data-id="${f.id}" data-status="${f.status}">
<p class="meta" id="subtitle">${subtitle(f)}</p>
<p class="error" id="error" hidden></p>
<section id="choose" class="choose" hidden>
<div class="field">${t('web.form.agents')}
<label><input type="checkbox" name="agent" value="claude" checked> claude</label>
<label><input type="checkbox" name="agent" value="codex" checked> codex</label>
<label><input type="checkbox" name="agent" value="opencode" checked> opencode</label>
</div>
</section>
<section id="personal" class="personal-head" hidden><p id="personal-intro"></p><p class="meta" id="preset" hidden></p></section>
<section id="dirty" class="alert" hidden>
<p>${p.gitRepo ? t('web.form.dirty') : t('web.form.notGit')} ${t('web.form.mayMix')}</p>
<label><input type="checkbox" id="force"> ${t('web.form.force')}</label>
</section>
<section id="checklist">
<nav id="steps" class="steps" aria-label="${t('web.form.steps')}">${STEPS.map((s, i) => html`<button type="button" class="step" data-step="${s}"><b>${i + 1}. ${t(`web.form.step.${s}`)}</b><small></small></button>`)}</nav>
<div class="toolbar"><span class="meta">${t('web.form.byCategory')}</span><div id="chips" class="chips"></div><button type="button" class="secondary" id="reset">${t('web.form.reset')}</button></div>
<div id="list"></div>
</section>
<section id="finished" hidden><p id="finished-text"></p></section>
</div>
<footer id="bar" class="form-bar">
<span id="summary"></span>
<button type="button" class="secondary" data-cancel>${t('web.cancel')}</button>
<button type="button" class="secondary" id="prev">${t('web.form.prev')}</button>
<button type="button" id="next">${t('web.form.next')}</button>
<button type="button" id="submit" hidden>${t('web.form.submit')}</button>
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
    sendPage(ctx.res, 200, { title: formTitle(f), nav: false, wide: true, scripts: ['/static/forms.js'], body: formBody(f) });
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
      // 빼라고 추천한 블록(가상 이름 → 이유). 프로젝트 모드에서 화면이 미리 끈다. 옛 CLI 의 폼에는 없다.
      recommendRemove: f.payload.recommendRemove ?? {},
      // 'personal' 이면 개인 선택 폼(personal: 프로젝트 선택·필수·미리 체크한 더함·뺌). required 는 프로젝트 모드의 지금 필수.
      mode: f.payload.mode ?? 'project',
      personal: f.payload.mode === 'personal' ? personalData(f.payload.personal) : null,
      required: f.payload.required ?? [],
      // CLI 가 payload 에 지금 고정(required)을 실었는가. 옛 CLI 의 폼이면 거짓이고, 화면은 고정 칸을 끈다(제출해도 결과에 싣지 않는다).
      fixedKnown: Array.isArray(f.payload.required),
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
    if (f.payload.mode === 'personal') {
      const selection = personalSelection({ personal: f.payload.personal, choices: personalChoicesOf(body), saveDefault: body?.saveDefault === true });
      if (selection.rejected.length) throw new HttpError(400, t('web.form.requiredRemove', { keys: selection.rejected.join(', ') }));
      if (!ctx.forms.finish(f.id, 'submitted', selection)) throw new HttpError(409, t('web.form.closed'));
      sendJson(ctx.res, 200, { ok: true });
      return;
    }
    const p = f.payload.project;
    if (!p.isNew && (!p.gitRepo || p.dirty) && body?.force !== true) {
      throw new HttpError(400, t('web.form.needForce'));
    }
    const project = needsForm(p) ? chosenOf(body) : null;
    // 필수: CLI 가 payload 에 지금 필수를 실었을 때만 다룬다 — 화면이 보낸 것, 없으면(옛 화면) payload 의 것. payload 에 없으면(옛 CLI)
    // 화면은 필수 없이 시작해 늘 [] 를 보내므로 그것을 믿지 않고 결과에 싣지 않는다(CLI 는 매니페스트의 필수를 그대로 둔다).
    const required = Array.isArray(f.payload.required)
      ? (Array.isArray(body?.required) ? body.required.filter(k => typeof k === 'string') : f.payload.required)
      : undefined;
    const selection = buildSelection({ revision: f.revision, items: f.payload.items, choices: isObj(body?.choices) ? body.choices : {}, project, required });
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
