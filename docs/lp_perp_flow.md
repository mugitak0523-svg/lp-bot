# LP+PERP Flow Spec

## Scope
- This spec defines the end-to-end flow for creating and closing LP positions with a linked PERP hedge.
- It covers the runtime sequence, data persistence, and error handling.
- LP behavior should remain unchanged; PERP is layered on top without altering existing LP logic.

## Components
- Node app (lp-bot): `src/index.ts`, `src/bot/*`, `src/db/*`, `src/api/server.ts`
- PERP CLI bridge: `src/extended/cli.py` (calls Extended SDK)
- Extended SDK app: `extended_example/app/main.py`
- SQLite: `data/lpbot.db`

## Data Model (DB)
- `positions`: LP positions
- `perp_trades`: PERP fills linked to LP `token_id`

## Preconditions
- LP settings loaded from DB first, falling back to `.env` (chain, pool, wallet, etc.)
- PERP settings loaded from `.env` (X10_* keys)
- Node API server is running (`npm start`)
- Python dependencies installed (`extended_example/requirements.txt`)

## Flow: LP Create + PERP Hedge
1) Rebalance starts
- Trigger: scheduled monitor or `/action/rebalance`
- If out-of-range or no active position, start new cycle.

2) LP mint
- Build mint params from pool state and config.
- Execute mint transaction on-chain.
- Capture `tokenId`, `amount0/1`, `price`, `net_value`, etc.

3) Persist LP position
- Insert into `positions` with `token_id` and status = `active`.

4) PERP hedge order (SELL)
- Strict order: only after LP mint completes without error.
- Determine hedge size based on LP exposure (token0 or token1).
- Call `POST /orders/market` on Node API.
- Node API calls `src/extended/cli.py` -> `extended_example/app/main.py`.
- Extended SDK submits a market order (IOC).
- It retries `get_order_by_id` up to 5 times with 2s interval.
- If still not found, it falls back to latest 10 trades to find matching `order_id`.
- Response returns:
  - `order_id`, `external_id`, `retry_attempts`
  - `order` (details) or `order.trade` (fallback)

5) Persist PERP trade(s)
- For each fill in `order` or `trade`:
  - Insert into `perp_trades` with `token_id` (LP tokenId), `order_id`, `trade_id`, `side`, `qty`, `price`, `fee`, `created_time`, `raw_json`.

## Flow: LP Close + PERP Close
1) LP close starts
- Trigger: rebalance decision or `/action/close`.
- Close LP position on-chain (burn).
- Capture `close_tx_hash`, `closed_net_value`, `realized_pnl`, etc.

2) Persist LP close
- Update `positions` row with close fields and status = `closed`.

3) PERP close order (BUY)
- Strict order: only after LP close completes without error.
- Determine hedge size to close (matching current PERP position).
- Submit market order with opposite `side`.
- Same retry + fallback as in LP create flow.

4) Persist PERP trade(s)
- Insert fills into `perp_trades` with the same LP `token_id`.

## Error Handling
- PERP failures should not roll back LP on-chain actions.
- If PERP order fails:
  - Return error to API caller.
  - Record failure in logs for manual follow-up.
- If PERP order succeeds but details missing:
  - Store `order_id` and retry lookup later via `/orders/:id` or `/trades`.

## IDs and Precision
- `order_id` values exceed JS safe integers.
- Always pass `order_id` as string between Node <-> Python.
- `src/extended/cli.py` converts large ints to strings before JSON output.

## Suggested API Usage
- Place hedge order:
  - `POST /orders/market`
- Fetch order details:
  - `GET /orders/:id`
- Fetch recent trades:
  - `GET /trades?market=ETH-USD&limit=10`

## Next Steps (Implementation)
- Add perp sizing logic in rebalance flow.
- Add DB write helpers for `perp_trades`.
- Wire calls into `runRebalance` and close flows.
