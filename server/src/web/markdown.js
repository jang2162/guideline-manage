// 지침 파일을 보이는 작은 마크다운 렌더러. 의존성 없이 순수 함수로 둔다.
// 지원: 제목(#~######), 문단, 중첩 목록(- * + 1.), 펜스 코드 블록, 인라인 코드, 굵게·기울임, 링크, GFM 파이프 표, 인용, 가로줄.
// 이미지는 링크로 보인다. 그 밖의 문법(HTML 포함)은 글자 그대로 보인다.
// 보안: 글자는 모두 esc 를 거쳐 나간다. 태그는 이 파일이 만든 것뿐이고, 속성값도 esc 를 거친다.
// 링크는 http·https·mailto 와 상대 경로만 <a> 가 된다. 상대 경로는 지금 파일 기준으로 풀어 저장 경로를 hrefOf 로 화면 주소로 바꾸고,
// 저장 경로 밖으로 나가면 글자로 남긴다.
import { esc, hrefFor, parentOf } from './layout.js';

const PUNCT = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/;
const WORD = /[\p{L}\p{N}]/u;

const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}>/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])( +|$)(.*)$/;
const DELIM_CELL = /^\s*:?-+:?\s*$/;

// 병적인 입력(깊은 중첩, 닫히지 않는 괄호 수만 개)에서 스택이 넘치거나 제곱 시간이 걸리지 않게 둔 한도.
const MAX_BLOCK_DEPTH = 24;
const MAX_INLINE_DEPTH = 8;
const MAX_SCAN = 4000;

const isBlank = l => l.trim() === '';
const indentOf = l => l.length - l.trimStart().length;

// ---------- 링크 ----------

/**
 * 마크다운 링크 대상을 서버 주소로 바꾼다. 링크로 만들지 않을 대상이면 null.
 * @param {string} target 링크 괄호 안(제목을 뗀 것)
 * @param {string} fromPath 지금 파일의 저장 경로
 * @param {(p: string) => string} [hrefOf] 저장 경로(디렉터리면 끝 / 없이) → 화면 주소. 없으면 설정 화면 주소
 * @returns {string | null} 이스케이프하기 전의 href
 */
export function linkHref(target, fromPath, hrefOf = settingsHref) {
  const t = target.trim();
  if (!t) return null;
  if (/^(?:https?:\/\/|mailto:)/i.test(t)) return t;
  if (t.startsWith('#')) return `#${fragment(t.slice(1))}`;
  if (t.startsWith('/') || t.startsWith('\\')) return null;
  const hashAt = t.indexOf('#');
  const pathPart = (hashAt === -1 ? t : t.slice(0, hashAt)).split('?')[0];
  // 첫 조각에 : 이 있으면 스킴이다(javascript:, data:, java\tscript: …). 위에서 허락한 것 말고는 링크로 만들지 않는다.
  if (/^[^/]*:/.test(pathPart)) return null;
  let decoded;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    return null;
  }
  if (/[\u0000-\u001f\u007f\\]/.test(decoded)) return null;
  const parts = parentOf(fromPath) ? parentOf(fromPath).split('/') : [];
  const segs = decoded.split('/');
  for (const seg of segs) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(seg);
    }
  }
  const frag = hashAt === -1 ? '' : `#${fragment(t.slice(hashAt + 1))}`;
  return hrefOf(parts.join('/')) + frag;
}

const settingsHref = p => (p ? hrefFor('/settings/', p) : '/settings');

function fragment(f) {
  try {
    return encodeURIComponent(decodeURIComponent(f));
  } catch {
    return encodeURIComponent(f);
  }
}

// ---------- 인라인 ----------

function runLength(s, i, ch) {
  let j = i;
  while (s[j] === ch) j++;
  return j - i;
}

/** i 에서 시작하는 백틱 n 개 열기의 닫는 위치. 없으면 -1. */
function codeClose(s, from, n) {
  let j = from;
  const stop = Math.min(s.length, from + MAX_SCAN);
  while (j < stop) {
    const k = s.indexOf('`', j);
    if (k === -1) return -1;
    if (k >= stop) return -1;
    const r = runLength(s, k, '`');
    if (r === n) return k;
    j = k + r;
  }
  return -1;
}

/** 백슬래시 이스케이프와 코드 스팬을 건너뛰며 다음 글자 위치로. 코드 스팬이 아니면 i+1. */
function skip(s, i) {
  if (s[i] === '\\') return i + 2;
  if (s[i] === '`') {
    const n = runLength(s, i, '`');
    const close = codeClose(s, i + n, n);
    return close === -1 ? i + n : close + n;
  }
  return i + 1;
}

/** s[i] === '[' 에서 [label](target) 을 읽는다. 아니면 null. */
function parseLink(s, i) {
  let depth = 0;
  let j = i;
  const stop = Math.min(s.length, i + MAX_SCAN);
  while (j < stop) {
    const c = s[j];
    if (c === '\\' || c === '`') {
      j = skip(s, j);
      continue;
    }
    if (c === '[') depth++;
    else if (c === ']' && --depth === 0) break;
    j++;
  }
  if (j >= stop || s[j + 1] !== '(') return null;
  let k = j + 2;
  let paren = 1;
  const stopDest = Math.min(s.length, k + MAX_SCAN);
  while (k < stopDest) {
    const c = s[k];
    if (c === '\\') {
      k += 2;
      continue;
    }
    if (c === '(') paren++;
    else if (c === ')' && --paren === 0) break;
    k++;
  }
  if (k >= stopDest) return null;
  let dest = s.slice(j + 2, k).trim();
  const titled = /^(\S+)\s+(?:"[^"]*"|'[^']*'|\([^)]*\))$/.exec(dest);
  if (titled) dest = titled[1];
  if (!dest) return null;
  return { label: s.slice(i + 1, j), target: dest, end: k + 1 };
}

/** 강조 닫기 위치. 없으면 -1. */
function emphasisClose(s, from, ch, n) {
  const delim = ch.repeat(n);
  let j = from;
  const stop = Math.min(s.length, from + MAX_SCAN);
  while (j < stop) {
    if (s[j] === '\\' || s[j] === '`') {
      j = skip(s, j);
      continue;
    }
    if (s.startsWith(delim, j) && j > from && !/\s/.test(s[j - 1])
      && (ch !== '_' || !WORD.test(s[j + n] ?? ''))) return j;
    j++;
  }
  return -1;
}

const EMPHASIS = { 1: ['<em>', '</em>'], 2: ['<strong>', '</strong>'], 3: ['<strong><em>', '</em></strong>'] };

/**
 * 한 덩어리의 인라인 문법을 HTML 로. 결과는 이스케이프가 끝난 문자열이다.
 * @param {string} s
 * @param {{ path: string }} ctx
 * @param {number} [depth]
 */
function inline(s, ctx, depth = 0) {
  if (depth > MAX_INLINE_DEPTH) return esc(s);
  let out = '';
  let text = '';
  const flush = () => {
    out += esc(text);
    text = '';
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '\\' && i + 1 < s.length && PUNCT.test(s[i + 1])) {
      text += s[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const n = runLength(s, i, '`');
      const close = codeClose(s, i + n, n);
      if (close === -1) {
        text += s.slice(i, i + n);
        i += n;
        continue;
      }
      let code = s.slice(i + n, close).replace(/\n/g, ' ');
      if (code.length > 2 && code.startsWith(' ') && code.endsWith(' ') && code.trim()) code = code.slice(1, -1);
      flush();
      out += `<code>${esc(code)}</code>`;
      i = close + n;
      continue;
    }
    if (c === '[' || (c === '!' && s[i + 1] === '[')) {
      const image = c === '!';
      const link = parseLink(s, image ? i + 1 : i);
      if (link) {
        const href = linkHref(link.target, ctx.path, ctx.hrefOf);
        flush();
        if (href === null) out += esc(s.slice(i, link.end));
        else out += `<a href="${esc(href)}">${image ? esc(link.label || link.target) : inline(link.label, ctx, depth + 1)}</a>`;
        i = link.end;
        continue;
      }
    }
    if (c === '*' || c === '_') {
      const r = runLength(s, i, c);
      const after = s[i + r] ?? '';
      const opens = after !== '' && !/\s/.test(after) && (c !== '_' || !WORD.test(s[i - 1] ?? ''));
      let done = false;
      if (opens) {
        for (let n = Math.min(r, 3); n >= 1 && !done; n--) {
          const o = i + r - n;
          const close = emphasisClose(s, o + n, c, n);
          if (close === -1) continue;
          text += c.repeat(r - n);
          flush();
          out += EMPHASIS[n][0] + inline(s.slice(o + n, close), ctx, depth + 1) + EMPHASIS[n][1];
          i = close + n;
          done = true;
        }
      }
      if (!done) {
        text += c.repeat(r);
        i += r;
      }
      continue;
    }
    text += c;
    i++;
  }
  flush();
  return out;
}

// ---------- 블록 ----------

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === '|') {
      cur += '\\|';
      i++;
    } else if (s[i] === '|') {
      cells.push(cur);
      cur = '';
    } else {
      cur += s[i];
    }
  }
  cells.push(cur);
  return cells.map(c => c.trim().replace(/\\\|/g, '|'));
}

/** lines[i] 가 표 머리이면 칸 정렬 배열, 아니면 null. */
function tableAt(lines, i) {
  const head = lines[i];
  const delim = lines[i + 1];
  if (!head.includes('|') || delim === undefined || !delim.includes('-')) return null;
  const cells = splitRow(delim);
  if (!cells.every(c => DELIM_CELL.test(c))) return null;
  if (cells.length !== splitRow(head).length) return null;
  return cells.map(c => (c.startsWith(':') && c.endsWith(':') ? 'c' : c.endsWith(':') ? 'r' : c.startsWith(':') ? 'l' : ''));
}

function itemAt(line) {
  const m = ITEM.exec(line);
  if (!m || HR.test(line)) return null;
  const spaces = m[3].length;
  const indent = m[1].length;
  const contentCol = indent + m[2].length + (spaces === 0 || spaces > 4 ? 1 : spaces);
  return { indent, marker: m[2], ordered: /\d/.test(m[2]), content: m[4], contentCol };
}

/** 문단을 끊는 블록 시작인가. */
function interrupts(lines, i) {
  const l = lines[i];
  if (FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) || tableAt(lines, i)) return true;
  const item = itemAt(l);
  return Boolean(item && item.content.trim() && (!item.ordered || /^1[.)]$/.test(item.marker)));
}

function nextNonBlank(lines, i) {
  let k = i;
  while (k < lines.length && isBlank(lines[k])) k++;
  return k;
}

function parseList(lines, start, ctx, depth) {
  const first = itemAt(lines[start]);
  const base = first.indent;
  const items = [];
  let loose = false;
  let i = start;
  while (i < lines.length) {
    const m = itemAt(lines[i]);
    if (!m || m.ordered !== first.ordered || m.indent > base) break;
    const body = [m.content];
    i++;
    let inFence = FENCE.test(m.content);
    while (i < lines.length) {
      const l = lines[i];
      if (isBlank(l)) {
        const k = nextNonBlank(lines, i);
        if (k === lines.length) break;
        const nxt = itemAt(lines[k]);
        if (indentOf(lines[k]) >= m.contentCol || (nxt && nxt.indent > base)) {
          for (let b = i; b < k; b++) body.push('');
          i = k;
          continue;
        }
        break;
      }
      const ind = indentOf(l);
      if (ind >= m.contentCol) {
        if (FENCE.test(l.slice(m.contentCol))) inFence = !inFence;
        body.push(l.slice(m.contentCol));
        i++;
        continue;
      }
      const nested = itemAt(l);
      if (nested && nested.indent > base) {
        body.push(l.slice(Math.min(ind, m.contentCol)));
        i++;
        continue;
      }
      if (nested || inFence || isBlank(body.at(-1)) || interrupts(lines, i)) break;
      body.push(l.trimStart());
      i++;
    }
    items.push({ body, ordered: m.ordered, marker: m.marker });
    if (i < lines.length && isBlank(lines[i])) {
      const k = nextNonBlank(lines, i);
      const nxt = k < lines.length ? itemAt(lines[k]) : null;
      if (nxt && nxt.ordered === first.ordered && nxt.indent <= base) {
        loose = true;
        i = k;
        continue;
      }
      break;
    }
  }
  const tag = first.ordered ? 'ol' : 'ul';
  const startNo = first.ordered ? Number.parseInt(first.marker, 10) : 1;
  const open = startNo !== 1 ? `<ol start="${startNo}">` : `<${tag}>`;
  const lis = items.map(it => `<li>${blocks(it.body, ctx, !loose, depth + 1).join('\n')}</li>`);
  return { html: `${open}\n${lis.join('\n')}\n</${tag}>`, end: i };
}

/**
 * 줄 배열을 블록 HTML 배열로.
 * @param {string[]} lines
 * @param {{ path: string }} ctx
 * @param {boolean} [tight] 촘촘한 목록 항목 안이면 문단을 <p> 로 감싸지 않는다
 * @param {number} [depth] 인용·목록 중첩 깊이
 */
function blocks(lines, ctx, tight = false, depth = 0) {
  if (depth > MAX_BLOCK_DEPTH) return [`<p>${esc(lines.join('\n').trim())}</p>`];
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence && !(fence[2][0] === '`' && fence[3].includes('`'))) {
      const [, pad, mark] = fence;
      const body = [];
      i++;
      while (i < lines.length) {
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[i]);
        if (close && close[1][0] === mark[0] && close[1].length >= mark.length) {
          i++;
          break;
        }
        const l = lines[i];
        body.push(l.slice(Math.min(pad.length, indentOf(l))));
        i++;
      }
      out.push(`<pre class="code"><code>${esc(body.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      const n = heading[1].length;
      out.push(`<h${n}>${inline(heading[2] ?? '', ctx)}</h${n}>`);
      i++;
      continue;
    }
    if (HR.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const body = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(lines[i].replace(/^ {0,3}> ?/, ''));
        i++;
      }
      out.push(`<blockquote>\n${blocks(body, ctx, false, depth + 1).join('\n')}\n</blockquote>`);
      continue;
    }
    const align = tableAt(lines, i);
    if (align) {
      const cls = k => (align[k] ? ` class="al-${align[k]}"` : '');
      const row = (l, tagName) => align.map((_, k) => `<${tagName}${cls(k)}>${inline(splitRow(l)[k] ?? '', ctx)}</${tagName}>`).join('');
      const head = `<thead><tr>${row(line, 'th')}</tr></thead>`;
      i += 2;
      const rows = [];
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
        rows.push(`<tr>${row(lines[i], 'td')}</tr>\n`);
        i++;
      }
      out.push(`<div class="table-wrap"><table>\n${head}\n<tbody>\n${rows.join('')}</tbody></table></div>`);
      continue;
    }
    if (itemAt(line)) {
      const list = parseList(lines, i, ctx, depth);
      out.push(list.html);
      i = list.end;
      continue;
    }
    const para = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !interrupts(lines, i)) {
      para.push(lines[i].trim());
      i++;
    }
    const content = inline(para.join('\n'), ctx);
    out.push(tight ? content : `<p>${content}</p>`);
  }
  return out;
}

function toLines(text) {
  return text.replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/^\t+/, m => '    '.repeat(m.length)));
}

/**
 * 마크다운을 HTML 로. 결과는 이스케이프가 끝나 raw 에 그대로 넣을 수 있다.
 * @param {string} text frontmatter 를 뗀 본문
 * @param {{ path?: string, hrefOf?: (p: string) => string }} [opts] path: 지금 파일의 저장 경로(상대 링크의 기준), hrefOf: 저장 경로 → 화면 주소
 * @returns {string}
 */
export function renderMarkdown(text, { path = '', hrefOf = settingsHref } = {}) {
  return blocks(toLines(text), { path, hrefOf }).join('\n');
}

// ---------- frontmatter·요약 ----------

const unquote = v => (/^(["']).*\1$/.test(v) && v.length >= 2 ? v.slice(1, -1) : v);

/**
 * 맨 앞 --- 사이의 frontmatter 를 떼어 키마다 값 목록으로. 없거나 닫히지 않으면 fields 는 빈 배열이고 body 는 원문이다.
 * YAML 전체를 읽지 않는다: `key: value`, `key: [a, b]`, 그리고 key: 아래 `- a` 목록만 읽는다.
 * @param {string} text
 * @returns {{ fields: { key: string, values: string[] }[], body: string }}
 */
export function splitFrontmatter(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines[0] !== '---') return { fields: [], body: text };
  const end = lines.findIndex((l, i) => i > 0 && l.trimEnd() === '---');
  if (end === -1) return { fields: [], body: text };
  const fields = [];
  for (const line of lines.slice(1, end)) {
    const key = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line);
    if (key) {
      const v = key[2].trim();
      const values = v.startsWith('[') && v.endsWith(']')
        ? v.slice(1, -1).split(',').map(x => unquote(x.trim())).filter(Boolean)
        : v ? [unquote(v)] : [];
      fields.push({ key: key[1], values });
      continue;
    }
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && fields.length) fields.at(-1).values.push(unquote(item[1].trim()));
  }
  return { fields, body: lines.slice(end + 1).join('\n') };
}

const ENTITY = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/** 인라인 마크다운을 벗긴 글자. */
function plain(s) {
  return inline(s, { path: '' }).replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|#39);/g, e => ENTITY[e]);
}

/**
 * 첫 문단의 첫 문장(마크다운을 벗긴 글자). frontmatter·제목·표·목록·코드·인용은 건너뛴다. 없으면 ''.
 * @param {string} text
 */
export function firstSentence(text) {
  const lines = toLines(splitFrontmatter(text).body);
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    const fence = FENCE.exec(l);
    if (fence) {
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[2])) i++;
      i++;
      continue;
    }
    if (isBlank(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) || itemAt(l) || l.trim().startsWith('|') || tableAt(lines, i)) {
      i++;
      continue;
    }
    const para = [];
    while (i < lines.length && !isBlank(lines[i]) && !interrupts(lines, i)) para.push(lines[i++].trim());
    const s = plain(para.join(' ')).replace(/\s+/g, ' ').trim();
    const m = /^.*?[.!?](?=\s|$)/.exec(s);
    return m ? m[0] : s;
  }
  return '';
}
