import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, sendBody } from '../http.js';
import { tarGz } from '../tar.js';
import { contentType } from '../api.js';
import { fileCategories } from '../../../cli/src/catalog.js';
import { isTextPath } from '../../../cli/src/store-paths.js';
import { isAdmin, requireReadWeb } from './auth.js';
import { html, raw, hrefFor, stackLabel } from './layout.js';
import { catalogAt, blockList, sendView } from './frame.js';
import { renderMarkdown, splitFrontmatter } from './markdown.js';
import { t, template } from '../../../cli/src/i18n.js';
import { marker } from '../../../cli/src/markers.js';
import { viewHref, blockHref, blockOf, blockFiles, blockDir, namesOf, TAB, LIST_HREF } from './blocks.js';

const STATIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../static');
const STATIC_FILES = {
  'app.css': { file: path.join(STATIC_DIR, 'app.css'), type: 'text/css; charset=utf-8' },
  'app.js': { file: path.join(STATIC_DIR, 'app.js'), type: 'text/javascript; charset=utf-8' },
  'forms.js': { file: path.join(STATIC_DIR, 'forms.js'), type: 'text/javascript; charset=utf-8' },
  // 폼 화면이 서버와 같은 선택 규칙을 쓴다.
  'selection.js': { file: path.resolve(STATIC_DIR, '../../cli/src/selection.js'), type: 'text/javascript; charset=utf-8' },
};

const chips = list => (list?.length ? list.map(c => html`<span class="tag">${c}</span>`) : '');
const loadChip = load => (load === null ? html`<span class="k warn">${t('web.warning')}</span>` : html`<span class="${load === 'always' ? 'k' : 'k ref'}">${load}</span>`);
const warnCount = (s, prefix) => s.warnings.filter(w => w.path.startsWith(prefix)).length;

/** 마크다운 문서 블록. raw 에는 렌더러가 이스케이프를 끝낸 결과만 넣는다. 상대 링크는 블록 상세·설정 주소로 푼다. */
const docBlock = (ctx, text, p) => {
  const { summary } = catalogAt(ctx.store);
  return html`<div class="doc">
${raw(renderMarkdown(text, { path: p, hrefOf: q => viewHref(q, summary) }))}
</div>`;
};

/** 파일·디렉터리 화면 아래의 이름 바꾸기·삭제 폼. 처리는 edit.js 가 한다. */
export function manageForms(p, kind) {
  const confirm = kind === 'dir' ? t('web.confirmDeleteDir', { path: p }) : t('web.confirmDelete', { path: p });
  return html`<details class="manage"><summary>${t('web.manage')}</summary>
<form method="post" action="/rename" class="stack">
<input type="hidden" name="from" value="${p}">
<label>${t('web.newPath')} <input name="to" value="${p}" required></label>
<label>${t('web.message')} <input name="message" required></label>
<button>${t('web.rename')}</button>
</form>
<form method="post" action="${hrefFor('/delete/', p)}" class="stack" data-confirm="${confirm}">
<label>${t('web.message')} <input name="message" required></label>
<button class="danger">${t('web.delete')}</button>
</form></details>`;
}

function stackCard(st, cat) {
  const s = cat.summary;
  const count = load => st.files.filter(f => f.load === load).length;
  const warns = warnCount(s, `rules/${st.name}/`);
  const { intro } = cat.stacks.get(st.name);
  return html`<a class="card" href="${blockHref('stack', st.name)}">
<span class="card-t"><b>${stackLabel(st.name)}</b><span class="n">${t('web.count', { n: st.files.length })}</span></span>
${intro ? html`<p class="card-d">${intro}</p>` : ''}
<span class="card-m">${count('always') ? html`<span class="k">always ${count('always')}</span>` : ''}${count('reference') ? html`<span class="k ref">reference ${count('reference')}</span>` : ''}${chips(s.categories[`rules/${st.name}`])}${st.setup ? html`<span class="badge setup">${t('web.setupDoc')}</span>` : ''}${warns ? html`<span class="badge warn">${t('web.warnings', { n: warns })}</span>` : ''}</span>
</a>`;
}

function homePage(ctx) {
  const head = ctx.store.headRevision();
  if (head === 0) {
    sendView(ctx, 200, {
      title: t('web.side.list'),
      h1: t('web.tab.stacks'),
      tab: 'stacks',
      body: html`<p>${t('web.empty')}</p>${isAdmin(ctx) ? html`<div class="grid">${addCard('stack')}</div>` : ''}`,
    });
    return;
  }
  const cat = catalogAt(ctx.store);
  const s = cat.summary;
  const want = ctx.url.searchParams.get('cat');
  const all = [...new Set(Object.values(s.categories).flat())].sort();
  const stacks = s.stacks.filter(st => !want || (s.categories[`rules/${st.name}`] ?? []).includes(want)
    || st.files.some(f => fileCategories(s.categories, f.path).includes(want)));
  const fileCount = s.stacks.reduce((n, st) => n + st.files.length, 0);
  const chip = (label, href, on) => html`<a class="${on ? 'chip on' : 'chip'}" href="${href}">${label}</a>`;
  sendView(ctx, 200, {
    title: t('web.side.list'),
    h1: t('web.tab.stacks'),
    tab: 'stacks',
    body: html`<p class="stats"><span><b>${s.stacks.length}</b> ${t('web.stats.stacks')}</span><span><b>${fileCount}</b> ${t('web.stats.files')}</span><span><b>${s.skills.length}</b> ${t('web.stats.skills')}</span><span><b>${s.mcp.length}</b> MCP</span><span>${t('web.stats.latest')} <a href="/r/${head}">r${head}</a></span></p>
${all.length ? html`<nav class="chips" aria-label="${t('web.categories')}">${chip(t('web.all'), '/', !want)}${all.map(c => html` ${chip(c, `/?cat=${encodeURIComponent(c)}`, c === want)}`)}</nav>` : ''}
${stacks.length || isAdmin(ctx) ? html`<div class="grid">
${stacks.map(st => stackCard(st, cat))}
${isAdmin(ctx) ? addCard('stack') : ''}
</div>` : ''}
${!stacks.length ? html`<p class="meta">${t('web.noStacksInCategory')}</p>` : ''}
${s.warnings.length || s.ignored.length ? html`<p class="meta"><a href="/settings">${t('web.settings.problems', { warnings: s.warnings.length, ignored: s.ignored.length })}</a></p>` : ''}`,
  });
}

const KIND_OF_TAB = { skills: 'skill', agents: 'agent', mcp: 'mcp' };

/** 목록 마지막의 블록 추가 카드(관리자). */
const addCard = kind => html`<a class="card add" href="${`/add?kind=${kind}`}"><span class="card-t"><b>${t(`web.add.${kind}`)}</b></span></a>`;

const TAB_PAGES = {
  skills: {
    get title() { return t('web.tab.skills'); },
    list: cat => cat.skills.map(x => ({
      name: x.name,
      href: blockHref('skill', x.name),
      desc: x.description,
      meta: t('web.count', { n: x.entries.length }),
      cats: cat.summary.categories[`skills/${x.name}`],
      warn: warnCount(cat.summary, `skills/${x.name}/`),
    })),
  },
  agents: {
    get title() { return t('web.tab.agents'); },
    list: cat => cat.agents.map(x => ({
      name: x.name,
      href: blockHref('agent', x.name),
      desc: x.description,
      meta: '',
      cats: cat.summary.categories[`agents/${x.name}.md`],
      warn: warnCount(cat.summary, `agents/${x.name}.md`),
    })),
  },
  mcp: {
    title: 'MCP',
    list: cat => cat.mcp.map(x => ({
      name: x.name,
      href: blockHref('mcp', x.name),
      desc: x.intro,
      meta: x.build ? t('list.mcpBuild') : x.envVars.length ? t('list.mcpEnv', { vars: x.envVars.join(', ') }) : '',
      cats: cat.summary.categories[`mcp/${x.name}`],
      warn: warnCount(cat.summary, `mcp/${x.name}/`),
    })),
  },
};

function tabPage(ctx, tab) {
  const def = TAB_PAGES[tab];
  const items = def.list(catalogAt(ctx.store));
  sendView(ctx, 200, {
    title: def.title,
    tab,
    body: items.length || isAdmin(ctx) ? html`<div class="grid">
${items.map(x => html`<a class="card" href="${x.href}">
<span class="card-t"><b>${x.name}</b>${x.meta ? html`<span class="n">${x.meta}</span>` : ''}</span>
${x.desc ? html`<p class="card-d">${x.desc}</p>` : ''}
${x.cats?.length || x.warn ? html`<span class="card-m">${chips(x.cats)}${x.warn ? html`<span class="badge warn">${t('web.warnings', { n: x.warn })}</span>` : ''}</span>` : ''}
</a>`)}
${isAdmin(ctx) ? addCard(KIND_OF_TAB[tab]) : ''}
</div>` : html`<p class="meta">${t('web.noneYet')}</p>`,
  });
}

/** frontmatter 칸을 칩으로. load 는 강조, categories 는 값마다 분류 칩, 나머지는 「키 값」. */
function frontChips(fields) {
  return fields.map(f => {
    if (f.key === 'load') return f.values.map(v => html`<span class="${v === 'always' ? 'pill k' : 'pill k ref'}">${v}</span>`);
    if (f.key === 'categories') return chips(f.values);
    return html`<span class="pill"><b>${f.key}</b> ${f.values.join(', ')}</span>`;
  });
}

/** 처음 열 때 가운데에 보일 파일. 스택은 README, 없으면 첫 지침 파일. */
const DEFAULT_FILES = { stack: ['README.md'], skill: ['SKILL.md'], mcp: ['README.md', 'server.json'] };

/**
 * 가운데: 파일 하나(렌더링·원문·텍스트·바이너리)와 제목 줄 버튼.
 * @returns {{ actions: unknown, body: unknown }}
 */
export function fileView(ctx, p) {
  const content = ctx.store.fileAt(p);
  const last = ctx.store.fileHistory(p, { limit: 1 })[0];
  const text = isTextPath(p);
  const md = text && p.endsWith('.md');
  const showRaw = ctx.url.searchParams.get('raw') === '1';
  const source = text ? content.toString('utf8') : '';
  const fm = md && !showRaw ? splitFrontmatter(source) : null;
  const view = ctx.url.pathname;
  const admin = isAdmin(ctx);
  const toggle = showRaw
    ? html`<a class="button secondary" href="${view}">${t('web.rendered')}</a>`
    : html`<a class="button secondary" href="${`${view}?raw=1`}">${t('web.raw')}</a>`;
  return {
    actions: html`${admin && text ? html`<a class="button" href="${hrefFor('/edit/', p)}">${t('web.edit')}</a>` : ''}${md ? toggle : ''}<a class="button secondary" href="${hrefFor('/history/', p)}">${t('web.nav.history')}</a><a class="button secondary" href="${hrefFor('/raw/', p)}">${t('web.download')}</a>`,
    body: html`<p class="meta-row"><code class="path">${p}</code>${fm ? frontChips(fm.fields) : ''}<span class="meta">${t('web.lastChange')} <a href="/r/${last.id}">r${last.id}</a> · ${last.author} · ${last.message}</span></p>
${fm ? docBlock(ctx, fm.body, p)
    : text ? html`<pre class="file">${source}</pre>`
      : html`<p>${t('web.binary', { n: content.length })}</p>`}
${admin ? manageForms(p, 'file') : ''}`,
  };
}

/** 스택 README 아래에 두는 것: 경고, 다른 스택을 바꾸는 표, 세팅 문서. */
function stackExtras(cat, name) {
  const s = cat.summary;
  const st = s.stacks.find(x => x.name === name);
  const dir = `rules/${name}`;
  const warns = s.warnings.filter(w => w.path.startsWith(`${dir}/`));
  const short = p => (p.startsWith(`${dir}/`) ? p.slice(dir.length + 1) : p.replace(/^rules\//, ''));
  // 파일마다 분류를 단 스택에서만 분류 칸을 둔다(스택 분류는 위 칩에 있다).
  const fileCats = st.files.some(f => s.categories[f.path]?.length);
  return html`${warns.length ? html`<div class="warn"><ul class="plain">${warns.map(w => html`<li><a href="${viewHref(w.path.replace(/\/$/, ''), s)}">${short(w.path) || name}</a> — ${w.message}</li>`)}</ul></div>` : ''}
<h2>${t('web.files')}</h2>
<div class="table-wrap"><table class="list">
<thead><tr><th>${t('web.col.file')}</th><th>${t('web.col.load')}</th><th>${t('web.col.when')}</th>${fileCats ? html`<th>${t('web.categories')}</th>` : ''}</tr></thead>
<tbody>
${st.files.map(f => html`<tr><td class="name"><a href="${viewHref(f.path, s)}">${short(f.path)}</a></td><td>${loadChip(f.load)}</td><td>${f.when ?? ''}</td>${fileCats ? html`<td>${chips(s.categories[f.path])}</td>` : ''}</tr>
`)}</tbody>
</table></div>
${st.setup ? html`<p>${t('web.setupDocLabel')} <a href="${blockHref('stack', name, 'SETUP.md')}">SETUP.md</a></p>` : ''}
${st.overrides.length ? html`<h2>${marker('overridesSection')}</h2>
<div class="table-wrap"><table class="list">
<thead><tr><th>${t('web.col.ownSection')}</th><th>${t('web.col.overridden')}</th></tr></thead>
<tbody>
${st.overrides.map(o => html`<tr><td><a href="${viewHref(o.from.path, s)}">${short(o.from.path)}</a> ${t('web.quoted', { title: o.from.title })}</td><td><a href="${viewHref(o.to.path, s)}">${short(o.to.path)}</a> ${t('web.quoted', { title: o.to.title })}</td></tr>
`)}</tbody>
</table></div>` : ''}`;
}

/** 오른쪽: 블록의 파일 트리와 관리 도구. */
function filesPanel(ctx, kind, name, files, current) {
  const cat = catalogAt(ctx.store);
  const dir = blockDir(kind, name);
  const loads = new Map((cat.summary.stacks.find(x => x.name === name && kind === 'stack')?.files ?? []).map(f => [f.path.slice(dir.length + 1), f.load]));
  const admin = isAdmin(ctx);
  const topHashes = JSON.stringify(Object.fromEntries(files.filter(f => !f.includes('/')).map(f => [f, ctx.store.hashAt(`${dir}/${f}`)])));
  return html`<h2>${t('web.files')}</h2>
<ul class="tree">
${files.map(f => html`<li><a${f === current ? html` class="on"` : ''} href="${blockHref(kind, name, f)}"${f === current ? html` aria-current="page"` : ''}><span>${f}</span>${loads.has(f) ? loadChip(loads.get(f)) : ''}</a></li>
`)}</ul>
<div class="tools">
<a class="button secondary" href="${hrefFor('/archive/', dir)}">${t('web.archive')}</a>
${admin ? html`<a class="button secondary" href="${`/new?dir=${encodeURIComponent(dir)}`}">${t('web.newFile')}</a>
<form class="stack upload" data-upload="${dir}" data-hashes="${topHashes}">
<h2>${t('web.upload.heading')}</h2>
<label>${t('web.upload.file')} <input type="file" name="file" required></label>
<label>${t('web.message')} <input name="message" required></label>
<button>${t('web.upload.button')}</button>
<p class="upload-status" aria-live="polite"></p>
</form>
${manageForms(dir, 'dir')}` : ''}
</div>`;
}

/** 블록 상세(스택·스킬·MCP): 왼쪽 블록 목록, 가운데 고른 파일, 오른쪽 파일 트리. */
function blockPage(ctx, kind) {
  const name = ctx.params.name.normalize('NFC');
  const rel = (ctx.params.path ?? '').normalize('NFC').replace(/\/+$/, '');
  const cat = catalogAt(ctx.store);
  const s = cat.summary;
  if (!namesOf(s, kind).includes(name)) throw new HttpError(404, kind === 'stack' ? t('web.noStack') : t('web.noBlock'));
  const files = blockFiles(ctx.store, kind, name);
  const dir = blockDir(kind, name);
  const firstRule = kind === 'stack' ? s.stacks.find(x => x.name === name).files[0]?.path.slice(dir.length + 1) : undefined;
  const current = rel || DEFAULT_FILES[kind].find(f => files.includes(f)) || firstRule || files[0];
  if (!files.includes(current)) throw new HttpError(404, t('api.noFile'));
  const p = `${dir}/${current}`;
  const view = fileView(ctx, p);
  sendView(ctx, 200, {
    title: `${name} · ${current}`,
    h1: kind === 'stack' ? stackLabel(name) : name,
    crumbs: [{ label: TAB_LABEL[kind](), href: LIST_HREF[kind] }],
    tab: TAB[kind],
    actions: view.actions,
    detail: { left: blockList(cat, kind, name), right: filesPanel(ctx, kind, name, files, current) },
    body: html`${chips(s.categories[dir])}${view.body}${kind === 'stack' && current === 'README.md' ? stackExtras(cat, name) : ''}`,
  });
}

/** 서브에이전트 상세: 파일 하나라 오른쪽 트리가 없다. */
function agentPage(ctx) {
  const name = ctx.params.name.normalize('NFC');
  const cat = catalogAt(ctx.store);
  if (!cat.summary.subagents.includes(name)) throw new HttpError(404, t('web.noBlock'));
  const view = fileView(ctx, `agents/${name}.md`);
  sendView(ctx, 200, {
    title: name,
    h1: name,
    crumbs: [{ label: TAB_LABEL.agent(), href: LIST_HREF.agent }],
    tab: TAB.agent,
    actions: view.actions,
    detail: { left: blockList(cat, 'agent', name), right: null },
    body: view.body,
  });
}

const TAB_LABEL = {
  stack: () => t('web.tab.stacks'),
  skill: () => t('web.tab.skills'),
  agent: () => t('web.tab.agents'),
  mcp: () => 'MCP',
};

/** 목록, 블록 상세(스택·스킬·서브에이전트·MCP), 원본·블록 내려받기, 정적 파일을 등록한다. PUBLIC_READ 면 로그인 없이 연다. */
export function registerBrowse(router) {
  router.add('GET', '/', ctx => {
    if (requireReadWeb(ctx)) homePage(ctx);
  });
  router.add('GET', '/s/:name/*path', ctx => {
    if (requireReadWeb(ctx)) blockPage(ctx, 'stack');
  });
  for (const tab of Object.keys(TAB_PAGES)) {
    router.add('GET', `/${tab}`, ctx => {
      if (requireReadWeb(ctx)) tabPage(ctx, tab);
    });
  }
  router.add('GET', '/skills/:name/*path', ctx => {
    if (requireReadWeb(ctx)) blockPage(ctx, 'skill');
  });
  router.add('GET', '/mcp/:name/*path', ctx => {
    if (requireReadWeb(ctx)) blockPage(ctx, 'mcp');
  });
  router.add('GET', '/agents/:name', ctx => {
    if (requireReadWeb(ctx)) agentPage(ctx);
  });
  router.add('GET', '/raw/*path', ctx => {
    if (!requireReadWeb(ctx)) return;
    const p = ctx.params.path.normalize('NFC');
    const content = ctx.store.fileAt(p);
    if (content === null) throw new HttpError(404, t('api.noFile'));
    const name = p.slice(p.lastIndexOf('/') + 1);
    sendBody(ctx.res, 200, content, contentType(p), { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` });
  });
  // 블록 하나(스택·스킬·MCP 디렉터리)만 담은 tar.gz. 경로는 저장 경로 그대로다.
  router.add('GET', '/archive/*path', ctx => {
    if (!requireReadWeb(ctx)) return;
    const p = ctx.params.path.normalize('NFC').replace(/\/+$/, '');
    const b = blockOf(p, catalogAt(ctx.store).summary);
    if (!b || b.rel !== '' || b.kind === 'agent') throw new HttpError(404, t('web.noBlock'));
    const head = ctx.store.headRevision();
    const files = blockFiles(ctx.store, b.kind, b.name).map(rel => ({ path: `${p}/${rel}`, content: ctx.store.fileAt(`${p}/${rel}`, head) }));
    sendBody(ctx.res, 200, tarGz(files, { mtime: ctx.now() }), 'application/gzip', {
      'Content-Disposition': `attachment; filename="${encodeURIComponent(b.name)}-r${head}.tar.gz"`,
    });
  });
  // llms.txt 를 사람이 읽는 화면. 원문과 같이 비밀이 없어 PUBLIC_READ 와 상관없이 연다.
  router.add('GET', '/usage', ctx => {
    const origin = ctx.config.publicUrl.origin;
    const text = template('llms.txt', { SERVER: origin });
    sendView(ctx, 200, {
      title: t('web.usage.title'),
      on: 'usage',
      actions: html`<button type="button" class="button" data-copy="${`${origin}/llms.txt`}">${t('web.usage.copy')}</button><a class="button secondary" href="/llms.txt">${t('web.usage.raw')}</a>`,
      body: html`<div class="doc">
${raw(renderMarkdown(text, { path: 'llms.txt', hrefOf: () => '/usage' }))}
</div>`,
    });
  });
  // 에이전트·사람이 읽는 사용·세팅 안내. 비밀이 없어 로그인 없이 연다.
  router.add('GET', '/llms.txt', ctx => {
    const text = template('llms.txt', { SERVER: ctx.config.publicUrl.origin });
    sendBody(ctx.res, 200, Buffer.from(text), 'text/plain; charset=utf-8', { 'Cache-Control': 'no-cache' });
  });
  router.add('GET', '/static/:name', ctx => {
    const f = STATIC_FILES[ctx.params.name];
    if (!f) throw new HttpError(404, t('api.noFile'));
    sendBody(ctx.res, 200, fs.readFileSync(f.file), f.type, { 'Cache-Control': 'no-cache' });
  });
}
