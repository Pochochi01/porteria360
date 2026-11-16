// Uso: npm run create:superadmin -- <email> <contraseña> ["Nombre"]
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool, query } from './db.js';

const [email, password, name = 'Superadministrador'] = process.argv.slice(2);
if (!email || !password || password.length < 8) {
  console.error('Uso: npm run create:superadmin -- <email> <contraseña (mín. 8)> ["Nombre"]');
  process.exit(1);
}

await query("INSERT IGNORE INTO roles (name) VALUES ('superadmin')");
await query("INSERT IGNORE INTO tenants (name, slug) VALUES ('Plataforma', 'plataforma')");
const [t] = await query("SELECT id FROM tenants WHERE slug='plataforma'");
const hash = await bcrypt.hash(password, 10);
await query(
  `INSERT INTO users (tenant_id,email,password_hash,full_name) VALUES (?,?,?,?)
   ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), active=1`,
  [t.id, email.toLowerCase(), hash, name]
);
const [u] = await query('SELECT id FROM users WHERE tenant_id=? AND email=?', [t.id, email.toLowerCase()]);
await query("INSERT IGNORE INTO user_roles SELECT ?, id FROM roles WHERE name='superadmin'", [u.id]);
console.log(`Superadmin listo: ${email}`);
await pool.end();
