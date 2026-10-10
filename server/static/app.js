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

// 사이드바는 넓은 화면에서 늘 펼치고, 휴대폰 폭에서는 본문 위의 접힌 「목록」 으로 둔다.
const side = document.querySelector('details.side');
if (side) {
  const narrow = window.matchMedia('(max-width: 760px)');
  const sync = () => {
    side.open = !narrow.matches;
  };
  sync();
  narrow.addEventListener('change', sync);
}

// 사이드바 찾기: 묶음 이름이나 파일 이름에 찾는 글자가 있는 것만 남긴다. 펼치지 않은 묶음의 파일도 찾는다.
const search = document.querySelector('input[data-side-search]');
if (search) {
  const groups = [...document.querySelectorAll('.side-list > .grp')];
  const none = document.querySelector('.side-none');
  const collapsed = new Map(groups.map(g => [g, g.querySelector('.files')?.hidden ?? true]));
  const label = el => (el.firstChild?.textContent ?? el.textContent).toLowerCase();

  const filter = () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    for (const g of groups) {
      const files = g.querySelector('.files');
      const items = files ? [...files.children] : [];
      if (!q) {
        g.hidden = false;
        if (files) files.hidden = collapsed.get(g);
        for (const li of items) li.hidden = false;
        shown++;
        continue;
      }
      const nameHit = label(g.firstElementChild).includes(q);
      let fileHit = false;
      for (const li of items) {
        const hit = li.textContent.toLowerCase().includes(q);
        li.hidden = !hit && !nameHit;
        fileHit ||= hit;
      }
      if (files) files.hidden = !(fileHit || (nameHit && !collapsed.get(g)));
      g.hidden = !(nameHit || fileHit);
      if (!g.hidden) shown++;
    }
    if (none) none.hidden = shown > 0;
  };

  /** 찾기 결과의 첫 링크: 맞는 파일이 있으면 그 파일, 없으면 묶음. */
  const firstHit = () => {
    for (const g of groups) {
      if (g.hidden) continue;
      const file = [...g.querySelectorAll('.files > li')].find(li => !li.hidden && !li.parentElement.hidden);
      return (file ?? g).querySelector('a');
    }
    return null;
  };

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
      if (side) side.open = true;
      search.focus();
      search.select();
    }
  });
}
