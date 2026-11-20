// Migración aditiva del módulo de expensas, gastos y portal del propietario.
// Idempotente: se puede ejecutar varias veces. No modifica ni borra datos existentes.
// Uso: npm run db:migrate   (también la ejecuta db:init en instalaciones nuevas)
import { pathToFileURL } from 'node:url';

/** Rubros sugeridos que se cargan en cada complejo (editables por el administrador). */
export const DEFAULT_CATEGORIES = ['Seguridad', 'Mantenimiento', 'Jardinería', 'Limpieza', 'Energía', 'Seguros',
  'Administración', 'Deportes', 'Piscina', 'Club House', 'Obras', 'Otros'];

const TABLES = [
  // Un propietario puede tener varios lotes. users.lot_id sigue siendo el "lote principal"
  // (accesos, visitas y reservas no cambian); esta tabla suma los lotes adicionales.
  `CREATE TABLE IF NOT EXISTS user_lots (
    user_id INT NOT NULL,
    lot_id INT NOT NULL,
    tenant_id INT NOT NULL,
    PRIMARY KEY (user_id, lot_id),
    INDEX ix_ul_lot (lot_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (lot_id) REFERENCES lots(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS expense_categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    name VARCHAR(60) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    active TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY uq_cat (tenant_id, name),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS suppliers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    legal_name VARCHAR(160) NOT NULL,
    trade_name VARCHAR(160) NULL,
    cuit VARCHAR(13) NULL,
    email VARCHAR(160) NULL,
    phone VARCHAR(30) NULL,
    address VARCHAR(200) NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_supplier_cuit (tenant_id, cuit),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  )`,
  // Gasto del country (no confundir con expense_settlements = expensa liquidada a cada lote)
  `CREATE TABLE IF NOT EXISTS expenditures (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    date DATE NOT NULL,
    period CHAR(7) NOT NULL,
    category_id INT NOT NULL,
    supplier_id INT NULL,
    concept VARCHAR(200) NOT NULL,
    amount DECIMAL(14,2) NOT NULL,
    voucher_type VARCHAR(30) NULL,
    voucher_number VARCHAR(40) NULL,
    notes VARCHAR(500) NULL,
    asset_id INT NULL,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_exp_period (tenant_id, period),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (category_id) REFERENCES expense_categories(id),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
    FOREIGN KEY (asset_id) REFERENCES tenant_assets(id) ON DELETE SET NULL
  )`,
  // Cada generación de expensas (las liquidaciones resultantes van a expense_settlements)
  `CREATE TABLE IF NOT EXISTS expense_runs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    period CHAR(7) NOT NULL,
    method VARCHAR(20) NOT NULL,
    params JSON NULL,
    total DECIMAL(14,2) NOT NULL,
    lots_count INT NOT NULL,
    due_date DATE NOT NULL,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_run_period (tenant_id, period),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  )`,
  `CREATE TABLE IF NOT EXISTS payment_methods (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    type ENUM('transfer','mercadopago','modo','naranjax') NOT NULL,
    label VARCHAR(80) NOT NULL,
    data JSON NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT NOT NULL DEFAULT 0,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  )`,
  // ===== Notificaciones =====
  // Historial y cola de envío a la vez: cada fila es una notificación para UN usuario.
  // La cola es la propia tabla (persistente: sobrevive a reinicios y caídas).
  `CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    user_id INT NOT NULL,
    type VARCHAR(60) NOT NULL,
    category VARCHAR(20) NOT NULL,
    source_module VARCHAR(30) NOT NULL,
    priority ENUM('normal','high') NOT NULL DEFAULT 'normal',
    title VARCHAR(160) NOT NULL,
    body VARCHAR(500) NOT NULL,
    action_url VARCHAR(255) NOT NULL DEFAULT '/',
    action_label VARCHAR(40) NULL,
    image_url VARCHAR(255) NULL,
    entity_type VARCHAR(30) NULL,
    entity_id BIGINT NULL,
    dedupe_key VARCHAR(120) NULL,
    status ENUM('queued','sending','sent','partial','failed','no_devices') NOT NULL DEFAULT 'queued',
    attempts TINYINT NOT NULL DEFAULT 0,
    next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lock_id CHAR(16) NULL,
    locked_at DATETIME NULL,
    device_count SMALLINT NOT NULL DEFAULT 0,
    delivered_count SMALLINT NOT NULL DEFAULT 0,
    delivered_to JSON NULL,
    last_error VARCHAR(500) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME NULL,
    read_at DATETIME NULL,
    UNIQUE KEY uq_notif_dedupe (user_id, dedupe_key),
    INDEX ix_notif_queue (status, next_attempt_at),
    INDEX ix_notif_user (tenant_id, user_id, created_at),
    INDEX ix_notif_tenant (tenant_id, created_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  // Preferencias por usuario. Sin fila = valores por defecto según el rol (ver notifications/preferences.js)
  `CREATE TABLE IF NOT EXISTS notification_preferences (
    user_id INT PRIMARY KEY,
    tenant_id INT NOT NULL,
    categories JSON NOT NULL,
    reminders JSON NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`,
  // Comunicados del complejo y mensajes de la administración
  `CREATE TABLE IF NOT EXISTS announcements (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    kind ENUM('announcement','message') NOT NULL DEFAULT 'announcement',
    audience ENUM('all','owners','residents','staff','user') NOT NULL DEFAULT 'all',
    target_user_id INT NULL,
    title VARCHAR(160) NOT NULL,
    body TEXT NOT NULL,
    created_by INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_ann_tenant (tenant_id, created_at),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
  )`,
  // Cada intento de marcar un punto de control (válido o no): base de la auditoría antifraude de rondas.
  // round_points guarda solo la marca válida; acá queda todo lo que el guardia intentó.
  `CREATE TABLE IF NOT EXISTS round_scans (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    tenant_id INT NOT NULL,
    round_id BIGINT NOT NULL,
    checkpoint_id INT NOT NULL,
    user_id INT NOT NULL,
    scanned_at DATETIME NOT NULL,
    method ENUM('nfc','qr') NOT NULL,
    status ENUM('valid','out_of_range','gps_inaccurate','gps_disabled','gps_denied','location_error','point_unlocated') NOT NULL,
    lat DECIMAL(10,7) NULL,
    lng DECIMAL(10,7) NULL,
    accuracy_m DECIMAL(9,1) NULL,
    distance_m DECIMAL(10,1) NULL,
    cp_lat DECIMAL(10,7) NULL,
    cp_lng DECIMAL(10,7) NULL,
    cp_radius_m INT NULL,
    geo_error VARCHAR(20) NULL,
    device VARCHAR(60) NULL,
    browser VARCHAR(40) NULL,
    ip VARCHAR(45) NULL,
    INDEX ix_rs_round (round_id, scanned_at),
    INDEX ix_rs_status (tenant_id, status, scanned_at),
    INDEX ix_rs_cp (checkpoint_id, scanned_at),
    FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
    FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id) ON DELETE CASCADE
  )`,
];

// [tabla, columna, definición]
const COLUMNS = [
  ['tenant_settings', 'legal_name', 'VARCHAR(160) NULL'],
  ['tenant_settings', 'cuit', 'VARCHAR(13) NULL'],
  ['tenant_settings', 'address', 'VARCHAR(200) NULL'],
  ['tenant_settings', 'email', 'VARCHAR(160) NULL'],
  ['tenant_settings', 'phone', 'VARCHAR(30) NULL'],
  ['lots', 'surface_m2', 'DECIMAL(10,2) NULL'],
  ['lots', 'coefficient', 'DECIMAL(12,6) NULL'],
  ['lots', 'share_pct', 'DECIMAL(9,6) NULL'],
  ['expense_settlements', 'run_id', 'BIGINT NULL'],
  ['expense_settlements', 'breakdown', 'JSON NULL'],
  ['expense_payments', 'mp_payment_id', 'VARCHAR(40) NULL'],
  ['tenant_assets', 'private', 'TINYINT(1) NOT NULL DEFAULT 0'],
  // Dispositivos registrados (push_subscriptions): varios por usuario, Web Push o FCM
  ['push_subscriptions', 'channel', "ENUM('webpush','fcm') NOT NULL DEFAULT 'webpush'"],
  ['push_subscriptions', 'fcm_token', 'VARCHAR(255) NULL'],
  ['push_subscriptions', 'platform', 'VARCHAR(20) NULL'],
  ['push_subscriptions', 'browser', 'VARCHAR(40) NULL'],
  ['push_subscriptions', 'device', 'VARCHAR(60) NULL'],
  ['push_subscriptions', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'],
  ['push_subscriptions', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'],
  ['push_subscriptions', 'last_seen', 'DATETIME NULL'],
  // Control de accesos: invitaciones (QR) y movimientos de la guardia
  ['visits', 'entry_method', "ENUM('invitation_qr','dni_manual') NULL"], // cómo ingresó (INVITACION_QR / DNI_MANUAL)
  ['visits', 'rejected_at', 'DATETIME NULL'],
  ['visits', 'rejected_by', 'INT NULL'],
  ['visits', 'reject_reason', 'VARCHAR(255) NULL'],
  ['visits', 'cancelled_at', 'DATETIME NULL'],
  ['visits', 'last_movement_at', 'DATETIME NULL'], // último ingreso, egreso o rechazo: ordena el historial por índice
  // Rondas: ubicación real de cada punto de control y radio dentro del cual se acepta el escaneo
  ['checkpoints', 'lat', 'DECIMAL(10,7) NULL'],
  ['checkpoints', 'lng', 'DECIMAL(10,7) NULL'],
  ['checkpoints', 'radius_m', 'INT NOT NULL DEFAULT 30'],
  // Marca válida: con qué precisión y a qué distancia se registró, y qué intento la produjo
  ['round_points', 'accuracy_m', 'DECIMAL(9,1) NULL'],
  ['round_points', 'distance_m', 'DECIMAL(10,1) NULL'],
  ['round_points', 'scan_id', 'BIGINT NULL'],
];

// Columnas que pasan a aceptar NULL: [tabla, columna, definición completa]
// (un dispositivo FCM no tiene endpoint ni claves de Web Push)
const NULLABLE = [
  ['push_subscriptions', 'endpoint', 'VARCHAR(500) NULL'],
  ['push_subscriptions', 'p256dh', 'VARCHAR(200) NULL'],
  ['push_subscriptions', 'auth', 'VARCHAR(100) NULL'],
];

// Valores nuevos en ENUM existentes: [tabla, columna, definición completa]
const ENUMS = [
  ['expense_payments', 'method', "ENUM('transfer','cash','mercadopago') NOT NULL"],
  ['tenant_assets', 'kind', "ENUM('logo','cover','video','image','document') NOT NULL"],
  // cancelled: invitación anulada por el propietario antes de usarse
  ['visits', 'status', "ENUM('pending','authorized','rejected','inside','exited','expired','cancelled') NOT NULL DEFAULT 'pending'"],
  // guard: ingreso autorizado directamente por la guardia (DNI escaneado, sin aprobación previa)
  ['visits', 'auth_method', "ENUM('qr','realtime','guard') NULL"],
];

const INDEXES = [
  ['expense_payments', 'uq_mp_payment', 'CREATE UNIQUE INDEX uq_mp_payment ON expense_payments (mp_payment_id)'],
  ['expense_settlements', 'ix_settle_run', 'CREATE INDEX ix_settle_run ON expense_settlements (run_id)'],
  ['push_subscriptions', 'uq_push_fcm', 'CREATE UNIQUE INDEX uq_push_fcm ON push_subscriptions (fcm_token)'],
  ['push_subscriptions', 'ix_push_user', 'CREATE INDEX ix_push_user ON push_subscriptions (tenant_id, user_id)'],
  ['visits', 'ix_visits_moves', 'CREATE INDEX ix_visits_moves ON visits (tenant_id, last_movement_at)'],
  ['visits', 'ix_visits_entry', 'CREATE INDEX ix_visits_entry ON visits (tenant_id, entry_at)'],
  ['visits', 'ix_visits_dni', 'CREATE INDEX ix_visits_dni ON visits (tenant_id, visitor_dni)'],
  ['visits', 'ix_visits_lot', 'CREATE INDEX ix_visits_lot ON visits (lot_id, status)'],
];

/**
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').Connection} db
 * @returns {Promise<string[]>} cambios aplicados
 */
export async function migrate(db) {
  const done = [];
  const [[{ name: dbName }]] = await db.query('SELECT DATABASE() AS name');
  const has = async (sql, params) => (await db.query(sql, params))[0].length > 0;

  for (const sql of TABLES) {
    const table = sql.match(/EXISTS (\w+)/)[1];
    if (!(await has('SELECT 1 FROM information_schema.tables WHERE table_schema=? AND table_name=?', [dbName, table]))) {
      await db.query(sql);
      done.push(`tabla ${table}`);
    }
  }
  for (const [table, column, def] of COLUMNS) {
    if (!(await has('SELECT 1 FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name=?', [dbName, table, column]))) {
      await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
      done.push(`${table}.${column}`);
    }
  }
  for (const [table, column, def] of ENUMS) {
    const [[col]] = await db.query('SELECT column_type AS column_type FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name=?', [dbName, table, column]);
    const wanted = def.match(/ENUM\(.*?\)/)[0].toLowerCase();
    if (col && col.column_type.toLowerCase() !== wanted) {
      await db.query(`ALTER TABLE ${table} MODIFY COLUMN ${column} ${def}`);
      done.push(`${table}.${column} (valores)`);
    }
  }
  for (const [table, column, def] of NULLABLE) {
    const [[col]] = await db.query('SELECT is_nullable AS n FROM information_schema.columns WHERE table_schema=? AND table_name=? AND column_name=?', [dbName, table, column]);
    if (col && col.n === 'NO') {
      await db.query(`ALTER TABLE ${table} MODIFY COLUMN ${column} ${def}`);
      done.push(`${table}.${column} (acepta NULL)`);
    }
  }
  for (const [table, name, sql] of INDEXES) {
    if (!(await has('SELECT 1 FROM information_schema.statistics WHERE table_schema=? AND table_name=? AND index_name=?', [dbName, table, name]))) {
      await db.query(sql);
      done.push(`índice ${name}`);
    }
  }
  // Movimientos históricos: fecha del último movimiento (los nuevos la escriben al registrar ingreso/egreso/rechazo)
  const [mv] = await db.query(
    `UPDATE visits SET last_movement_at = CASE status WHEN 'exited' THEN COALESCE(exit_at, entry_at) WHEN 'inside' THEN entry_at
       ELSE COALESCE(rejected_at, authorized_at, created_at) END
     WHERE last_movement_at IS NULL AND status IN ('inside','exited','rejected')`);
  if (mv.affectedRows) { done.push(`${mv.affectedRows} movimiento(s) históricos con fecha`); }
  // Lotes principales actuales de propietarios → user_lots (para que el portal los vea igual que hoy)
  const [r] = await db.query(
    `INSERT IGNORE INTO user_lots (user_id, lot_id, tenant_id)
     SELECT u.id, u.lot_id, u.tenant_id FROM users u
     JOIN user_roles ur ON ur.user_id=u.id JOIN roles ro ON ro.id=ur.role_id
     WHERE ro.name='owner' AND u.lot_id IS NOT NULL`);
  if (r.affectedRows) { done.push(`${r.affectedRows} lote(s) de propietarios en user_lots`); }
  // Rubros sugeridos en los complejos que no tienen ninguno
  const [tenants] = await db.query(
    "SELECT t.id FROM tenants t WHERE t.slug<>'plataforma' AND NOT EXISTS (SELECT 1 FROM expense_categories c WHERE c.tenant_id=t.id)");
  for (const t of tenants) { await seedCategories(db, t.id); }
  if (tenants.length) { done.push(`rubros sugeridos en ${tenants.length} complejo(s)`); }
  return done;
}

/** Carga los rubros sugeridos de un complejo (ignora los que ya existen). */
export async function seedCategories(db, tenantId) {
  const values = DEFAULT_CATEGORIES.map((name, i) => [tenantId, name, i + 1]);
  await db.query('INSERT IGNORE INTO expense_categories (tenant_id, name, sort_order) VALUES ?', [values]);
}

// Ejecución directa: npm run db:migrate
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await import('./env.js');
  const { pool } = await import('./db.js');
  const done = await migrate(pool);
  console.log(done.length ? `Migración aplicada:\n - ${done.join('\n - ')}` : 'Sin cambios: la base ya estaba migrada.');
  await pool.end();
}
