import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import pool from '../db/pool.js';

const router = Router();
const healthLimiter = rateLimit({ windowMs: 60000, max: 60 });

router.get('/health', healthLimiter, (req, res) => {
    pool.query('SELECT 1')
        .then(() => res.json({ status: 'ok' }))
        .catch((err) => {
            console.error('Health check DB error:', err);
            res.status(500).json({
                status: 'error',
                error: 'DB connection failed',
            });
        });
});

export default router;
