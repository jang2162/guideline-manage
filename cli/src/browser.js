import { spawn } from 'node:child_process';

/** 운영체제의 기본 브라우저로 연다. 실패해도 주소는 이미 stderr 에 나가 있다. */
export function openBrowser(url) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // 주소를 보고 사람이 연다
  }
}
