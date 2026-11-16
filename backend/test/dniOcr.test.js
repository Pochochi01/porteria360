// Pruebas del parser OCR del DNI (sin servidor ni Tesseract).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDniOcrText } from '../src/lib/dniOcr.js';

test('frente: rótulos Apellido/Nombre y DNI con puntos', () => {
  const text = `REPUBLICA ARGENTINA - MERCOSUR
REGISTRO NACIONAL DE LAS PERSONAS
Apellido / Surname
PEREZ GOMEZ
Nombre / Name
JUAN CARLOS
Sexo / Sex   Nacionalidad / Nationality
M            ARGENTINA
Fecha de nacimiento / Date of birth
15 MAR/ MAR 1985
Documento / Document
30.123.456`;
  const r = parseDniOcrText(text);
  assert.deepEqual({ apellido: r.apellido, nombre: r.nombre, nombreCompleto: r.nombreCompleto, dni: r.dni, found: r.found, fuente: r.fuente },
    { apellido: 'PEREZ GOMEZ', nombre: 'JUAN CARLOS', nombreCompleto: 'PEREZ GOMEZ JUAN CARLOS', dni: '30123456', found: true, fuente: 'frente' });
});

test('frente con ruido OCR: símbolos sueltos, espacios y O/I confundidos en el número', () => {
  const text = `| Apellido / Surname _
  FERNANDEZ ~
Nombre/Name
 MARIA   LAURA .
Documento / Document
 25I23456 `;
  const r = parseDniOcrText(text);
  assert.equal(r.nombreCompleto, 'FERNANDEZ MARIA LAURA');
  assert.equal(r.dni, '25123456');
});

test('dorso: zona MRZ', () => {
  const text = `IDARG25123456<5<<<<<<<<<<<<<<<
7611025F2505108ARG<<<<<<<<<<<4
FERNANDEZ<<MARIA<LAURA<<<<<<<<`;
  const r = parseDniOcrText(text);
  assert.equal(r.fuente, 'mrz');
  assert.equal(r.nombreCompleto, 'FERNANDEZ MARIA LAURA');
  assert.equal(r.dni, '25123456');
});

test('DNI sin puntos y no confunde fechas ni número de trámite', () => {
  const r = parseDniOcrText('Apellido\nLOPEZ\nNombre\nANA\nTramite 00512345678\nEmision 20/06/2017\n30123456');
  assert.equal(r.dni, '30123456');
});

test('Caso 4 (parser): texto sin datos de DNI → found=false', () => {
  const r = parseDniOcrText('FACTURA B\nTOTAL $ 1.250,00\nGRACIAS POR SU COMPRA');
  assert.equal(r.found, false);
  assert.equal(r.fuente, 'ninguna');
});
