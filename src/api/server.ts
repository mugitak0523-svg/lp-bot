import express from 'express';
import path from 'path';

import { getConfig, getSnapshot, updateConfig } from '../state/store';
import { getLatestActivePosition, getLatestPosition, listPositions } from '../db/positions';
import { getDb } from '../db/sqlite';

export type ApiActions = {
  rebalance?: () => Promise<void>;
  close?: () => Promise<void>;
  mint?: () => Promise<void>;
};

export function startApiServer(port: number, actions: ApiActions = {}): void {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.resolve(process.cwd(), 'web')));
  const db = getDb();

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
      targetTotalToken1: typeof body.targetTotalToken1 === 'number' ? body.targetTotalToken1 : undefined,
    });
    res.json(next);
  });

  app.get('/positions', async (req, res) => {
    const limit = Number(req.query.limit ?? '50');
    const rows = await listPositions(db, Number.isFinite(limit) ? limit : 50);
    res.json(rows);
  });

  app.get('/positions/latest', async (_req, res) => {
    const row = await getLatestPosition(db);
    if (!row) {
      res.json({ status: 'no-data' });
      return;
    }
    res.json(row);
  });

  app.get('/positions/active', async (_req, res) => {
    const row = await getLatestActivePosition(db);
    if (!row) {
      res.json({ status: 'no-data' });
      return;
    }
    res.json(row);
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

  app.post('/action/mint', async (_req, res) => {
    if (!actions.mint) {
      res.status(501).json({ error: 'mint not configured' });
      return;
    }
    try {
      await actions.mint();
      res.json({ status: 'ok' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.includes('active position') ? 409 : 500;
      res.status(status).json({ error: message });
    }
  });


  app.listen(port, () => {
    console.log(`API server listening on :${port}`);
  });
}
