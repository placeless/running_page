import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..'
);
const requireNode = createRequire(import.meta.url);

/** Minimal in-memory adapter for testing pure TS modules on Node 20+. */
export function createTypeScriptLoader(modules = {}) {
  const loaded = new Map();
  const load = (relative) => {
    const filename = path.resolve(
      root,
      relative.endsWith('.ts') || relative.endsWith('.tsx')
        ? relative
        : relative + '.ts'
    );
    if (loaded.has(filename)) return loaded.get(filename).exports;
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    const module = { exports: {} };
    loaded.set(filename, module);
    const require = (specifier) => {
      if (Object.hasOwn(modules, specifier)) return modules[specifier];
      return specifier.startsWith('.')
        ? load(path.resolve(path.dirname(filename), specifier))
        : requireNode(specifier);
    };
    new Function('require', 'module', 'exports', code)(
      require,
      module,
      module.exports
    );
    return module.exports;
  };
  return load;
}
