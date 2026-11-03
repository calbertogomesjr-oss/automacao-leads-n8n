// Servidor do agente: recebe pedidos do n8n, roda o agente de código no projeto,
// publica o site e gera o APK. Sem dependências externas (Node 22+).
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { access, appendFile, cp, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

export function lerConfig(env = process.env) {
  return {
    porta: Number(env.PORTA ?? 3100),
    token: env.TOKEN ?? '',
    agente: (env.AGENTE ?? 'claude').toLowerCase(),
    modelo: env.MODELO ?? '',
    projetoDir: env.PROJETO_DIR ?? '/dados/projeto',
    publicoDir: env.PUBLICO_DIR ?? '/dados/publicado',
    templateDir: env.TEMPLATE_DIR ?? path.join(AQUI, 'template'),
    urlPublica: (env.URL_PUBLICA ?? `http://localhost:${env.PORTA ?? 3100}`).replace(/\/+$/, ''),
    tempoLimiteMs: Number(env.TEMPO_LIMITE_MIN ?? 15) * 60_000,
    limiteDiario: Number(env.LIMITE_DIARIO ?? 30),
    filaMaxima: Number(env.FILA_MAXIMA ?? 3),
    tarefasPorSessao: Number(env.TAREFAS_POR_SESSAO ?? 15),
    claudeBin: env.CLAUDE_BIN ?? 'claude',
    codexBin: env.CODEX_BIN ?? 'codex',
    // Vazio desativa o APK (útil em testes ou se só quiser o site).
    cmdApk: env.CMD_APK ?? path.join(AQUI, 'build-apk.sh'),
  };
}

export function executar(cmd, args, { cwd, env, timeoutMs = 0, entrada } = {}) {
  return new Promise((resolve) => {
    const filho = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let saida = '';
    let erro = '';
    let estourou = false;
    const timer = timeoutMs > 0 ? setTimeout(() => { estourou = true; filho.kill('SIGTERM'); setTimeout(() => filho.kill('SIGKILL'), 5000); }, timeoutMs) : null;
    filho.stdout.on('data', (d) => { saida += d; });
    filho.stderr.on('data', (d) => { erro += d; });
    filho.on('error', (e) => { erro += String(e); });
    filho.on('close', (codigo) => {
      if (timer) clearTimeout(timer);
      resolve({ codigo: estourou ? -1 : codigo, saida, erro, estourou });
    });
    if (entrada) filho.stdin.write(entrada);
    filho.stdin.end();
  });
}

const git = (cfg, ...args) => executar('git', ['-c', 'user.name=Agente', '-c', 'user.email=agente@localhost', ...args], { cwd: cfg.projetoDir });

async function existe(p) {
  try { await access(p); return true; } catch { return false; }
}

const ARQUIVOS_DO_APP = ['www', 'capacitor.config.json', 'package.json'];

const AJUDA = [
  'Modo app ligado ✅',
  '',
  'Pode me pedir qualquer mudança no site e no app, do seu jeito. Exemplos:',
  '• "Coloca minha foto e um texto sobre mim na página inicial"',
  '• "Adiciona uma receita de pão sem glúten"',
  '• "Muda as cores para tons de lilás"',
  '',
  'Comandos rápidos:',
  '• *link*: manda o link do site e do app',
  '• *desfazer*: volta a última mudança',
  '• *apk*: gera o app de novo',
  '• *sair*: volta a conversar normal',
].join('\n');

export function criarAgente(cfg) {
  const estadoArq = () => path.join(path.dirname(cfg.projetoDir), 'estado.json');
  let fila = Promise.resolve();
  let pendentes = 0;

  async function lerEstado() {
    try { return JSON.parse(await readFile(estadoArq(), 'utf8')); } catch { return {}; }
  }
  async function salvarEstado(estado) {
    await writeFile(estadoArq(), JSON.stringify(estado, null, 2));
  }

  const links = () => ({
    siteUrl: `${cfg.urlPublica}/`,
    apkUrl: `${cfg.urlPublica}/app.apk?v=${Date.now()}`,
  });

  async function preparar() {
    await mkdir(cfg.publicoDir, { recursive: true });
    if (!(await existe(path.join(cfg.projetoDir, '.git')))) {
      await mkdir(cfg.projetoDir, { recursive: true });
      await cp(cfg.templateDir, cfg.projetoDir, { recursive: true });
      await git(cfg, 'init', '-q', '-b', 'main');
      await git(cfg, 'add', '-A');
      await git(cfg, 'commit', '-q', '-m', 'Projeto inicial');
    }
    if (!(await existe(path.join(cfg.publicoDir, 'site')))) await publicarSite();
    if (cfg.agente === 'codex' && process.env.OPENAI_API_KEY) {
      await executar(cfg.codexBin, ['login', '--with-api-key'], { entrada: process.env.OPENAI_API_KEY });
    }
  }

  async function publicarSite() {
    const destino = path.join(cfg.publicoDir, 'site');
    const temp = `${destino}.novo`;
    await rm(temp, { recursive: true, force: true });
    await cp(path.join(cfg.projetoDir, 'www'), temp, { recursive: true });
    await rm(destino, { recursive: true, force: true });
    await rename(temp, destino);
  }

  async function gerarApk() {
    if (!cfg.cmdApk) return { ok: false, motivo: 'desativado' };
    const r = await executar(cfg.cmdApk, [], {
      cwd: cfg.projetoDir,
      env: { PROJETO_DIR: cfg.projetoDir, PUBLICO_DIR: cfg.publicoDir },
      timeoutMs: cfg.tempoLimiteMs,
    });
    if (r.codigo !== 0) console.error('[apk] falhou:', r.erro.slice(-3000) || r.saida.slice(-3000));
    return { ok: r.codigo === 0 };
  }

  async function rodarAgente(mensagem, nome, estado) {
    const prompt = [
      `Novo pedido da nutricionista pelo WhatsApp${nome ? ` (${nome})` : ''}:`,
      '"""',
      mensagem,
      '"""',
      'Siga as instruções do AGENTS.md. Ao terminar, responda apenas com a mensagem que vai para ela no WhatsApp.',
    ].join('\n');

    if (cfg.agente === 'codex') {
      const arqResposta = path.join(path.dirname(cfg.projetoDir), 'ultima-resposta.txt');
      await rm(arqResposta, { force: true });
      const args = ['exec', '--skip-git-repo-check', '--dangerously-bypass-approvals-and-sandbox', '-C', cfg.projetoDir, '-o', arqResposta];
      if (cfg.modelo) args.push('-m', cfg.modelo);
      args.push(prompt);
      const r = await executar(cfg.codexBin, args, { cwd: cfg.projetoDir, timeoutMs: cfg.tempoLimiteMs });
      const resposta = await readFile(arqResposta, 'utf8').catch(() => '');
      return { ok: r.codigo === 0 && resposta.trim() !== '', resposta: resposta.trim(), log: r.erro };
    }

    // Claude Code: continua a sessão anterior para lembrar do contexto.
    const continuar = estado.sessaoClaude && (estado.tarefasNaSessao ?? 0) < cfg.tarefasPorSessao;
    const montar = (comSessao) => {
      const args = ['-p', prompt, '--output-format', 'json', '--dangerously-skip-permissions'];
      if (cfg.modelo) args.push('--model', cfg.modelo);
      if (comSessao) args.push('--resume', estado.sessaoClaude);
      return args;
    };
    let r = await executar(cfg.claudeBin, montar(continuar), { cwd: cfg.projetoDir, timeoutMs: cfg.tempoLimiteMs });
    if (r.codigo !== 0 && continuar && !r.estourou) {
      // Sessão antiga pode ter expirado: tenta do zero.
      r = await executar(cfg.claudeBin, montar(false), { cwd: cfg.projetoDir, timeoutMs: cfg.tempoLimiteMs });
    }
    let json = {};
    try { json = JSON.parse(r.saida); } catch { /* saída inválida */ }
    if (json.session_id) {
      estado.tarefasNaSessao = json.session_id === estado.sessaoClaude ? (estado.tarefasNaSessao ?? 0) + 1 : 1;
      estado.sessaoClaude = json.session_id;
    }
    const resposta = String(json.result ?? '').trim();
    return { ok: r.codigo === 0 && !json.is_error && resposta !== '', resposta, log: r.erro || r.saida.slice(-2000) };
  }

  async function processarPedido(mensagem, nome) {
    const texto = String(mensagem ?? '').trim();
    const comando = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[!.?]+$/, '');

    if (!texto) return { resposta: 'Não consegui ler sua mensagem. Pode mandar de novo por texto?' };
    if (['ajuda', 'menu', 'oi', 'ola'].includes(comando)) return { resposta: AJUDA };
    if (comando === 'sair') return { resposta: 'Combinado, saí do modo app 👋 Quando quiser mexer no app, é só mandar *#app*.' };
    if (comando === 'link' || comando === 'links') {
      const l = links();
      return { resposta: `Site: ${l.siteUrl}\nApp Android: ${l.apkUrl}`, ...l };
    }
    if (comando === 'apk') {
      const apk = await gerarApk();
      return apk.ok
        ? { resposta: 'Pronto, aqui está o app atualizado 📱', enviarApk: true, ...links() }
        : { resposta: 'Não consegui gerar o app agora. O site continua no ar.', ...links() };
    }
    if (comando === 'desfazer') {
      // Volta a última mudança no app que ainda não foi desfeita, mantendo o histórico da conversa.
      const estado = await lerEstado();
      estado.desfeitos = estado.desfeitos ?? [];
      const log = await git(cfg, 'log', '--format=%H%x09%s', '--', ...ARQUIVOS_DO_APP);
      const alvo = log.saida.trim().split('\n').filter(Boolean).map((l) => l.split('\t'))
        .find(([sha, assunto]) => assunto.startsWith('Pedido:') && !estado.desfeitos.includes(sha));
      if (!alvo) return { resposta: 'Não tem nenhuma mudança para desfazer.' };
      const [sha, assunto] = alvo;
      await git(cfg, 'checkout', `${sha}~1`, '--', ...ARQUIVOS_DO_APP);
      await appendFile(path.join(cfg.projetoDir, 'HISTORICO.md'), `\n**Desfeito a pedido dela:** ${assunto.replace(/^Pedido: /, '')}\n`);
      await git(cfg, 'add', '-A');
      await git(cfg, 'commit', '-q', '-m', `Desfazer: ${assunto}`);
      estado.desfeitos.push(sha);
      await salvarEstado(estado);
      await publicarSite();
      const apk = await gerarApk();
      return { resposta: 'Desfiz a última mudança ↩️', enviarApk: apk.ok, ...links() };
    }

    const estado = await lerEstado();
    const dia = new Date().toISOString().slice(0, 10);
    if (estado.dia !== dia) { estado.dia = dia; estado.usados = 0; }
    if (estado.usados >= cfg.limiteDiario) {
      return { resposta: 'Por hoje já fiz o máximo de mudanças combinado. Amanhã eu continuo! 😊' };
    }
    estado.usados += 1;

    const resultado = await rodarAgente(texto, nome, estado);
    await salvarEstado(estado);

    if (!resultado.ok) {
      console.error('[agente] falhou:', resultado.log);
      await git(cfg, 'reset', '-q', '--hard', 'HEAD');
      await git(cfg, 'clean', '-q', '-fd');
      return { resposta: 'Tive um probleminha para fazer isso 😕 Pode tentar de novo, talvez explicando de outro jeito?' };
    }

    const mudouApp = (await git(cfg, 'status', '--porcelain', '--', ...ARQUIVOS_DO_APP)).saida.trim() !== '';
    const data = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    await appendFile(
      path.join(cfg.projetoDir, 'HISTORICO.md'),
      `\n## ${data}\n**Pedido:** ${texto}\n\n**Resposta:** ${resultado.resposta}\n`,
    );
    await git(cfg, 'add', '-A');
    await git(cfg, 'commit', '-q', '-m', `Pedido: ${texto.slice(0, 72)}`);

    if (!mudouApp) return { resposta: resultado.resposta };

    await publicarSite();
    const apk = await gerarApk();
    let resposta = resultado.resposta;
    if (cfg.cmdApk && !apk.ok) resposta += '\n\n(O site já está atualizado. O app Android não saiu desta vez; mande *apk* para eu tentar de novo.)';
    return { resposta, enviarApk: apk.ok, ...links() };
  }

  // Executa um pedido por vez, na ordem em que chegaram.
  function enfileirar(mensagem, nome) {
    if (pendentes >= cfg.filaMaxima) {
      return Promise.resolve({ resposta: 'Ainda estou trabalhando nos pedidos anteriores. Me manda esse de novo daqui a pouquinho 🙏' });
    }
    pendentes += 1;
    const tarefa = fila.then(() => processarPedido(mensagem, nome));
    fila = tarefa.catch(() => {}).finally(() => { pendentes -= 1; });
    return tarefa;
  }

  // Gera o primeiro APK em segundo plano, se ainda não existir.
  async function gerarApkInicial() {
    if (!cfg.cmdApk || (await existe(path.join(cfg.publicoDir, 'app.apk')))) return;
    pendentes += 1;
    fila = fila.then(gerarApk).catch(() => {}).finally(() => { pendentes -= 1; });
  }

  return { preparar, enfileirar, publicarSite, gerarApkInicial };
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.apk': 'application/vnd.android.package-archive',
};

async function servirArquivo(res, raiz, caminhoUrl) {
  const relativo = decodeURIComponent(caminhoUrl).replace(/^\/+/, '');
  let arquivo = path.resolve(raiz, relativo);
  if (arquivo !== raiz && !arquivo.startsWith(raiz + path.sep)) return false;
  try {
    let info = await stat(arquivo);
    if (info.isDirectory()) {
      arquivo = path.join(arquivo, 'index.html');
      info = await stat(arquivo);
    }
    const ext = path.extname(arquivo).toLowerCase();
    const cabecalhos = {
      'Content-Type': TIPOS[ext] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
    };
    if (ext === '.apk') cabecalhos['Content-Disposition'] = 'attachment; filename="app.apk"';
    res.writeHead(200, cabecalhos);
    createReadStream(arquivo).pipe(res);
    return true;
  } catch {
    return false;
  }
}

function lerCorpo(req, limite = 100_000) {
  return new Promise((resolve, reject) => {
    let corpo = '';
    req.on('data', (d) => {
      corpo += d;
      if (corpo.length > limite) { reject(new Error('corpo grande demais')); req.destroy(); }
    });
    req.on('end', () => resolve(corpo));
    req.on('error', reject);
  });
}

export function criarServidor(cfg, agente) {
  const json = (res, status, dados) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(dados));
  };

  return createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    try {
      if (req.method === 'GET' && url.pathname === '/saude') return json(res, 200, { ok: true, agente: cfg.agente });

      if (url.pathname === '/tarefa') {
        if (req.method !== 'POST') return json(res, 405, { erro: 'Use POST' });
        if (!cfg.token || req.headers.authorization !== `Bearer ${cfg.token}`) return json(res, 401, { erro: 'Não autorizado' });
        const corpo = JSON.parse((await lerCorpo(req)) || '{}');
        const resultado = await agente.enfileirar(corpo.mensagem, corpo.nome);
        return json(res, 200, { enviarApk: false, ...resultado });
      }

      if (req.method === 'GET' && url.pathname === '/app.apk') {
        if (await servirArquivo(res, path.resolve(cfg.publicoDir), 'app.apk')) return;
        return json(res, 404, { erro: 'O app ainda não foi gerado' });
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        if (await servirArquivo(res, path.resolve(cfg.publicoDir, 'site'), url.pathname)) return;
      }
      json(res, 404, { erro: 'Não encontrado' });
    } catch (e) {
      console.error('[servidor]', e);
      if (!res.headersSent) json(res, 500, { erro: 'Erro interno' });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const cfg = lerConfig();
  if (!cfg.token) {
    console.error('Defina TOKEN no .env (uma senha longa compartilhada com o n8n).');
    process.exit(1);
  }
  const agente = criarAgente(cfg);
  await agente.preparar();
  await agente.gerarApkInicial();
  criarServidor(cfg, agente).listen(cfg.porta, () => {
    console.log(`Agente (${cfg.agente}) ouvindo na porta ${cfg.porta}. Site: ${cfg.urlPublica}/`);
  });
}
