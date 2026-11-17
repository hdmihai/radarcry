/**
 * Inbound HTTP adapter — quantitative analysis, delegated to the Python analyst through AnalystPort.
 *   GET  /api/analysis/universe            cross-sectional ranks + correlation clusters (accepts radar filters)
 *   GET  /api/analysis/:key[?refresh=1]    one project's quant metrics (pandas) + verdict
 *   POST /api/analysis/series              ad-hoc series {closes[], volumes?[], periodsPerYear?}
 *   GET  /api/analysis/onchain/:chain/:address   ERC-20 facts read with Web3 (public RPC)
 */
import { Router } from 'express';

export function analysisRoutes(useCases) {
  const r = Router();

  r.get('/universe', async (req, res) => {
    res.json(await useCases.analyzeUniverse(req.query));
  });

  r.post('/series', async (req, res) => {
    res.json(await useCases.analyzeSeries(req.body));
  });

  r.get('/onchain/:chain/:address', async (req, res) => {
    res.json(await useCases.onchain(req.params.chain, req.params.address));
  });

  r.get('/:key', async (req, res) => {
    const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
    res.json(await useCases.analyzeAsset(req.params.key, { refresh }));
  });

  return r;
}
