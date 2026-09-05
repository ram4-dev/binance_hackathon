import { mkdirSync, writeFileSync, lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readSecret } from './read-secret.mjs';

try {
  const secret = await readSecret('Pegá el entity secret existente de Circle y presioná Enter (no se muestra):');
  if (!/^[a-fA-F0-9]{64}$/.test(secret)) throw new Error('Invalid entity secret.');
  const directory = fileURLToPath(new URL('../../.local/arc-demo/', import.meta.url));
  process.umask(0o077);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('Private directory required.');
  writeFileSync(`${directory}/runtime.json`, JSON.stringify({ entitySecret: secret }), { flag: 'wx', mode: 0o600 });
  console.log('Configuración privada guardada. Ejecutá npm run demo:arc. No se creó ni rotó ningún secreto en Circle.');
} catch {
  console.error('No se guardó la configuración. Revisá el formato y que runtime.json no exista ya. No se sobreescriben secretos.');
  process.exitCode = 1;
}
