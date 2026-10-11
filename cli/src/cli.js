import path from 'node:path';
import { parseArgs } from 'node:util';
import { list, listFromServer } from './commands/list.js';
import { propose } from './commands/propose.js';
import { source } from './commands/source.js';
import { projectPick } from './commands/project-pick.js';
import { projectUpdate } from './commands/project-update.js';
import { projectStatus } from './commands/project-status.js';
import { login, logout } from './commands/login.js';
import { locale } from './commands/locale.js';
import { t, currentLocale } from './i18n.js';

const usage = () => t('help.usage');

/** 명령별로 허용하는 옵션. */
const ALLOWED_OPTIONS = {
  list: ['json', 'server', 'source'],
  pick: ['project', 'no-browser', 'new', 'server', 'source', 'recommend', 'json'],
  update: ['project', 'server', 'source', 'force', 'json'],
  status: ['project', 'server', 'source', 'json'],
  login: ['server', 'token-stdin'],
  logout: ['server'],
  propose: ['project', 'server', 'source', 'title', 'message', 'only', 'from', 'dry-run', 'apply', 'json'],
  source: ['server', 'source'],
  locale: ['json'],
  help: [],
};

/**
 * @param {string} command
 * @param {string} name
 * @returns {string}
 */
function unknownOptionMessage(command, name) {
  const allowed = ALLOWED_OPTIONS[command];
  const desc = allowed.length ? allowed.map(a => `--${a}`).join(', ') : t('cli.none');
  return t('cli.unknownOption', { name, command, desc });
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
export async function main(argv) {
  // 모르는 언어 코드, 깨진 언어팩: 왜 그 언어로 안 나오는지 알 수 있게 한 번 알린다.
  for (const w of currentLocale().warnings.splice(0)) console.error(w);
  const cwd = process.cwd();
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: 'boolean', short: 'h' },
        json: { type: 'boolean' },
        title: { type: 'string' },
        recommend: { type: 'string' },
        message: { type: 'string' },
        only: { type: 'string' },
        from: { type: 'string' },
        'dry-run': { type: 'boolean' },
        project: { type: 'string' },
        new: { type: 'string' },
        'no-browser': { type: 'boolean' },
        server: { type: 'string' },
        source: { type: 'string' },
        force: { type: 'boolean' },
        'token-stdin': { type: 'boolean' },
      },
    });
  } catch (e) {
    console.error(e.message);
    console.error(usage());
    return 2;
  }
  const { values, positionals } = parsed;
  const command = positionals[0];
  if (values.help || command === undefined) {
    console.log(usage());
    return 0;
  }

  if (!(command in ALLOWED_OPTIONS)) {
    console.error(t('cli.unknownCommand', { command }));
    console.error(usage());
    return 2;
  }

  for (const name of Object.keys(values)) {
    if (name === 'help') continue;
    if (!ALLOWED_OPTIONS[command].includes(name)) {
      console.error(unknownOptionMessage(command, name));
      return 2;
    }
  }

  if (command === 'help') {
    console.log(usage());
    return 0;
  }

  if (command === 'list') {
    if (positionals[1] !== undefined) return list({ root: path.resolve(cwd, positionals[1]), json: values.json });
    return listFromServer({ server: values.server, sourceName: values.source, json: values.json, cwd });
  }

  if (command === 'propose') {
    return propose({
      project: values.project, server: values.server, source: values.source, title: values.title, message: values.message,
      only: values.only?.split(',').map(s => s.trim()).filter(Boolean), from: values.from,
      dryRun: values['dry-run'], apply: values.apply, json: values.json, cwd,
    });
  }

  if (command === 'source') {
    return source({ dir: positionals[1], server: values.server, sourceName: values.source, cwd });
  }

  if (command === 'pick') {
    return projectPick({
      project: values.project, newTarget: values.new, server: values.server, source: values.source, browser: !values['no-browser'], recommend: values.recommend, json: values.json, cwd,
    });
  }

  if (command === 'update') {
    return projectUpdate({ project: values.project, server: values.server, source: values.source, force: values.force, json: values.json, cwd });
  }

  if (command === 'status') {
    return projectStatus({ project: values.project, server: values.server, source: values.source, json: values.json, cwd });
  }

  if (command === 'locale') {
    return locale({ action: positionals[1], dir: positionals[2], json: values.json });
  }

  if (command === 'login') {
    return login({ server: values.server, tokenStdin: values['token-stdin'] });
  }

  if (command === 'logout') {
    return logout({ server: values.server });
  }
}
