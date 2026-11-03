'use strict';

// Configuração editável pela nutricionista (via agente).
const CONFIG = {
  // Número com DDI e DDD, só dígitos. Ex.: 5547999999999
  whatsappAgendamento: '',
  mensagemAgendamento: 'Olá! Vim pelo app e gostaria de agendar uma consulta.',
};

const FILTROS = [
  { id: 'sem-gluten', nome: 'Sem glúten' },
  { id: 'sem-lactose', nome: 'Sem lactose' },
  { id: 'vegana', nome: 'Vegana' },
  { id: 'baixo-carbo', nome: 'Baixo carboidrato' },
];

// Receitas de exemplo: substituir pelas receitas da nutricionista.
const RECEITAS = [
  {
    nome: 'Crepioca simples',
    tags: ['sem-gluten', 'sem-lactose'],
    ingredientes: ['1 ovo', '2 colheres (sopa) de goma de tapioca', 'Sal a gosto', 'Recheio a gosto (frango, tomate, folhas)'],
    preparo: ['Bata o ovo com a tapioca e o sal.', 'Despeje em frigideira antiaderente aquecida.', 'Doure os dois lados, recheie e dobre.'],
  },
  {
    nome: 'Omelete de legumes',
    tags: ['sem-gluten', 'sem-lactose', 'baixo-carbo'],
    ingredientes: ['2 ovos', '1/2 abobrinha ralada', '1/2 tomate picado', 'Cheiro-verde e sal a gosto'],
    preparo: ['Bata os ovos e misture os legumes e temperos.', 'Cozinhe em frigideira untada, com tampa, em fogo baixo.', 'Vire com cuidado e sirva.'],
  },
  {
    nome: 'Salada de grão-de-bico',
    tags: ['sem-gluten', 'sem-lactose', 'vegana'],
    ingredientes: ['1 xícara de grão-de-bico cozido', 'Tomate, pepino e cebola roxa picados', 'Azeite, limão e sal a gosto'],
    preparo: ['Misture todos os ingredientes.', 'Tempere e deixe 10 minutos na geladeira antes de servir.'],
  },
  {
    nome: 'Bolo de banana com farinha de arroz',
    tags: ['sem-gluten', 'sem-lactose'],
    ingredientes: ['3 bananas maduras', '3 ovos', '1/3 xícara de óleo', '1 1/2 xícara de farinha de arroz', '1 colher (sopa) de fermento em pó', 'Canela a gosto'],
    preparo: ['Bata bananas, ovos e óleo.', 'Misture a farinha e a canela, e por último o fermento.', 'Asse em forma untada a 180 °C por cerca de 35 minutos.'],
    observacao: 'Confira se o fermento é sem glúten e se a farinha não tem risco de contaminação cruzada.',
  },
  {
    nome: 'Iogurte natural com frutas',
    tags: ['sem-gluten'],
    ingredientes: ['1 pote de iogurte natural', 'Frutas picadas a gosto', 'Sementes de chia (opcional)'],
    preparo: ['Monte em camadas e sirva gelado.'],
    observacao: 'Contém lactose. Para quem é intolerante, use iogurte sem lactose.',
  },
];

// Termos procurados no verificador de rótulos.
const ALERTAS_ROTULO = [
  {
    grupo: 'Glúten',
    nivel: 'alerta',
    // Trigo sarraceno não tem glúten (não é trigo).
    ignorar: ['trigo sarraceno', 'trigo-sarraceno'],
    termos: ['trigo', 'centeio', 'cevada', 'malte', 'triticale', 'espelta', 'semolina', 'sêmola', 'farinha de rosca', 'cuscuz marroquino', 'seitan', 'contém glúten'],
  },
  {
    grupo: 'Aveia (risco de glúten por contaminação cruzada, exceto se certificada sem glúten)',
    nivel: 'atencao',
    termos: ['aveia'],
  },
  {
    grupo: 'Lactose / leite',
    nivel: 'alerta',
    ignorar: ['leite de coco', 'leite de amendoas', 'leite de castanha', 'leite de aveia', 'leite de arroz', 'leite de soja', 'leite vegetal', 'sem lactose', 'zero lactose'],
    termos: ['leite', 'lactose', 'soro de leite', 'whey', 'creme de leite', 'manteiga', 'queijo', 'requeijão', 'caseína', 'caseinato', 'lactoalbumina', 'contém lactose'],
  },
];

const ARMAZENAMENTO = 'nutri-diario-v1';

function normalizar(texto) {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function verificarRotulo(texto) {
  const base = normalizar(texto);
  return ALERTAS_ROTULO
    .map((item) => {
      const alvo = (item.ignorar ?? []).reduce((t, ign) => t.split(normalizar(ign)).join(' '), base);
      return {
      ...item,
      encontrados: item.termos.filter((termo) => {
        const t = normalizar(termo);
        if (!alvo.includes(t)) return false;
        // "não contém glúten" / "não contém lactose" não é alerta.
        if (t.startsWith('contem ')) return !alvo.includes(`nao ${t}`);
        return true;
      }),
      };
    })
    .filter((item) => item.encontrados.length > 0);
}

// ---------- Navegação ----------
function irPara(pagina) {
  document.querySelectorAll('.pagina').forEach((s) => s.classList.toggle('ativa', s.dataset.pagina === pagina));
  document.querySelectorAll('.abas button').forEach((b) => b.classList.toggle('ativa', b.dataset.ir === pagina));
  window.scrollTo(0, 0);
  if (location.hash !== `#${pagina}`) history.replaceState(null, '', `#${pagina}`);
}

// ---------- Receitas ----------
const filtrosAtivos = new Set();

function desenharFiltros() {
  const caixa = document.getElementById('filtros');
  caixa.innerHTML = '';
  FILTROS.forEach((f) => {
    const b = document.createElement('button');
    b.className = 'filtro';
    b.textContent = f.nome;
    b.setAttribute('aria-pressed', String(filtrosAtivos.has(f.id)));
    b.addEventListener('click', () => {
      if (filtrosAtivos.has(f.id)) filtrosAtivos.delete(f.id); else filtrosAtivos.add(f.id);
      desenharFiltros();
      desenharReceitas();
    });
    caixa.append(b);
  });
}

function desenharReceitas() {
  const lista = document.getElementById('lista-receitas');
  const visiveis = RECEITAS.filter((r) => [...filtrosAtivos].every((f) => r.tags.includes(f)));
  lista.innerHTML = '';
  if (visiveis.length === 0) {
    lista.innerHTML = '<p class="nota">Nenhuma receita com todos esses filtros.</p>';
    return;
  }
  visiveis.forEach((r) => {
    const d = document.createElement('details');
    d.className = 'receita';
    const nomes = r.tags.map((t) => FILTROS.find((f) => f.id === t)?.nome ?? t);
    d.innerHTML = `
      <summary></summary>
      <div class="etiquetas"></div>
      <h3>Ingredientes</h3><ul></ul>
      <h3>Preparo</h3><ol></ol>`;
    d.querySelector('summary').textContent = r.nome;
    nomes.forEach((n) => {
      const s = document.createElement('span');
      s.className = 'etiqueta';
      s.textContent = n;
      d.querySelector('.etiquetas').append(s);
    });
    r.ingredientes.forEach((i) => d.querySelector('ul').append(Object.assign(document.createElement('li'), { textContent: i })));
    r.preparo.forEach((p) => d.querySelector('ol').append(Object.assign(document.createElement('li'), { textContent: p })));
    if (r.observacao) d.append(Object.assign(document.createElement('p'), { className: 'nota', textContent: r.observacao }));
    lista.append(d);
  });
}

// ---------- Rótulos ----------
function mostrarResultadoRotulo() {
  const texto = document.getElementById('ingredientes').value.trim();
  const caixa = document.getElementById('resultado-rotulo');
  caixa.innerHTML = '';
  if (!texto) return;
  const achados = verificarRotulo(texto);
  if (achados.length === 0) {
    caixa.innerHTML = '<div class="resultado ok">Nenhum termo de alerta encontrado. Mesmo assim, confira os avisos da embalagem.</div>';
    return;
  }
  achados.forEach((a) => {
    const div = document.createElement('div');
    div.className = `resultado ${a.nivel}`;
    div.append(Object.assign(document.createElement('strong'), { textContent: a.grupo }));
    const ul = document.createElement('ul');
    a.encontrados.forEach((t) => ul.append(Object.assign(document.createElement('li'), { textContent: t })));
    div.append(ul);
    caixa.append(div);
  });
}

// ---------- Diário ----------
function hoje() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function lerDiario() {
  try {
    const dados = JSON.parse(localStorage.getItem(ARMAZENAMENTO) ?? '{}');
    return { agua: dados.agua ?? {}, refeicoes: dados.refeicoes ?? [] };
  } catch {
    return { agua: {}, refeicoes: [] };
  }
}

function salvarDiario(dados) {
  try { localStorage.setItem(ARMAZENAMENTO, JSON.stringify(dados)); } catch { /* armazenamento indisponível */ }
}

function desenharDiario() {
  const dados = lerDiario();
  document.getElementById('copos').textContent = dados.agua[hoje()] ?? 0;
  const lista = document.getElementById('lista-diario');
  lista.innerHTML = '';
  dados.refeicoes.slice(-30).reverse().forEach((r) => {
    const li = document.createElement('li');
    const info = document.createElement('div');
    info.append(Object.assign(document.createElement('strong'), { textContent: r.tipo }));
    info.append(Object.assign(document.createElement('div'), { textContent: r.texto }));
    const quando = new Date(r.quando).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    info.append(Object.assign(document.createElement('small'), { textContent: r.sintoma ? `${quando} · teve sintoma` : quando }));
    const apagar = Object.assign(document.createElement('button'), { textContent: 'Apagar' });
    apagar.addEventListener('click', () => {
      const atual = lerDiario();
      atual.refeicoes = atual.refeicoes.filter((x) => x.quando !== r.quando);
      salvarDiario(atual);
      desenharDiario();
    });
    li.append(info, apagar);
    lista.append(li);
  });
}

function mudarAgua(delta) {
  const dados = lerDiario();
  dados.agua[hoje()] = Math.max(0, (dados.agua[hoje()] ?? 0) + delta);
  salvarDiario(dados);
  desenharDiario();
}

// ---------- Início ----------
function iniciar() {
  document.querySelectorAll('[data-ir]').forEach((el) => el.addEventListener('click', () => irPara(el.dataset.ir)));

  const agendar = document.getElementById('link-agendar');
  if (CONFIG.whatsappAgendamento) {
    agendar.href = `https://wa.me/${CONFIG.whatsappAgendamento}?text=${encodeURIComponent(CONFIG.mensagemAgendamento)}`;
  } else {
    agendar.hidden = true;
  }

  desenharFiltros();
  desenharReceitas();

  document.getElementById('verificar').addEventListener('click', mostrarResultadoRotulo);

  document.getElementById('mais-agua').addEventListener('click', () => mudarAgua(1));
  document.getElementById('menos-agua').addEventListener('click', () => mudarAgua(-1));
  document.getElementById('form-refeicao').addEventListener('submit', (e) => {
    e.preventDefault();
    const texto = document.getElementById('refeicao-texto').value.trim();
    if (!texto) return;
    const dados = lerDiario();
    dados.refeicoes.push({
      tipo: document.getElementById('refeicao-tipo').value,
      texto,
      sintoma: document.getElementById('refeicao-sintoma').checked,
      quando: new Date().toISOString(),
    });
    salvarDiario(dados);
    e.target.reset();
    desenharDiario();
  });
  desenharDiario();

  const inicial = location.hash.slice(1);
  if (document.querySelector(`[data-pagina="${inicial}"]`)) irPara(inicial);

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', iniciar);
}
if (typeof module !== 'undefined') {
  module.exports = { verificarRotulo, RECEITAS, FILTROS };
}
