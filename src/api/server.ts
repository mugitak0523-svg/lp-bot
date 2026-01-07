import express from 'express';
import path from 'path';

import { getConfig, getSnapshot, updateConfig } from '../state/store';

export type ApiActions = {
  rebalance?: () => Promise<void>;
  close?: () => Promise<void>;
  panic?: () => Promise<void>;
};

export function startApiServer(port: number, actions: ApiActions = {}): void {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.resolve(process.cwd(), 'web')));

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

  app.post('/action/rebalance', (_req, res) => {
    if (!actions.rebalance) {
      res.status(501).json({ error: 'rebalance not configured' });
      return;
    }
    void actions.rebalance();
    res.json({ status: 'accepted' });
  });

  app.post('/action/close', (_req, res) => {
    if (!actions.close) {
      res.status(501).json({ error: 'close not configured' });
      return;
    }
    void actions.close();
    res.json({ status: 'accepted' });
  });

  app.post('/action/panic', (_req, res) => {
    if (!actions.panic) {
      res.status(501).json({ error: 'panic not configured' });
      return;
    }
    void actions.panic();
    res.json({ status: 'accepted' });
  });

  app.listen(port, () => {
    console.log(`API server listening on :${port}`);
  });
}
