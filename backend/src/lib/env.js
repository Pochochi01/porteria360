// Carga backend/.env sin depender del directorio de trabajo.
// Importar PRIMERO en cada punto de entrada (server, scripts, tests).
// Las variables ya definidas en el entorno (PM2, systemd, CI) tienen prioridad.
import dotenv from 'dotenv';
import { ENV_FILE } from './paths.js';

dotenv.config({ path: ENV_FILE, quiet: true });
