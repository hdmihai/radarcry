/**
 * Inbound HTTP adapter — radar read endpoints.
 *   GET /api/radar                 filtered, sorted, paginated list (see domain/radar.js parseRadarQuery)
 *   GET /api/radar/meta            snapshot metadata only
 *   GET /api/radar/:key            one project: compact row + full dossier from the contract
 */
import { Router } from 'express';

export function radarRoutes(useCases) {
  const r = Router();

  r.get('/', async (req, res) => {
    res.set('cache-control', 'public, max-age=60');
    res.json(await useCases.listRadar(req.query));
  });

  r.get('/meta', async (req, res) => {
    const { meta } = await useCases.listRadar({ limit: 1 });
    res.set('cache-control', 'public, max-age=60');
    res.json(meta);
  });

  r.get('/:key', async (req, res) => {
    const full = req.query.full === '1' || req.query.full === 'true';
    const out = await useCases.getAsset(req.params.key);
    res.set('cache-control', 'public, max-age=60');
    res.json(full ? out : { meta: out.meta, asset: out.asset });
  });

  return r;
}
