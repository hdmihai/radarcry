/**
 * Inbound HTTP adapter — potențiali runneri pe 7 zile.
 *   GET /api/runners   ?tier=A,B &stage=PRE &minProbability=0.2 &limit=20 &full=1
 */
import { Router } from 'express';

export function runnersRoutes(useCases) {
  const r = Router();
  r.get('/', async (req, res) => {
    res.set('cache-control', 'public, max-age=120');
    res.json(await useCases.listRunners(req.query));
  });
  return r;
}
