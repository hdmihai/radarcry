/**
 * Inbound HTTP adapter — momentum în trepte (reguli, nu model).
 *   GET /api/step-momentum   ?limit=40
 */
import { Router } from 'express';

export function stepMomentumRoutes(useCases) {
  const r = Router();
  r.get('/', async (req, res) => {
    res.set('cache-control', 'public, max-age=120');
    res.json(await useCases.listStepMomentum(req.query));
  });
  return r;
}
