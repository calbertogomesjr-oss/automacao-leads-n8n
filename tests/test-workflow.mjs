import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflowUrl = new URL('../workflows/captura-leads.json', import.meta.url);
const workflow = JSON.parse(await readFile(workflowUrl, 'utf8'));

assert.equal(workflow.nodes.length, 3);
assert.deepEqual(
  workflow.nodes.map((node) => node.name),
  ['Receber lead', 'Validar e qualificar', 'Responder'],
);

const codeNode = workflow.nodes.find((node) => node.name === 'Validar e qualificar');
assert.ok(codeNode, 'O nó de validação deve existir.');

const executeCodeNode = new Function('$json', codeNode.parameters.jsCode);

const [leadValido] = executeCodeNode({
  body: {
    nome: '  Carlos Alberto  ',
    email: 'CARLOS@EXEMPLO.COM',
    telefone: '47999999999',
    mensagem: 'Gostaria de receber um orçamento para uma automação.',
    origem: 'site',
  },
});

assert.equal(leadValido.json.sucesso, true);
assert.equal(leadValido.json.statusCode, 201);
assert.equal(leadValido.json.lead.nome, 'Carlos Alberto');
assert.equal(leadValido.json.lead.email, 'carlos@exemplo.com');
assert.equal(leadValido.json.lead.interesse, 'alto');
assert.match(leadValido.json.lead.recebidoEm, /^\d{4}-\d{2}-\d{2}T/);

const [camposAusentes] = executeCodeNode({ body: { nome: 'Carlos' } });
assert.equal(camposAusentes.json.sucesso, false);
assert.equal(camposAusentes.json.statusCode, 400);

const [emailInvalido] = executeCodeNode({
  body: { nome: 'Carlos', email: 'email-invalido' },
});
assert.equal(emailInvalido.json.sucesso, false);
assert.equal(emailInvalido.json.erro, 'Informe um email válido.');

console.log('Testes concluídos: estrutura, lead válido e validações de erro.');
