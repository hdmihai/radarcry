/** GET /api/health — liveness of the API, the snapshot and the Python analyst (200 ok/degraded, 503 down). */
import { Router } from 'express';

export function healthRoutes(useCases, { version }) {
  const r = Router();
  r.get('/', async (req, res) => {
    const h = await useCases.health();
    res.status(h.status === 'down' ? 503 : 200).json({ service: 'radarcry-api-node', version, ...h });
  });
  return r;
}
