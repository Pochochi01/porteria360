// Pruebas del motor de prorrateo (sin base de datos).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allocate, computeSettlements, EngineError } from '../src/lib/expenseEngine.js';

const LOTS = [
  { id: 1, code: 'A-2', share_pct: 25, coefficient: 1.5, surface_m2: 600 },
  { id: 2, code: 'A-10', share_pct: 25, coefficient: 1, surface_m2: 400 },
  { id: 3, code: 'A-1', share_pct: 50, coefficient: 2.5, surface_m2: 1000 },
];
const sum = (rows) => Math.round(rows.reduce((a, r) => a + r.amount * 100, 0)) / 100;

test('porcentaje: reparte según share_pct y suma exactamente el total', () => {
  const { rows, total } = computeSettlements({ lots: LOTS, method: 'percentage', total: 1000 });
  assert.deepEqual(rows.map((r) => [r.lot_code, r.amount]), [['A-1', 500], ['A-2', 250], ['A-10', 250]]); // orden natural
  assert.equal(total, 1000);
});

test('porcentaje: rechaza si no suman 100%', () => {
  assert.throws(() => computeSettlements({ lots: [{ id: 1, code: 'X', share_pct: 60 }, { id: 2, code: 'Y', share_pct: 30 }], method: 'percentage', total: 10 }), /suman 90/);
});

test('coeficiente y m²: proporcionales', () => {
  const c = computeSettlements({ lots: LOTS, method: 'coefficient', total: 5000 }).rows;
  assert.deepEqual(c.map((r) => r.amount), [2500, 1500, 1000]);
  const s = computeSettlements({ lots: LOTS, method: 'surface', total: 2000 }).rows;
  assert.deepEqual(s.map((r) => r.amount), [1000, 600, 400]);
});

test('redondeo: 100 entre 3 lotes iguales da 33,34 + 33,33 + 33,33 (no se pierde un centavo)', () => {
  const lots = [1, 2, 3].map((i) => ({ id: i, code: `L${i}`, coefficient: 1 }));
  const { rows } = computeSettlements({ lots, method: 'coefficient', total: 100 });
  assert.deepEqual(rows.map((r) => r.amount), [33.34, 33.33, 33.33]);
  assert.equal(sum(rows), 100);
});

test('redondeo con importes reales y muchos lotes: la suma siempre es exacta', () => {
  const lots = Array.from({ length: 137 }, (_, i) => ({ id: i + 1, code: `L${i + 1}`, surface_m2: 300 + ((i * 37) % 900) }));
  for (const total of [18500000, 1234567.89, 99.99, 0.07]) {
    assert.equal(sum(computeSettlements({ lots, method: 'surface', total }).rows), total);
  }
});

test('valor fijo: mismo importe por lote, total = importe × lotes', () => {
  const { rows, total } = computeSettlements({ lots: LOTS, method: 'fixed', params: { amount: 45000.5 } });
  assert.ok(rows.every((r) => r.amount === 45000.5));
  assert.equal(total, 135001.5);
});

test('mixto: 50% por m² + 50% en partes iguales', () => {
  const { rows } = computeSettlements({ lots: LOTS, method: 'mixed', total: 3000, params: { parts: [{ method: 'surface', weight: 50 }, { method: 'equal', weight: 50 }] } });
  // m²: 750/450/300 ; iguales: 500 c/u
  assert.deepEqual(rows.map((r) => r.amount), [1250, 950, 800]);
});

test('errores claros: faltan datos de lotes, método desconocido, sin lotes, total inválido', () => {
  assert.throws(() => computeSettlements({ lots: [{ id: 1, code: 'Z' }], method: 'surface', total: 10 }), (e) => e instanceof EngineError && /superficie.*Z/.test(e.message));
  assert.throws(() => computeSettlements({ lots: LOTS, method: 'nada', total: 10 }), /desconocido/);
  assert.throws(() => computeSettlements({ lots: [], method: 'coefficient', total: 10 }), /no tiene lotes/);
  assert.throws(() => computeSettlements({ lots: LOTS, method: 'coefficient', total: 0 }), /mayor a 0/);
  assert.throws(() => computeSettlements({ lots: LOTS, method: 'mixed', total: 10, params: { parts: [{ method: 'mixed', weight: 100 }] } }), /inválido/);
});

test('allocate: distribuye restos al mayor decimal', () => {
  assert.deepEqual(allocate(10, [1, 1, 1]), [4, 3, 3]);
  assert.deepEqual(allocate(1, [1, 2]), [0, 1]);
});
