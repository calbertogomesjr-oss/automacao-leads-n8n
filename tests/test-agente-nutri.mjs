import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// ---------- Workflow n8n ----------
const workflow = JSON.parse(await readFile(path.join(raiz, 'workflows/agente-nutri-whatsapp.json'), 'utf8'));
const nomes = new Set(workflow.nodes.map((n) => n.name));
assert.equal(nomes.size, workflow.nodes.length, 'Nomes de nós devem ser únicos.');
for (const [origem, { main }] of Object.entries(workflow.connections)) {
  assert.ok(nomes.has(origem), `Conexão sai de nó inexistente: ${origem}`);
  for (const saida of main) for (const c of saida) assert.ok(nomes.has(c.node), `Conexão para nó inexistente: ${c.node}`);
}

const codigo = workflow.nodes.find((n) => n.name === 'Filtrar e extrair').parameters.jsCode;
const memoria = {};
const filtrar = (body, extra = {}) => new Function('$json', '$getWorkflowStaticData', codigo)(
  { body, numerosPermitidos: '5547999998888', prefixo: '#app', minutosModoApp: '30', evolutionUrl: 'https://evo.test/', instancia: 'inst', agenteUrl: 'http://agente:3100', ...extra },
  () => memoria,
);
const msg = (texto, key = {}) => ({
  event: 'messages.upsert',
  data: { key: { remoteJid: '5547999998888@s.whatsapp.net', fromMe: false, id: 'ABC', ...key }, pushName: 'Ana', message: { conversation: texto } },
});

assert.deepEqual(filtrar(msg('oi, tudo bem? vamos almoçar?')), [], 'Conversa pessoal fora do modo app é ignorada.');
let [item] = filtrar(msg('#app muda a cor para lilás'));
assert.equal(item.json.texto, 'muda a cor para lilás');
assert.equal(item.json.responderPara, '5547999998888');
assert.equal(item.json.evolutionUrl, 'https://evo.test');
assert.equal(item.json.rapido, false);
[item] = filtrar(msg('e aumenta a fonte'));
assert.equal(item.json.texto, 'e aumenta a fonte', 'Dentro do modo app, não precisa repetir o prefixo.');
[item] = filtrar({ event: 'messages.upsert', data: { key: { remoteJid: '5547999998888@s.whatsapp.net', id: 'X' }, message: { audioMessage: {} } } });
assert.equal(item.json.tipo, 'audio', 'Áudio no modo app é aceito.');
[item] = filtrar(msg('Sair'));
assert.equal(item.json.rapido, true);
assert.deepEqual(filtrar(msg('depois te ligo')), [], 'Depois de sair, volta a ignorar.');
assert.deepEqual(filtrar({ event: 'messages.upsert', data: { key: { remoteJid: '5547999998888@s.whatsapp.net', id: 'Y' }, message: { audioMessage: {} } } }), [], 'Áudio pessoal não é processado.');
[item] = filtrar(msg('#app'));
assert.equal(item.json.texto, 'ajuda', 'Só o prefixo mostra a ajuda.');
assert.deepEqual(filtrar(msg('#app oi', { fromMe: true })), [], 'Mensagens enviadas por você são ignoradas.');
assert.deepEqual(filtrar(msg('#app oi', { remoteJid: '5511911112222@s.whatsapp.net' })), [], 'Outros números são ignorados.');
assert.deepEqual(filtrar(msg('#app oi', { remoteJid: '120363@g.us' })), [], 'Grupos são ignorados.');
assert.equal(filtrar(msg('#app oi', { remoteJid: '554799998888@s.whatsapp.net' })).length, 1, 'Número sem o nono dígito é reconhecido.');
assert.equal(filtrar(msg('#app oi', { remoteJid: '123456@lid', senderPn: '5547999998888@s.whatsapp.net' })).length, 1, 'Endereço @lid usa o senderPn.');
assert.deepEqual(filtrar({ event: 'connection.update', data: {} }), [], 'Outros eventos são ignorados.');

// ---------- Verificador de rótulos do app ----------
const { verificarRotulo } = require(path.join(raiz, 'agente-nutri/template/www/app.js'));
const grupos = (t) => verificarRotulo(t).map((a) => a.grupo.split(' ')[0]);
assert.deepEqual(grupos('farinha de trigo, açúcar'), ['Glúten']);
assert.deepEqual(grupos('farinha de trigo sarraceno, sal'), []);
assert.deepEqual(grupos('EXTRATO DE MALTE'), ['Glúten']);
assert.deepEqual(grupos('maltodextrina, sal'), []);
assert.deepEqual(grupos('NÃO CONTÉM GLÚTEN. leite de coco'), []);
assert.deepEqual(grupos('soro de leite em pó'), ['Lactose']);
assert.deepEqual(grupos('flocos de aveia'), ['Aveia']);

// ---------- Servidor do agente ----------
const tmp = await mkdtemp(path.join(tmpdir(), 'agente-nutri-'));
const agenteFalso = path.join(tmp, 'claude-falso.mjs');
await writeFile(agenteFalso, `#!/usr/bin/env node
import { appendFileSync } from 'node:fs';
const args = process.argv.slice(2);
const prompt = args[args.indexOf('-p') + 1];
appendFileSync(${JSON.stringify(path.join(tmp, 'chamadas.log'))}, JSON.stringify(args) + '\\n');
if (prompt.includes('QUEBRAR')) { appendFileSync('www/index.html', '<!-- quebrado -->'); process.exit(1); }
if (prompt.includes('PERGUNTA')) { console.log(JSON.stringify({ result: 'Qual cor você prefere?', session_id: 's1', is_error: false })); process.exit(0); }
appendFileSync('www/index.html', '<!-- mudanca -->');
console.log(JSON.stringify({ result: 'Pronto, mudei a cor! 🎨', session_id: 's1', is_error: false }));
`);
const apkFalso = path.join(tmp, 'apk-falso.sh');
await writeFile(apkFalso, '#!/bin/sh\necho APK > "$PUBLICO_DIR/app.apk"\n');
await chmod(agenteFalso, 0o755);
await chmod(apkFalso, 0o755);

const { lerConfig, criarAgente, criarServidor } = await import(path.join(raiz, 'agente-nutri/builder/server.mjs'));
const cfg = lerConfig({
  TOKEN: 'segredo',
  PROJETO_DIR: path.join(tmp, 'projeto'),
  PUBLICO_DIR: path.join(tmp, 'publicado'),
  TEMPLATE_DIR: path.join(raiz, 'agente-nutri/template'),
  URL_PUBLICA: 'https://nutri.test/',
  CLAUDE_BIN: agenteFalso,
  CMD_APK: apkFalso,
  LIMITE_DIARIO: '3',
});
const agente = criarAgente(cfg);
await agente.preparar();
const servidor = criarServidor(cfg, agente).listen(0);
await new Promise((r) => servidor.once('listening', r));
const base = `http://127.0.0.1:${servidor.address().port}`;

const pedir = async (mensagem, token = 'segredo') => {
  const r = await fetch(`${base}/tarefa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ mensagem, nome: 'Ana' }),
  });
  return { status: r.status, corpo: await r.json() };
};

try {
  assert.equal((await pedir('oi', 'errado')).status, 401, 'Token errado é recusado.');
  assert.match((await pedir('ajuda')).corpo.resposta, /desfazer/);

  const siteInicial = await (await fetch(`${base}/`)).text();
  assert.match(siteInicial, /Comer bem, com segurança/, 'Site inicial publicado.');

  let r = await pedir('muda a cor para lilás');
  assert.equal(r.corpo.resposta, 'Pronto, mudei a cor! 🎨');
  assert.equal(r.corpo.enviarApk, true);
  assert.equal(r.corpo.siteUrl, 'https://nutri.test/');
  assert.match(r.corpo.apkUrl, /^https:\/\/nutri\.test\/app\.apk\?v=\d+$/);
  assert.match(await (await fetch(`${base}/`)).text(), /<!-- mudanca -->/, 'Site publicado com a mudança.');
  const apk = await fetch(`${base}/app.apk`);
  assert.equal(apk.headers.get('content-type'), 'application/vnd.android.package-archive');
  const historico = await readFile(path.join(cfg.projetoDir, 'HISTORICO.md'), 'utf8');
  assert.match(historico, /muda a cor para lilás/, 'Pedido registrado no histórico.');

  r = await pedir('PERGUNTA');
  assert.equal(r.corpo.resposta, 'Qual cor você prefere?');
  assert.equal(r.corpo.enviarApk, false, 'Sem mudança no site, não reenvia o APK.');

  r = await pedir('QUEBRAR tudo');
  assert.match(r.corpo.resposta, /probleminha/);
  const depoisDaFalha = await readFile(path.join(cfg.projetoDir, 'www/index.html'), 'utf8');
  assert.doesNotMatch(depoisDaFalha, /quebrado/, 'Falha do agente desfaz as alterações pela metade.');

  const chamadas = (await readFile(path.join(tmp, 'chamadas.log'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(!chamadas[0].includes('--resume'), 'Primeira chamada começa sessão nova.');
  assert.ok(chamadas[1].includes('--resume') && chamadas[1].includes('s1'), 'Chamadas seguintes continuam a sessão.');
  assert.ok(chamadas[0].includes('--dangerously-skip-permissions'));

  r = await pedir('desfazer');
  assert.match(r.corpo.resposta, /Desfiz/);
  assert.doesNotMatch(await (await fetch(`${base}/`)).text(), /<!-- mudanca -->/, 'Desfazer volta o site.');
  assert.match(await readFile(path.join(cfg.projetoDir, 'HISTORICO.md'), 'utf8'), /Qual cor você prefere/, 'Desfazer mantém o histórico da conversa.');
  r = await pedir('desfazer');
  assert.match(r.corpo.resposta, /nenhuma mudança/, 'Não desfaz o que já foi desfeito nem o projeto inicial.');

  r = await pedir('mais uma mudança');
  assert.match(r.corpo.resposta, /máximo de mudanças/, 'Limite diário respeitado.');

  assert.equal((await fetch(`${base}/../../etc/passwd`)).status, 404);
  assert.equal((await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`)).status, 404, 'Não sai da pasta do site.');
} finally {
  servidor.close();
  await rm(tmp, { recursive: true, force: true });
}

console.log('Testes do agente nutri concluídos: workflow, rótulos e servidor.');
