import test from 'node:test';
import assert from 'node:assert/strict';
import { homeFor } from '../src/lib/roleHome.js';

const MENU_OWNER = ['/familia', '/visitas', '/expensas', '/reservas', '/emergencias'];

test('propietario entra a Expensas aunque no sea la primera opción del menú', () => {
  assert.equal(homeFor(['owner'], MENU_OWNER), '/expensas');
});
test('guardia entra a Accesos', () => {
  assert.equal(homeFor(['guard'], ['/guardia', '/ronda', '/emergencias']), '/guardia');
});
test('admin entra a su pantalla principal', () => {
  assert.equal(homeFor(['admin'], ['/admin', '/branding', '/guardia', '/expensas']), '/admin');
});
test('varios roles: gana el de mayor responsabilidad', () => {
  assert.equal(homeFor(['owner', 'admin'], ['/admin', '/expensas']), '/admin');
});
test('ruta configurada no habilitada → primera del menú', () => {
  assert.equal(homeFor(['owner'], ['/familia', '/visitas']), '/familia');
});
test('superadmin dentro de un complejo (sin /plataforma) → admin', () => {
  assert.equal(homeFor(['superadmin', 'admin'], ['/admin', '/guardia']), '/admin');
});
test('sin menú → raíz', () => {
  assert.equal(homeFor(['resident'], []), '/');
});
