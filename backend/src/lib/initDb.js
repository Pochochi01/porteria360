// Crea el esquema y un tenant demo con usuario admin.
import './env.js';
import fs from 'node:fs';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { migrate } from './migrate.js';

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  multipleStatements: true,
});
await conn.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\` CHARACTER SET utf8mb4`);
await conn.query(`USE \`${process.env.DB_NAME}\``);
await conn.query(fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));

const [t] = await conn.query("SELECT id FROM tenants WHERE slug='demo'");
if (!t.length) {
  const [r] = await conn.query("INSERT INTO tenants (name, slug) VALUES ('Country Demo','demo')");
  const hash = await bcrypt.hash('admin123', 10);
  const [u] = await conn.query(
    'INSERT INTO users (tenant_id,email,password_hash,full_name) VALUES (?,?,?,?)',
    [r.insertId, 'admin@demo.com', hash, 'Administrador']
  );
  await conn.query("INSERT INTO user_roles SELECT ?, id FROM roles WHERE name='admin'", [u.insertId]);
  console.log('Tenant demo creado. Login: tenant=demo admin@demo.com / admin123');
}
const applied = await migrate(conn);
if (applied.length) { console.log(`Migración: ${applied.join(', ')}`); }
await conn.end();
console.log('Esquema OK');
