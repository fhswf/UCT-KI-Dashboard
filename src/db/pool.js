import { Pool } from 'pg';

const apiTimeoutMs = parseInt(process.env.API_TIMEOUT_MS, 10) || 30000;

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 30000,
    options: `-c statement_timeout=${apiTimeoutMs}`,
});

pool.connect()
    .then((client) => {
        console.log('DB-Verbindung erfolgreich');
        client.release();
    })
    .catch((err) => {
        console.error('DB-Verbindungsfehler', err);
    });

pool.on('error', (err) => {
    console.error('Unerwarteter Fehler auf der DB-Verbindung', err);
});

export default pool;
