import { test, expect } from 'bun:test';
import { runFabricMeasure } from './fabric-measure.js';

const COM_FORMULA = 'Medida: 2024_FAT_BRUTO\nTabela: VISAO_COMERCIAL\nExpressão DAX: CALCULATE([X])';
const SEM_FORMULA = 'Medida: OUTRA\nTabela: VISAO_COMERCIAL';
const texto = (r: { content: { text?: string }[] }) => String(r.content[0]?.text ?? '');

test('ACEITE: devolve a formula real — o agente nao precisa deduzir por tentativa', () => {
  // O modelo vinha reproduzindo valores ate "bater os centavos" e chegava numa formula
  // estruturalmente diferente da real. Coincidir numero nao e conhecer a logica.
  return runFabricMeasure(async () => [COM_FORMULA], 'ds', '2024_FAT_BRUTO').then((r) => {
    expect(r.isError).toBeFalsy();
    const out = JSON.parse(texto(r));
    expect(out.medidas[0].formula).toContain('CALCULATE');
    expect(out.medidas[0].tabela).toBe('VISAO_COMERCIAL');
  });
});

test('ACEITE: medida sem fórmula avisa o PORQUÊ, não devolve null mudo', async () => {
  const r = await runFabricMeasure(async () => [SEM_FORMULA], 'ds', 'OUTRA');
  const out = JSON.parse(texto(r));
  expect(out.medidas[0].formula).toBeNull();
  expect(out.aviso).toContain('Expressões DAX'); // diz o que habilitar
});

test('busca parcial traz a família inteira', async () => {
  const r = await runFabricMeasure(async () => [COM_FORMULA, SEM_FORMULA], 'ds', 'FAT');
  expect(JSON.parse(texto(r)).encontradas).toBe(2);
});

test('nada encontrado → erro que ensina o próximo passo', async () => {
  const r = await runFabricMeasure(async () => [], 'ds', 'INEXISTENTE');
  expect(r.isError).toBe(true);
  expect(texto(r)).toContain('nio_fabric_schema_sync');
});

test('o limite chega ao buscador', async () => {
  let visto = 0;
  await runFabricMeasure(async (_r, _t, l) => { visto = l; return [COM_FORMULA]; }, 'ds', 'x', 3);
  expect(visto).toBe(3);
});
