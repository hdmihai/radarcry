/**
 * Express application factory. Receives already-wired use-cases, so tests build it with fake
 * adapters and the server builds it with real ones — the HTTP layer is identical in both.
 */
import express from 'express';
import { analysisRoutes } from './routes/analysis.js';
import { healthRoutes } from './routes/health.js';
import { radarRoutes } from './routes/radar.js';
import { cors, errorHandler, notFoundHandler, rateLimit, requestId } from './middleware/http.js';

export function createApp({ useCases, config, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ?? false);
  app.set('json spaces', 0);

  app.use(requestId());
  app.use(cors(config.corsOrigins ?? []));
  app.use(express.json({ limit: config.bodyLimit ?? '2mb' }));
  app.use((req, res, next) => {
    res.set('x-content-type-options', 'nosniff');
    res.set('referrer-policy', 'no-referrer');
    next();
  });

  const api = express.Router();
  api.use('/health', healthRoutes(useCases, { version: config.version }));
  api.use(rateLimit({ windowMs: 60_000, max: config.rateLimitPerMinute ?? 120 }));
  api.use('/radar', radarRoutes(useCases));
  api.use('/analysis', analysisRoutes(useCases));
  app.use('/api', api);

  // Optional local preview: the same static dashboard GitHub Pages serves, plus the snapshot —
  // one command gives frontend + API + analyst on one origin (no CORS needed).
  if (config.frontendDir) {
    if (config.dataDir) app.use('/data', express.static(config.dataDir, { maxAge: 0 }));
    app.use(express.static(config.frontendDir, { extensions: ['html'] }));
  }

  app.use(notFoundHandler());
  app.use(errorHandler(logger));
  return app;
}
