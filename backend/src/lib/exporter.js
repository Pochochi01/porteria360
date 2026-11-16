// Exportación de reportes a Excel (xlsx) y PDF (pdfkit). Un solo lugar: los reportes solo describen columnas y filas.
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { UPLOADS } from './files.js';

/**
 * @typedef {{ key: string, label: string, money?: boolean, width?: number }} Column
 * @typedef {{ title: string, columns: Column[], rows: Record<string, any>[], totals?: Record<string, any> }} Section
 * @typedef {{ title: string, subtitle?: string, tenant: { legal_name?: string, display_name?: string, cuit?: string, address?: string, logo_path?: string },
 *             sections: Section[], filename: string }} Report
 */

const money = (n) => Number(n || 0).toLocaleString('es-AR', { style: 'currency', currency: 'ARS' });

/** @param {Report} report @returns {Buffer} */
export function toXlsx(report) {
  const wb = XLSX.utils.book_new();
  for (const s of report.sections) {
    const header = s.columns.map((c) => c.label);
    const body = s.rows.map((r) => s.columns.map((c) => (c.money ? Number(r[c.key] || 0) : r[c.key] ?? '')));
    if (s.totals) { body.push(s.columns.map((c) => (c.money ? Number(s.totals[c.key] ?? '') || '' : s.totals[c.key] ?? ''))); }
    const ws = XLSX.utils.aoa_to_sheet([[report.title], [report.subtitle || ''], [], header, ...body]);
    ws['!cols'] = s.columns.map((c) => ({ wch: c.width ?? Math.max(c.label.length + 2, 14) }));
    // Formato moneda en las columnas de importes
    s.columns.forEach((c, ci) => {
      if (!c.money) { return; }
      for (let ri = 4; ri < 4 + body.length; ri++) {
        const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })];
        if (cell && typeof cell.v === 'number') { cell.z = '"$"#,##0.00'; }
      }
    });
    XLSX.utils.book_append_sheet(wb, ws, s.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '));
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** @param {Report} report @returns {Promise<Buffer>} */
export async function toPdf(report) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: report.title, Producer: 'AdminCountrys' } });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve) => { doc.on('end', () => resolve(Buffer.concat(chunks))); });
  const W = doc.page.width - 80;

  // Encabezado: logo (WebP/SVG no soportados por pdfkit → PNG con sharp), razón social y CUIT
  const t = report.tenant;
  let x = 40;
  if (t.logo_path) {
    try {
      const png = await sharp(await fs.readFile(path.join(UPLOADS, t.logo_path))).resize(120, 120, { fit: 'inside' }).png().toBuffer();
      doc.image(png, 40, 36, { fit: [48, 48] });
      x = 100;
    } catch { /* logo ilegible: el reporte sale igual */ }
  }
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#0f172a').text(t.legal_name || t.display_name || '', x, 40, { width: W - (x - 40) });
  doc.font('Helvetica').fontSize(9).fillColor('#475569')
    .text([t.cuit && `CUIT ${t.cuit}`, t.address].filter(Boolean).join(' · ') || ' ', x, doc.y + 2, { width: W - (x - 40) });
  doc.moveDown(2.2);
  doc.font('Helvetica-Bold').fontSize(15).fillColor('#0f172a').text(report.title, 40, Math.max(doc.y, 96));
  if (report.subtitle) { doc.font('Helvetica').fontSize(10).fillColor('#475569').text(report.subtitle); }
  doc.moveDown(0.8);

  for (const s of report.sections) {
    if (doc.y > doc.page.height - 140) { doc.addPage(); }
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f766e').text(s.title, 40);
    doc.moveDown(0.3);
    const totalWidth = s.columns.reduce((a, c) => a + (c.width ?? 14), 0);
    const widths = s.columns.map((c) => ((c.width ?? 14) / totalWidth) * W);
    const row = (values, { bold = false, fill } = {}) => {
      const cells = values.map((v) => String(v ?? ''));
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      const h = Math.max(...cells.map((c, i) => doc.heightOfString(c, { width: widths[i] - 6 }))) + 6;
      if (doc.y + h > doc.page.height - 50) { doc.addPage(); }
      const y = doc.y;
      if (fill) { doc.rect(40, y, W, h).fill(fill); }
      let cx = 40;
      cells.forEach((c, i) => {
        doc.fillColor('#0f172a').text(c, cx + 3, y + 3, { width: widths[i] - 6, align: s.columns[i].money ? 'right' : 'left' });
        cx += widths[i];
      });
      doc.y = y + h;
      doc.moveTo(40, doc.y).lineTo(40 + W, doc.y).lineWidth(0.3).strokeColor('#e2e8f0').stroke();
    };
    row(s.columns.map((c) => c.label), { bold: true, fill: '#f1f5f9' });
    for (const r of s.rows) { row(s.columns.map((c) => (c.money ? money(r[c.key]) : r[c.key]))); }
    if (s.totals) { row(s.columns.map((c) => (c.money && s.totals[c.key] != null ? money(s.totals[c.key]) : s.totals[c.key] ?? '')), { bold: true, fill: '#f8fafc' }); }
    doc.moveDown(1);
  }
  doc.font('Helvetica').fontSize(7.5).fillColor('#94a3b8')
    .text(`Generado el ${new Date().toLocaleString('es-AR')} · AdminCountrys`, 40, doc.page.height - 40, { width: W, align: 'center', lineBreak: false });
  doc.end();
  return done;
}

/** Responde el reporte en el formato pedido (?format=xlsx|pdf). */
export async function sendReport(res, report, format) {
  if (format === 'pdf') {
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${report.filename}.pdf"` });
    return res.send(await toPdf(report));
  }
  res.set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${report.filename}.xlsx"` });
  res.send(toXlsx(report));
}
