-- ===== Núcleo multi-tenant / Auth =====
CREATE TABLE IF NOT EXISTS tenants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(60) NOT NULL UNIQUE,
  mp_access_token VARCHAR(255) NULL,
  mp_refresh_token VARCHAR(255) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(30) NOT NULL UNIQUE
);
INSERT IGNORE INTO roles (name) VALUES
  ('superadmin'),('admin'),('supervisor'),('guard'),('owner'),('family'),('resident');

CREATE TABLE IF NOT EXISTS lots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  code VARCHAR(30) NOT NULL,
  address VARCHAR(160) NULL,
  UNIQUE KEY uq_lot (tenant_id, code),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  email VARCHAR(160) NOT NULL,
  password_hash VARCHAR(100) NOT NULL,
  full_name VARCHAR(120) NOT NULL,
  dni VARCHAR(20) NULL,
  phone VARCHAR(30) NULL,
  lot_id INT NULL,
  parent_user_id INT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_email (tenant_id, email),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (lot_id) REFERENCES lots(id),
  FOREIGN KEY (parent_user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id INT NOT NULL,
  role_id INT NOT NULL,
  PRIMARY KEY (user_id, role_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  user_id INT NULL,
  entity VARCHAR(40) NOT NULL,
  entity_id BIGINT NULL,
  action VARCHAR(40) NOT NULL,
  data JSON NULL,
  ip VARCHAR(45) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_audit (tenant_id, entity, entity_id)
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  user_id INT NOT NULL,
  endpoint VARCHAR(500) NOT NULL,
  p256dh VARCHAR(200) NOT NULL,
  auth VARCHAR(100) NOT NULL,
  UNIQUE KEY uq_push (endpoint(255)),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ===== Control de accesos =====
CREATE TABLE IF NOT EXISTS visits (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  lot_id INT NOT NULL,
  visitor_name VARCHAR(120) NOT NULL,
  visitor_dni VARCHAR(20) NULL,
  vehicle_plate VARCHAR(15) NULL,
  type ENUM('visit','delivery','service','worker') NOT NULL DEFAULT 'visit',
  status ENUM('pending','authorized','rejected','inside','exited','expired') NOT NULL DEFAULT 'pending',
  auth_method ENUM('qr','realtime') NULL,
  qr_token CHAR(32) NULL UNIQUE,
  valid_from DATETIME NULL,
  valid_until DATETIME NULL,
  created_by INT NOT NULL,
  authorized_by INT NULL,
  authorized_at DATETIME NULL,
  entry_at DATETIME NULL,
  entry_guard_id INT NULL,
  exit_at DATETIME NULL,
  exit_guard_id INT NULL,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_visits (tenant_id, status, created_at),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (lot_id) REFERENCES lots(id)
);

-- ===== Rondas =====
CREATE TABLE IF NOT EXISTS guards (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  user_id INT NOT NULL UNIQUE,
  badge VARCHAR(30) NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  name VARCHAR(80) NOT NULL,
  tag_code VARCHAR(64) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_tag (tenant_id, tag_code)
);

CREATE TABLE IF NOT EXISTS rounds (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  guard_id INT NOT NULL,
  status ENUM('in_progress','completed','incomplete') NOT NULL DEFAULT 'in_progress',
  started_at DATETIME NOT NULL,
  expected_minutes INT NOT NULL DEFAULT 60,
  finished_at DATETIME NULL,
  alerted TINYINT(1) NOT NULL DEFAULT 0,
  FOREIGN KEY (guard_id) REFERENCES guards(id)
);

CREATE TABLE IF NOT EXISTS round_points (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  round_id BIGINT NOT NULL,
  checkpoint_id INT NOT NULL,
  sort_order INT NOT NULL,
  scanned_at DATETIME NULL,
  method ENUM('nfc','qr') NULL,
  lat DECIMAL(10,7) NULL,
  lng DECIMAL(10,7) NULL,
  UNIQUE KEY uq_rp (round_id, checkpoint_id),
  FOREIGN KEY (round_id) REFERENCES rounds(id) ON DELETE CASCADE,
  FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id)
);

-- ===== Expensas =====
CREATE TABLE IF NOT EXISTS expense_settlements (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  lot_id INT NOT NULL,
  period CHAR(7) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  due_date DATE NOT NULL,
  status ENUM('pending','in_review','paid') NOT NULL DEFAULT 'pending',
  detail VARCHAR(500) NULL,
  UNIQUE KEY uq_settle (tenant_id, lot_id, period),
  FOREIGN KEY (lot_id) REFERENCES lots(id)
);

CREATE TABLE IF NOT EXISTS expense_payments (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  settlement_id BIGINT NOT NULL,
  method ENUM('transfer','cash') NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  receipt_path VARCHAR(255) NULL,
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  registered_by INT NOT NULL,
  reviewed_by INT NULL,
  receipt_number VARCHAR(30) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (settlement_id) REFERENCES expense_settlements(id)
);

-- ===== Reservas =====
CREATE TABLE IF NOT EXISTS spaces (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  name VARCHAR(80) NOT NULL,
  type ENUM('clubhouse','court','pool','other') NOT NULL,
  capacity INT NOT NULL DEFAULT 1,
  slot_minutes INT NOT NULL DEFAULT 60,
  open_time TIME NOT NULL DEFAULT '08:00:00',
  close_time TIME NOT NULL DEFAULT '23:00:00',
  max_per_lot_week INT NOT NULL DEFAULT 2,
  min_advance_hours INT NOT NULL DEFAULT 2,
  max_advance_days INT NOT NULL DEFAULT 30,
  requires_approval TINYINT(1) NOT NULL DEFAULT 1,
  price DECIMAL(12,2) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS reservations (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  space_id INT NOT NULL,
  lot_id INT NOT NULL,
  user_id INT NOT NULL,
  start_at DATETIME NOT NULL,
  end_at DATETIME NOT NULL,
  status ENUM('pending','approved','rejected','cancelled') NOT NULL DEFAULT 'pending',
  payment_status ENUM('not_required','pending','approved','rejected','refunded') NOT NULL DEFAULT 'not_required',
  mp_preference_id VARCHAR(80) NULL,
  mp_payment_id VARCHAR(40) NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  reviewed_by INT NULL,
  review_note VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_res (tenant_id, space_id, start_at),
  FOREIGN KEY (space_id) REFERENCES spaces(id)
);

-- ===== Emergencias =====
CREATE TABLE IF NOT EXISTS incidents (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  type ENUM('medical','security') NOT NULL,
  status ENUM('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
  reported_by INT NOT NULL,
  lot_id INT NULL,
  lat DECIMAL(10,7) NULL,
  lng DECIMAL(10,7) NULL,
  description VARCHAR(500) NULL,
  acknowledged_by INT NULL,
  acknowledged_at DATETIME NULL,
  resolved_by INT NULL,
  resolved_at DATETIME NULL,
  resolution VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_inc (tenant_id, status)
);

-- ===== Branding por complejo (multi-tenant) =====
CREATE TABLE IF NOT EXISTS tenant_themes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(60) NOT NULL UNIQUE,
  primary_color CHAR(7) NOT NULL,
  accent_color CHAR(7) NOT NULL,
  font_display VARCHAR(40) NOT NULL,
  font_body VARCHAR(40) NOT NULL
);
INSERT IGNORE INTO tenant_themes (name, primary_color, accent_color, font_display, font_body) VALUES
  ('Bosque', '#0f766e', '#f59e0b', 'Manrope', 'Inter'),
  ('Océano', '#1d4ed8', '#06b6d4', 'Plus Jakarta Sans', 'Inter'),
  ('Grafito', '#334155', '#6366f1', 'Sora', 'Inter'),
  ('Terracota', '#b45309', '#0d9488', 'Fraunces', 'DM Sans'),
  ('Club', '#166534', '#ca8a04', 'Playfair Display', 'DM Sans');

CREATE TABLE IF NOT EXISTS tenant_assets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  kind ENUM('logo','cover','video','image') NOT NULL,
  path VARCHAR(255) NOT NULL,
  mime VARCHAR(60) NOT NULL,
  size INT NOT NULL,
  width INT NULL,
  height INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_ta (tenant_id, kind),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id INT PRIMARY KEY,
  theme_id INT NULL,
  display_name VARCHAR(120) NULL,
  tagline VARCHAR(200) NULL,
  description VARCHAR(1000) NULL,
  primary_color CHAR(7) NULL,
  accent_color CHAR(7) NULL,
  font_display VARCHAR(40) NULL,
  font_body VARCHAR(40) NULL,
  logo_asset_id INT NULL,
  cover_asset_id INT NULL,
  video_asset_id INT NULL,
  video_url VARCHAR(255) NULL,
  public_enabled TINYINT(1) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (theme_id) REFERENCES tenant_themes(id),
  FOREIGN KEY (logo_asset_id) REFERENCES tenant_assets(id) ON DELETE SET NULL,
  FOREIGN KEY (cover_asset_id) REFERENCES tenant_assets(id) ON DELETE SET NULL,
  FOREIGN KEY (video_asset_id) REFERENCES tenant_assets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tenant_gallery (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id INT NOT NULL,
  asset_id INT NOT NULL,
  title VARCHAR(120) NULL,
  category ENUM('countries','edificios','barrios','premium','amenities') NOT NULL DEFAULT 'premium',
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_tg (tenant_id, sort_order),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (asset_id) REFERENCES tenant_assets(id) ON DELETE CASCADE
);

-- ===== Pedidos de demo desde la landing =====
CREATE TABLE IF NOT EXISTS demo_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL,
  phone VARCHAR(30) NULL,
  organization VARCHAR(160) NULL,
  kind ENUM('country','barrio','edificio','otro') NOT NULL DEFAULT 'country',
  units INT NULL,
  message VARCHAR(1000) NULL,
  ip VARCHAR(45) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
