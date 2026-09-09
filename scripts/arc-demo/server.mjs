import Fastify from 'fastify';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, existsSync, lstatSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createDemoService } from './service.mjs';
import { readSecret } from './read-secret.mjs';

export function buildDemoServer(service, { port = 8787, csrf = randomBytes(24).toString('hex') } = {}) {
  const app = Fastify({ logger: false, bodyLimit: 2048 });
  const origins = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  app.addHook('onRequest', async (request, reply) => {
    if (!origins.some(origin => new URL(origin).host === request.headers.host)) return reply.code(403).send({ error: 'Local requests only.' });
    if (request.headers.origin && !origins.includes(request.headers.origin)) return reply.code(403).send({ error: 'Origin rejected.' });
    if (request.method === 'POST') {
      const token = request.headers['x-demo-token'];
      if (typeof token !== 'string' || token.length !== csrf.length || !timingSafeEqual(Buffer.from(token), Buffer.from(csrf))) return reply.code(403).send({ error: 'Request token required.' });
    }
  });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    reply.header('X-Content-Type-Options', 'nosniff');
  });
  for (const [path, file, type] of [['/', 'index.html', 'text/html'], ['/ui.js', 'ui.js', 'text/javascript'], ['/style.css', 'style.css', 'text/css']]) {
    app.get(path, async (_request, reply) => reply.type(type).send(readFileSync(new URL(`public/${file}`, import.meta.url), 'utf8')));
  }
  app.get('/api/state', async () => ({ ...await service.refresh(), csrf }));
  app.post('/api/message', async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== 'object' || typeof body.text !== 'string' || body.text.length > 300
      || (body.previewId !== undefined && body.previewId !== null && typeof body.previewId !== 'string')
      || Object.keys(body).some(k => !['text', 'previewId'].includes(k))) return reply.code(400).send({ error: 'Invalid message.' });
    return service.message(body.text, body.previewId);
  });
  app.setErrorHandler((_error, _request, reply) => reply.code(500).send({ error: 'No pude completar la consulta. Verificá el estado antes de repetir un envío.' }));
  return app;
}

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Local demo only.');
  const directory = fileURLToPath(new URL('../../.local/arc-demo/', import.meta.url));
  const secretPath = existsSync(`${directory}/runtime.json`) ? `${directory}/runtime.json` : `${directory}/provisioning.json`;
  for (const path of [directory, secretPath, ...[`${directory}/demo.json`].filter(existsSync)]) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || (stat.mode & 0o077)) throw new Error('Private local setup required.');
  }
  const apiKey = await readSecret('Pegá la API key de test y presioná Enter (no se muestra ni se guarda en disco):');
  if (!/^TEST_API_KEY:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/.test(apiKey)) throw new Error('Test key required.');
  const provisioning = JSON.parse(readFileSync(secretPath, 'utf8'));
  const config = JSON.parse(readFileSync(new URL('config.json', import.meta.url), 'utf8'));
  if (!/^[a-fA-F0-9]{64}$/.test(provisioning.entitySecret ?? '')) throw new Error('Complete setup first.');
  const lockPath = `${directory}/web.lock`;
  const lock = openSync(lockPath, 'wx', 0o600);
  process.umask(0o077);
  const statePath = `${directory}/demo.json`;
  const store = {
    read: () => existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : null,
    write(value) {
      const temp = `${statePath}.${randomUUID()}.tmp`;
      writeFileSync(temp, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
      renameSync(temp, statePath);
    },
  };
  const { initiateDeveloperControlledWalletsClient } = await import('@circle-fin/developer-controlled-wallets');
  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret: provisioning.entitySecret });
  const service = createDemoService({ client, store, senderId: config.senderId,
    recipientId: config.recipientId, recipientAddress: config.recipientAddress });
  const app = buildDemoServer(service);
  app.addHook('onClose', async () => { closeSync(lock); unlinkSync(lockPath); });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
  try { await app.listen({ host: '127.0.0.1', port: 8787 }); }
  catch { await app.close(); throw new Error('Could not start local demo.'); }
  console.log('Nani demo escrita: http://127.0.0.1:8787');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error('No se pudo iniciar la demo. Revisá el setup privado y que el puerto 8787 esté libre.'); process.exitCode = 1; });
}
