import { t } from './i18n.js';

/** 할 일 목록을 사람이 읽게 낸다. 없으면 아무것도 내지 않는다. */
export function printTodos(todos, out) {
  if (todos.length === 0) return;
  out(t('todo.heading'));
  for (const t of todos) out(`  - ${t.message}`);
}
