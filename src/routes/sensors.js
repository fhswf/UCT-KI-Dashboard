import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import pool from '../db/pool.js';
import { isValidSensorId, isValidEndParam } from '../middleware/validators.js';

const router = Router();
const DWD_ID = process.env.DWD_ID || 'DWD001';

const strictLimiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_STRICT_WINDOW_MS, 10) || 10000,
    max: parseInt(process.env.RATE_LIMIT_STRICT_MAX, 10) || 10,
});

// Caching query results
let cache = null;
let cacheTime = 0;
const TTL = 5 * 60 * 1000;
let pendingFetch = null;

router.get('/sensors', async (req, res) => {
    try {
        if (cache && Date.now() - cacheTime < TTL) {
            res.set('Cache-Control', 'public, max-age=300');
            return res.json(cache);
        }

        if (!pendingFetch) {
            pendingFetch = (async () => {
                const today = new Date().toISOString();
                const result = await pool.query(
                    `
                    SELECT q.id, q.typ,
                           ST_AsGeoJSON(ST_Transform(l.center, 4326)) AS geometry
                    FROM quelle q
                    JOIN location l ON l.id = q.location_id
                    WHERE q.typ = 'senseBox'
                      AND l.center IS NOT NULL
                      AND q.until_date > $1;
                `,
                    [today],
                );

                const geoJson = {
                    type: 'FeatureCollection',
                    features: result.rows.map((row) => ({
                        type: 'Feature',
                        properties: { id: row.id, typ: row.typ },
                        geometry: JSON.parse(row.geometry),
                    })),
                };
                cache = geoJson;
                cacheTime = Date.now();
                return geoJson;
            })().finally(() => {
                pendingFetch = null;
            });
        }

        const geoJson = await pendingFetch;
        res.set('Cache-Control', 'public, max-age=300');
        res.json(geoJson);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'DB Fehler bei Sensordaten' });
    }
});

router.get('/sensor/:id/neighbors', strictLimiter, async (req, res) => {
    try {
        if (!isValidSensorId(req.params.id)) {
            return res.status(400).json({ error: 'Ungültige Sensor-ID' });
        }

        const query = `
        SELECT
            target.id, 
            target.typ
        FROM quelle ref
        JOIN location l_ref on l_ref.id = ref.location_id
        JOIN quelle target on target.id != ref.id
        JOIN location l_target on l_target.id = target.location_id
        WHERE ref.id = $1
        AND target.typ IN ('DL Wetterstation', 'Weitere-Sensoren', 'DL Windsensor')
        AND ST_Intersects(l_ref.area_validity, l_target.center)
        `;
        const result = await pool.query(query, [req.params.id]);

        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'DB Fehler bei Nachbarsensoren' });
    }
});

router.get('/sensor/:id/measurements', strictLimiter, async (req, res) => {
    try {
        if (!isValidSensorId(req.params.id)) {
            return res.status(400).json({ error: 'Ungültige Sensor-ID' });
        }
        if (!isValidEndParam(req.query.end)) {
            return res.status(400).json({ error: 'Ungültiges End-Datum' });
        }
        const endTime = req.query.end ? new Date(req.query.end) : new Date();

        const query = `
        SELECT
            messzeit_utc,
            (measurement_data -> 'temperature' ->> 'value')::float as temperature_raw,
            (corrected_values -> 'temperature' -> 'previous' ->> 'stage_1')::float as temperature_ki_s1,
            (corrected_values -> 'temperature' -> 'previous' ->> 'stage_2')::float as temperature_ki_s2
        FROM messungen m
        WHERE m.quell_id = $1
        AND messzeit_utc < $2
        AND messzeit_utc >= $2 - interval '24 hours'
        ORDER BY messzeit_utc ASC;
        `;
        const result = await pool.query(query, [req.params.id, endTime]);

        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'DB Fehler bei Messdaten' });
    }
});

router.get('/sensor/dwd', strictLimiter, async (req, res) => {
    try {
        if (!isValidEndParam(req.query.end)) {
            return res.status(400).json({ error: 'Ungültiges End-Datum' });
        }
        const endTime = req.query.end ? new Date(req.query.end) : new Date();

        const query = `
        SELECT
            messzeit_utc,
            (measurement_data -> 'air_temperature' ->> 'value')::float as dwd_temperature,
            (corrected_values -> 'temperature' -> 'main' ->> 'value')::float as dwd_smooth_temperature
        FROM messungen m
        WHERE m.quell_id = $1
        AND messzeit_utc < $2
        AND messzeit_utc >= $2 - interval '24 hours'
        ORDER BY messzeit_utc ASC;
        `;
        const result = await pool.query(query, [DWD_ID, endTime]);

        res.json(result.rows);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'DB Fehler bei DWD Daten' });
    }
});

export default router;
