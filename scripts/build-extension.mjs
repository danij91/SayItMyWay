import {fileURLToPath} from 'node:url';
import {buildExtension} from './extension-build.mjs';

try {
  const output = await buildExtension(fileURLToPath(new URL('../', import.meta.url)));
  console.log(`Production extension built: ${output}`);
  console.log('Load this directory as an unpacked extension or package its contents for distribution.');
} catch (error) {
  console.error(`Cannot build production extension: ${error.message}`);
  process.exitCode = 1;
}
