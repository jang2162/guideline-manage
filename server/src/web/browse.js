import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError, sendBody, redirect } from '../http.js';
import { dbTree } from '../db-tree.js';
import { tarGz } from '../tar.js';
import { contentType } from '../api.js';
import { fileCategories } from '../../../cli/src/catalog.js';
import { isTextPath } from '../../../cli/src/store-paths.js';
import { requireAdminWeb } from './auth.js';
import { html, raw, hrefFor, parentOf } from './layout.js';
import { catalogAt, crumbsOf, whereOf, sendView } from './frame.js';
import { renderMarkdown, splitFrontmatter } from './markdown.js';
import { t, template } from '../../../cli/src/i18n.js';
import { marker } from '../../../cli/src/markers.js';

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

/** 마크다운 문서 블록. raw 에는 렌더러가 이스케이프를 끝낸 결과만 넣는다. */
const docBlock = (text, p) => html`<div class="doc">
${raw(renderMarkdown(text, { path: p }))}
</div>`;

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
  return html`<a class="card" href="${hrefFor('/s/', st.name)}">
<span class="card-t"><b>${st.name}</b><span class="n">${t('web.count', { n: st.files.length })}</span></span>
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
      where: { tab: 'stacks' },
      body: html`<p>${t('web.empty')}</p><p><a href="/new">${t('web.newFile')}</a></p>`,
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
    where: { tab: 'stacks' },
    actions: html`<a class="button secondary" href="/new">${t('web.newFile')}</a>`,
    body: html`<p class="stats"><span><b>${s.stacks.length}</b> ${t('web.stats.stacks')}</span><span><b>${fileCount}</b> ${t('web.stats.files')}</span><span><b>${s.skills.length}</b> ${t('web.stats.skills')}</span><span><b>${s.mcp.length}</b> MCP</span><span>${t('web.stats.latest')} <a href="/r/${head}">r${head}</a></span></p>
${all.length ? html`<nav class="chips" aria-label="${t('web.categories')}">${chip(t('web.all'), '/', !want)}${all.map(c => html` ${chip(c, `/?cat=${encodeURIComponent(c)}`, c === want)}`)}</nav>` : ''}
${stacks.length ? html`<div class="grid">
${stacks.map(st => stackCard(st, cat))}
</div>` : html`<p class="meta">${t('web.noStacksInCategory')}</p>`}
${s.warnings.length ? html`<section><h2>${t('web.warningsHeading')}</h2><ul class="plain">${s.warnings.map(w => html`<li><a href="${hrefFor('/f/', w.path.replace(/\/$/, ''))}">${w.path}</a> <span class="meta">${w.message}</span></li>`)}</ul></section>` : ''}
${s.ignored.length ? html`<section><h2>${t('web.ignored')}</h2><ul class="plain">${s.ignored.map(i => html`<li>${i.path} <span class="meta">${i.reason}</span></li>`)}</ul></section>` : ''}`,
  });
}

function stackPage(ctx) {
  const name = ctx.params.name.normalize('NFC');
  const cat = catalogAt(ctx.store);
  const s = cat.summary;
  const st = s.stacks.find(x => x.name === name);
  if (!st) throw new HttpError(404, t('web.noStack'));
  const dir = `rules/${name}`;
  const readme = ctx.store.fileAt(`${dir}/README.md`);
  const fm = readme ? splitFrontmatter(readme.toString('utf8')) : null;
  const warns = s.warnings.filter(w => w.path.startsWith(`${dir}/`));
  const short = p => (p.startsWith(`${dir}/`) ? p.slice(dir.length + 1) : p.replace(/^rules\//, ''));
  // 파일마다 분류를 단 스택에서만 분류 칸을 둔다(스택 분류는 위 칩에 있다).
  const fileCats = st.files.some(f => s.categories[f.path]?.length);
  sendView(ctx, 200, {
    title: name,
    crumbs: [{ label: t('web.tab.stacks'), href: '/' }],
    where: { tab: 'stacks', group: name },
    actions: html`${readme ? html`<a class="button" href="${hrefFor('/edit/', `${dir}/README.md`)}">${t('web.editReadme')}</a>` : ''}<a class="button secondary" href="${hrefFor('/d/', dir)}">${t('web.directory')}</a><a class="button secondary" href="${`/new?dir=${encodeURIComponent(dir)}`}">${t('web.newFile')}</a>`,
    body: html`<p class="meta-row">${chips(s.categories[dir])}${st.setup ? html`<a class="badge setup" href="${hrefFor('/f/', `${dir}/SETUP.md`)}">${t('web.setupDoc')}</a>` : ''}<span class="meta">${t('web.fileCount', { n: st.files.length })}</span></p>
${warns.length ? html`<div class="warn"><ul class="plain">${warns.map(w => html`<li><a href="${hrefFor('/f/', w.path)}">${short(w.path)}</a> — ${w.message}</li>`)}</ul></div>` : ''}
${fm ? docBlock(fm.body, `${dir}/README.md`) : html`<p class="meta">${t('web.noReadme')}</p>`}
<h2>${t('web.files')}</h2>
<div class="table-wrap"><table class="list">
<thead><tr><th>${t('web.col.file')}</th><th>${t('web.col.load')}</th><th>${t('web.col.when')}</th>${fileCats ? html`<th>${t('web.categories')}</th>` : ''}</tr></thead>
<tbody>
${st.files.map(f => html`<tr><td class="name"><a href="${hrefFor('/f/', f.path)}">${short(f.path)}</a></td><td>${loadChip(f.load)}</td><td>${f.when ?? ''}</td>${fileCats ? html`<td>${chips(s.categories[f.path])}</td>` : ''}</tr>
`)}</tbody>
</table></div>
${st.setup ? html`<p>${t('web.setupDocLabel')} <a href="${hrefFor('/f/', `${dir}/SETUP.md`)}">SETUP.md</a></p>` : ''}
${st.overrides.length ? html`<h2>${marker('overridesSection')}</h2>
<div class="table-wrap"><table class="list">
<thead><tr><th>${t('web.col.ownSection')}</th><th>${t('web.col.overridden')}</th></tr></thead>
<tbody>
${st.overrides.map(o => html`<tr><td><a href="${hrefFor('/f/', o.from.path)}">${short(o.from.path)}</a> ${t('web.quoted', { title: o.from.title })}</td><td><a href="${hrefFor('/f/', o.to.path)}">${short(o.to.path)}</a> ${t('web.quoted', { title: o.to.title })}</td></tr>
`)}</tbody>
</table></div>` : ''}`,
  });
}

const TAB_PAGES = {
  skills: {
    get title() { return t('web.tab.skills'); },
    list: cat => cat.skills.map(x => ({
      name: x.name,
      href: hrefFor('/d/', `skills/${x.name}`),
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
      href: hrefFor('/f/', `agents/${x.name}.md`),
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
      href: hrefFor('/d/', `mcp/${x.name}`),
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
    where: { tab },
    actions: html`<a class="button secondary" href="${`/new?dir=${encodeURIComponent(tab)}`}">${t('web.newFile')}</a>`,
    body: items.length ? html`<div class="grid">
${items.map(x => html`<a class="card" href="${x.href}">
<span class="card-t"><b>${x.name}</b>${x.meta ? html`<span class="n">${x.meta}</span>` : ''}</span>
${x.desc ? html`<p class="card-d">${x.desc}</p>` : ''}
${x.cats?.length || x.warn ? html`<span class="card-m">${chips(x.cats)}${x.warn ? html`<span class="badge warn">${t('web.warnings', { n: x.warn })}</span>` : ''}</span>` : ''}
</a>`)}
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

function filePage(ctx) {
  const p = ctx.params.path.normalize('NFC');
  const content = ctx.store.fileAt(p);
  if (content === null) {
    if (p && dbTree(ctx.store).exists(p)) {
      redirect(ctx.res, hrefFor('/d/', p));
      return;
    }
    throw new HttpError(404, t('api.noFile'));
  }
  const last = ctx.store.fileHistory(p, { limit: 1 })[0];
  const text = isTextPath(p);
  const md = text && p.endsWith('.md');
  const showRaw = ctx.url.searchParams.get('raw') === '1';
  const source = text ? content.toString('utf8') : '';
  const fm = md && !showRaw ? splitFrontmatter(source) : null;
  const view = hrefFor('/f/', p);
  const toggle = showRaw
    ? html`<a class="button secondary" href="${view}">${t('web.rendered')}</a>`
    : html`<a class="button secondary" href="${`${view}?raw=1`}">${t('web.raw')}</a>`;
  sendView(ctx, 200, {
    title: p,
    h1: p.slice(p.lastIndexOf('/') + 1),
    crumbs: crumbsOf(p, catalogAt(ctx.store)),
    where: whereOf(p),
    actions: html`${text ? html`<a class="button" href="${hrefFor('/edit/', p)}">${t('web.edit')}</a>` : ''}${md ? toggle : ''}<a class="button secondary" href="${hrefFor('/history/', p)}">${t('web.nav.history')}</a><a class="button secondary" href="${hrefFor('/raw/', p)}">${t('web.download')}</a>`,
    body: html`<p class="meta-row">${fm ? frontChips(fm.fields) : ''}<span class="meta">${t('web.lastChange')} <a href="/r/${last.id}">r${last.id}</a> · ${last.author} · ${last.message}</span></p>
${fm ? docBlock(fm.body, p)
    : text ? html`<pre class="file">${source}</pre>`
      : html`<p>${t('web.binary', { n: content.length })}</p>`}
${manageForms(p, 'file')}`,
  });
}

function dirPage(ctx) {
  const p = ctx.params.path.normalize('NFC').replace(/\/+$/, '');
  const tree = dbTree(ctx.store);
  const entries = tree.list(p);
  if (p !== '' && entries.length === 0) {
    if (tree.read(p) !== null) {
      redirect(ctx.res, hrefFor('/f/', p));
      return;
    }
    throw new HttpError(404, t('web.noDir'));
  }
  const child = name => (p ? `${p}/${name}` : name);
  const hashes = JSON.stringify(Object.fromEntries(
    entries.filter(e => !e.dir).map(e => [e.name, ctx.store.hashAt(child(e.name))]),
  ));
  sendView(ctx, 200, {
    title: p || t('web.allFiles'),
    h1: p ? `${p.slice(p.lastIndexOf('/') + 1)}/` : t('web.allFiles'),
    crumbs: crumbsOf(p, catalogAt(ctx.store)),
    where: whereOf(p),
    actions: html`${p ? html`<a class="button secondary" href="${hrefFor('/d/', parentOf(p))}">${t('web.up')}</a>` : ''}<a class="button secondary" href="${`/new?dir=${encodeURIComponent(p)}`}">${t('web.newFile')}</a>`,
    body: html`<ul class="entries">${entries.map(e => html`<li class="${e.dir ? 'dir' : 'file'}"><a href="${hrefFor(e.dir ? '/d/' : '/f/', child(e.name))}">${e.name}${e.dir ? '/' : ''}</a></li>`)}</ul>
${p ? html`<form class="stack upload" data-upload="${p}" data-hashes="${hashes}">
<h2>${t('web.upload.heading')}</h2>
<label>${t('web.upload.file')} <input type="file" name="file" required></label>
<label>${t('web.message')} <input name="message" required></label>
<button>${t('web.upload.button')}</button>
<p class="upload-status" aria-live="polite"></p>
</form>
${manageForms(p, 'dir')}` : ''}`,
  });
}

/** 목록(스택·스킬·서브에이전트·MCP), 스택, 파일·디렉터리 보기, 내려받기, 내보내기, 정적 파일을 등록한다. */
export function registerBrowse(router) {
  router.add('GET', '/', ctx => {
    if (requireAdminWeb(ctx)) homePage(ctx);
  });
  router.add('GET', '/s/:name', ctx => {
    if (requireAdminWeb(ctx)) stackPage(ctx);
  });
  for (const tab of Object.keys(TAB_PAGES)) {
    router.add('GET', `/${tab}`, ctx => {
      if (requireAdminWeb(ctx)) tabPage(ctx, tab);
    });
  }
  router.add('GET', '/f/*path', ctx => {
    if (requireAdminWeb(ctx)) filePage(ctx);
  });
  router.add('GET', '/d/*path', ctx => {
    if (requireAdminWeb(ctx)) dirPage(ctx);
  });
  router.add('GET', '/raw/*path', ctx => {
    if (!requireAdminWeb(ctx)) return;
    const p = ctx.params.path.normalize('NFC');
    const content = ctx.store.fileAt(p);
    if (content === null) throw new HttpError(404, t('api.noFile'));
    const name = p.slice(p.lastIndexOf('/') + 1);
    sendBody(ctx.res, 200, content, contentType(p), { 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` });
  });
  router.add('GET', '/export.tar.gz', ctx => {
    if (!requireAdminWeb(ctx)) return;
    const head = ctx.store.headRevision();
    const files = ctx.store.pathsAt(head).map(f => ({ path: f.path, content: ctx.store.fileAt(f.path, head) }));
    sendBody(ctx.res, 200, tarGz(files, { mtime: ctx.now() }), 'application/gzip', {
      'Content-Disposition': `attachment; filename="guideline-r${head}.tar.gz"`,
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
