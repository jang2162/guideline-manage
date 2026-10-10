import {
  stacks, stackTiers, stackOverrides, stackSetup, skills, subagents, mcpDefinitions, elementCategories, fileCategories,
} from './catalog.js';

/**
 * 화면에 보일 원본 목록. 지침 파일의 categories 는 스택 분류를 물려받은 것이다.
 * @param {string} root
 */
export function catalogView(root) {
  const { categories } = elementCategories(root);
  return {
    stacks: stacks(root).map(name => ({
      name,
      categories: categories[`rules/${name}`] ?? [],
      setup: stackSetup(name, root),
      files: stackTiers(name, root).map(f => ({ path: f.path, load: f.load, when: f.when, categories: fileCategories(categories, f.path) })),
      overrides: stackOverrides(name, root).overrides,
    })),
    skills: skills(root).map(name => ({ name, categories: categories[`skills/${name}`] ?? [] })),
    subagents: subagents(root).map(name => ({ name, categories: categories[`agents/${name}.md`] ?? [] })),
    mcp: mcpDefinitions(root).map(d => ({ name: d.name, build: d.build, categories: categories[`mcp/${d.name}`] ?? [] })),
  };
}
