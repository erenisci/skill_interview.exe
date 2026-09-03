/**
 * Ambient declarations for Vite's `?raw` imports.
 *
 * `vite/client` already declares these, but it is only listed in `tsconfig.node.json`.
 * An editor resolving a file against the root `tsconfig.json` does not load it and marks
 * every `?raw` import as an unresolved module, even though `tsc` is perfectly happy.
 *
 * Declaring them here fixes the editor without making the build depend on which config
 * happens to be picked up.
 */

declare module '*.sql?raw' {
  const content: string;
  export default content;
}

declare module '*.md?raw' {
  const content: string;
  export default content;
}
