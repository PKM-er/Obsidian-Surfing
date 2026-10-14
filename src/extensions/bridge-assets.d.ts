/** Files main.js carries for the plugin folder (see esbuild.config.mjs), by relative path. */
declare module 'bridge-assets' {
  const files: Record<string, string>;
  export default files;
}
