// Pruebas del lector de DNI del lado del navegador: parser PDF417 + decodificación ZXing.
// Uso: npm test (en frontend/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import bwipjs from 'bwip-js/node';
import { BarcodeFormat, BinaryBitmap, DecodeHintType, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from '@zxing/library';
import { isInvitationToken, parseDniPdf417 } from '../src/lib/dni.js';

// Datos ficticios (no corresponden a ninguna persona)
const NUEVO = '00512345678@PEREZ GOMEZ@JUAN CARLOS@M@30123456@B@15/03/1985@20/06/2017@239';
const ANTERIOR = '@25123456    @A@1@FERNANDEZ@MARIA LAURA@ARGENTINA@02/11/1976@F@10/05/2010@00198765432@7055 @10/05/2025@123@0@ILR:2.01 C:110505.01 (No Cap.)@UNIDAD #20 || S/N: 0040>2008>>0006';

/** Decodifica una imagen con ZXing igual que en el navegador (PDF417 + QR, TRY_HARDER). */
async function decode(png) {
  const { data, info } = await sharp(png).flatten({ background: '#fff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)));
  const reader = new MultiFormatReader();
  reader.setHints(new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.PDF_417, BarcodeFormat.QR_CODE]], [DecodeHintType.TRY_HARDER, true]]));
  return reader.decode(bitmap);
}
const pdf417 = (text) => bwipjs.toBuffer({ bcid: 'pdf417', text, scale: 3, padding: 20, backgroundcolor: 'FFFFFF' });

test('parser: formato nuevo (2012+)', () => {
  assert.deepEqual(parseDniPdf417(NUEVO), {
    formato: 'nuevo', numeroTramite: '00512345678', apellido: 'PEREZ GOMEZ', nombre: 'JUAN CARLOS', sexo: 'M', dni: '30123456',
    ejemplar: 'B', fechaNacimiento: '15/03/1985', fechaEmision: '20/06/2017', nombreCompleto: 'PEREZ GOMEZ JUAN CARLOS',
  });
});

test('parser: formato anterior (empieza con @) incluye vencimiento', () => {
  const d = parseDniPdf417(ANTERIOR);
  assert.equal(d.formato, 'anterior');
  assert.equal(d.dni, '25123456');
  assert.equal(d.nombreCompleto, 'FERNANDEZ MARIA LAURA');
  assert.equal(d.sexo, 'F');
  assert.equal(d.fechaNacimiento, '02/11/1976');
  assert.equal(d.fechaVencimiento, '10/05/2025');
  assert.equal(d.numeroTramite, '00198765432');
});

test('parser: normaliza espacios y mayúsculas; DNI de 7 dígitos', () => {
  const d = parseDniPdf417('00512345678@  de la  Fuente @ ana   maría @F@ 9876543@A@01/01/1950@01/01/2018@200\n');
  assert.equal(d.nombreCompleto, 'DE LA FUENTE ANA MARÍA');
  assert.equal(d.dni, '9876543');
});

test('parser: rechaza textos que no son DNI', () => {
  for (const t of ['', 'hola', 'https://example.com', 'a@b@c', '123@456@789@M@1@A@x@y@z', '00512345678@PEREZ@JUAN@Q@30123456@B@x@y@1', null]) { assert.equal(parseDniPdf417(t), null, String(t)); }
});

test('QR de invitación del sistema: 32 hex', () => {
  assert.equal(isInvitationToken('0123456789abcdef0123456789ABCDEF'), true);
  assert.equal(isInvitationToken('00512345678@PEREZ'), false);
});

test('Caso 1: PDF417 válido → decodifica y autocompleta Nombre y DNI', async () => {
  for (const raw of [NUEVO, ANTERIOR]) {
    const res = await decode(await pdf417(raw));
    assert.equal(res.getBarcodeFormat(), BarcodeFormat.PDF_417);
    const d = parseDniPdf417(res.getText());
    assert.ok(d, 'parsea el contenido');
    assert.match(d.nombreCompleto, /^[A-ZÁÉÍÓÚÑ ]+$/);
    assert.match(d.dni, /^\d{7,8}$/);
  }
});

test('Caso 1b: PDF417 fotografiado (rotado, con ruido y desenfoque leve) sigue leyéndose', async () => {
  const photo = await sharp(await pdf417(NUEVO)).rotate(4, { background: '#fff' }).blur(0.8).modulate({ brightness: 0.9 }).png().toBuffer();
  assert.equal(parseDniPdf417((await decode(photo)).getText()).dni, '30123456');
});

test('Caso 2: PDF417 ilegible → la decodificación falla (el lector pasa a OCR)', async () => {
  const png = await pdf417(NUEVO);
  const { width, height } = await sharp(png).metadata();
  // Tapa más de la mitad del código: supera la corrección de errores
  const damaged = await sharp(png).composite([{ input: { create: { width: Math.round(width * 0.55), height, channels: 3, background: '#000' } }, left: Math.round(width * 0.2), top: 0 }]).png().toBuffer();
  await assert.rejects(decode(damaged));
  const blurred = await sharp(png).resize(Math.round(width / 6)).blur(3).png().toBuffer();
  await assert.rejects(decode(blurred));
});
