// 확인 창, 바이너리 올리기, 사이드바(휴대폰 폭에서 접기, 찾기, / 키)만 한다. 나머지 화면은 서버가 그린 HTML 과 폼으로 돈다.
// 문구는 서버가 페이지의 i18n JSON 블록에 실어 준다(서버 언어).
const MESSAGES = JSON.parse(document.getElementById('i18n')?.textContent || '{}');
const t = (key, params = {}) => (MESSAGES[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
document.addEventListener('submit', event => {
  const form = event.target;
  if (form.dataset.confirm && !window.confirm(form.dataset.confirm)) {
    event.preventDefault();
    return;
  }
  if (form.dataset.upload !== undefined) {
    event.preventDefault();
    upload(form);
  }
});

async function upload(form) {
  const file = form.elements.file.files[0];
  const status = form.querySelector('.upload-status');
  if (!file) return;
  const hashes = JSON.parse(form.dataset.hashes || '{}');
  // macOS 브라우저는 한글 파일 이름을 NFD 로 준다. 서버의 경로와 해시 표는 NFC 다.
  const name = file.name.normalize('NFC');
  const target = `${form.dataset.upload}/${name}`;
  status.textContent = t('web.client.uploading');
  const res = await fetch(`/upload/${target.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Base-Hash': hashes[name] ?? 'none',
      'X-Message': encodeURIComponent(form.elements.message.value),
    },
    body: file,
  });
  if (res.ok) {
    window.location.reload();
    return;
  }
  const body = await res.json().catch(() => ({ error: String(res.status) }));
  status.textContent = body.error ?? String(res.status);
}

// 블록 상세 왼쪽의 블록 찾기: 이름이나 설명에 찾는 글자가 있는 블록만 남긴다.
const search = document.querySelector('input[data-side-search]');
if (search) {
  const items = [...document.querySelectorAll('.side-list > li')];
  const none = document.querySelector('.side-none');

  const filter = () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const li of items) {
      li.hidden = Boolean(q) && !li.textContent.toLowerCase().includes(q);
      if (!li.hidden) shown++;
    }
    if (none) none.hidden = shown > 0;
  };

  const firstHit = () => items.find(li => !li.hidden)?.querySelector('a') ?? null;

  search.addEventListener('input', filter);
  search.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      const a = firstHit();
      if (a && search.value.trim()) {
        event.preventDefault();
        window.location.href = a.href;
      }
    } else if (event.key === 'Escape') {
      search.value = '';
      filter();
      search.blur();
    }
  });

  // / 키로 찾기 칸에 간다. 입력칸에 쓰는 중이면 무시한다.
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const t = event.target;
      if (t instanceof Element && t.closest('input, textarea, select, [contenteditable]')) return;
      event.preventDefault();
      search.focus();
      search.select();
    }
  });
}

// 토큰 발급 폼: admin 범위를 고르면 경고를 보인다.
const scopeSelect = document.querySelector('[data-scope-select]');
const scopeWarning = document.querySelector('[data-scope-warning]');
if (scopeSelect && scopeWarning) {
  const syncScope = () => { scopeWarning.hidden = scopeSelect.value !== 'admin'; };
  scopeSelect.addEventListener('change', syncScope);
  syncScope();
}

// 사용법 화면의 「링크 복사」: 에이전트에게 넘길 llms.txt 주소를 클립보드에 넣고 잠깐 「복사됨」 을 보인다.
const CLIENT = JSON.parse(document.getElementById('i18n')?.textContent || '{}');
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
    } catch {
      return;
    }
    const label = button.textContent;
    button.textContent = CLIENT['web.client.copied'] ?? label;
    setTimeout(() => { button.textContent = label; }, 1500);
  });
}

// 휴대폰 폭의 파일 줄(app.css 휴대폰 규칙의 「하위 폴더가 없는 트리는 가로로 넘기는 한 줄」)은 맨 왼쪽에서 시작해 지금 파일이 화면 밖에 있을 수 있다.
// 줄이 실제로 가로 스크롤 중일 때만 그 줄의 scrollLeft 를 맞춰 지금 파일을 가운데로 옮긴다. scrollIntoView 는 페이지 세로 위치까지 움직일 수 있어 쓰지 않는다.
const fileRow = document.querySelector('.files > .tree');
const currentFile = fileRow?.querySelector(':scope > li > a.on');
if (fileRow && currentFile && getComputedStyle(fileRow).overflowX !== 'visible' && fileRow.scrollWidth > fileRow.clientWidth) {
  const row = fileRow.getBoundingClientRect();
  const on = currentFile.getBoundingClientRect();
  fileRow.scrollLeft += on.left - row.left - (row.width - on.width) / 2;
}
