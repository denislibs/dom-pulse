import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const common = { bundle: true, sourcemap: true, target: ['es2020'], logLevel: 'info' };
const iife = { ...common, entryPoints: ['src/iife.ts'], format: 'iife', outfile: 'dist/dom-pulse.js', minify: !watch };
const esm = { ...common, entryPoints: ['src/index.ts'], format: 'esm', outfile: 'dist/dom-pulse.esm.js' };

if (watch) {
  const ctxIife = await esbuild.context(iife);
  const ctxEsm = await esbuild.context(esm);
  await ctxEsm.watch();
  await ctxIife.watch();
  const { host, port } = await ctxIife.serve({ servedir: '.', port: 8765 });
  console.log(`demo: http://${host}:${port}/demo/`);
} else {
  await Promise.all([esbuild.build(iife), esbuild.build(esm)]);
}
