import express from 'express';

import { getConfig, getSnapshot, updateConfig } from '../state/store';

export function startApiServer(port: number): void {
  const app = express();
  app.use(express.json());

  app.get('/status', (_req, res) => {
    const snapshot = getSnapshot();
    if (!snapshot) {
      res.json({ status: 'no-data' });
      return;
    }
    res.json(snapshot);
  });

  app.get('/config', (_req, res) => {
    res.json(getConfig());
  });

  app.post('/config', (req, res) => {
    const body = req.body ?? {};
    const next = updateConfig({
      tickRange: typeof body.tickRange === 'number' ? body.tickRange : undefined,
      rebalanceDelaySec: typeof body.rebalanceDelaySec === 'number' ? body.rebalanceDelaySec : undefined,
      slippageBps: typeof body.slippageBps === 'number' ? body.slippageBps : undefined,
      stopLossPercent: typeof body.stopLossPercent === 'number' ? body.stopLossPercent : undefined,
      maxGasPriceGwei: typeof body.maxGasPriceGwei === 'number' ? body.maxGasPriceGwei : undefined,
    });
    res.json(next);
  });

  app.listen(port, () => {
    console.log(`API server listening on :${port}`);
  });
}
