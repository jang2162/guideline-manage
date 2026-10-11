import { stacks, stackTiers, stackOverrides, stackSetup, skills, subagents, mcpServers, ignored, warnings, elementCategories, elementLabels, elementRequires } from './catalog.js';
import { asTree } from './tree.js';

/**
 * list --json 이 내는 객체. 서버의 /api/v1/catalog 도 이 객체에 리비전 번호를 더해 낸다.
 * 칸이 경고 대상인 지침 파일은 load·when 이 null 이고, 경고 대상인 바꿈 행은 overrides 에 없다.
 * @param {string | import('./tree.js').Tree} src
 */
export function catalogSummary(src) {
  const tree = asTree(src);
  return {
    stacks: stacks(tree).map(name => ({
      name,
      files: stackTiers(name, tree).map(({ path, load, when }) => ({ path, load, when })),
      overrides: stackOverrides(name, tree).overrides,
      setup: stackSetup(name, tree),
    })),
    skills: skills(tree),
    subagents: subagents(tree),
    mcp: mcpServers(tree).map(s => ({ name: s.name, envVars: s.envVars, build: Boolean(s.build) })),
    ignored: ignored(tree),
    warnings: warnings(tree),
    categories: elementCategories(tree).categories,
    labels: elementLabels(tree).labels,
    requires: elementRequires(tree).requires,
  };
}
