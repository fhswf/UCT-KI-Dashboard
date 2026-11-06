import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import os from 'os';

import pool from './src/db/pool.js';
import sensorsRouter from './src/routes/sensors.js';
import healthRouter from './src/routes/health.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const bindHost = process.env.DEV_MODE === 'true' ? '0.0.0.0' : '127.0.0.1';
const port = parseInt(process.env.PORT, 10) || 3000;

const globalLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 60,
});

app.set('trust proxy', 1);
const cspDirectives = {
    "img-src": ["'self'", "https://*.tile.openstreetmap.org", "data:"],
};
if (process.env.DEV_MODE === 'true') {
    cspDirectives["upgrade-insecure-requests"] = null;
}

app.use(helmet({
    contentSecurityPolicy: { directives: cspDirectives },
    crossOriginEmbedderPolicy: false,
    // OSM tile policy requires a Referer; helmet's default no-referrer gets tiles blocked (403)
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));
app.use(express.json());
app.use('/api/', globalLimiter);

if (process.env.DEV_MODE === 'true') {
    app.use('/vendor/leaflet',         express.static('node_modules/leaflet/dist'));
    app.use('/vendor/chartjs',         express.static('node_modules/chart.js/dist'));
    app.use('/vendor/date-fns',        express.static('node_modules/date-fns'));
    app.use('/vendor/chartjs-adapter', express.static('node_modules/chartjs-adapter-date-fns/dist'));
    app.use('/vendor/hammerjs',        express.static('node_modules/hammerjs'));
    app.use('/vendor/chartjs-zoom',    express.static('node_modules/chartjs-plugin-zoom/dist'));
}

const clientEnv = {
    API_TIMEOUT_MS: parseInt(process.env.API_TIMEOUT_MS, 10) || 30000,
};
const clientEnvScript = `window.env = ${JSON.stringify(clientEnv)};`;
app.get('/env.js', (req, res) => {
    res.type('application/javascript').send(clientEnvScript);
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', sensorsRouter);
app.use(healthRouter);

const server = createServer(app);

server.listen(port, bindHost, () => {
    if (process.env.DEV_MODE === 'true') {
        const interfaces = os.networkInterfaces();  
        let localIp = 'localhost';
        for (const ifaces of Object.values(interfaces)) {
            for (const iface of ifaces) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    localIp = iface.address;
                    break;
                }
            }
        }
        console.log(`Lokal:   http://localhost:${port}`);
        console.log(`Network: http://${localIp}:${port}`);
    } else {
        console.log(`Server läuft auf Port ${port}`);
    }
});

let shuttingDown = false;

async function shutdown(signal) {
    if (shuttingDown) {
        console.log(`${signal} received, shutdown already in progress`);
        return;
    }
    shuttingDown = true;
    console.log(`${signal}: Shutting down server...`);

    const forceExit = setTimeout(() => {
        console.error('Forcing shutdown after timeout');
        process.exit(1);
    }, 30000);
    forceExit.unref();

    try {
        await new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
            if (typeof server.closeIdleConnections === 'function') {
                server.closeIdleConnections();
            }
        });
        console.log('HTTP server closed');

        await pool.end();
        console.log('DB pool closed');

        clearTimeout(forceExit);
        process.exit(0);
    } catch (err) {
        console.error('Error during shutdown:', err);
        clearTimeout(forceExit);
        process.exit(1);
    }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
