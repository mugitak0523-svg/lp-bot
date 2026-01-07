const statusChip = document.getElementById('status-chip');
const priceEl = document.getElementById('price');
const rangeEl = document.getElementById('range');
const assetEl = document.getElementById('asset');
const netValueEl = document.getElementById('net-value');
const pnlEl = document.getElementById('pnl');
const feesEl = document.getElementById('fees');
const configForm = document.getElementById('config-form');
const rebalanceBtn = document.getElementById('btn-rebalance');
const closeBtn = document.getElementById('btn-close');
const panicBtn = document.getElementById('btn-panic');

const API_BASE = window.location.origin;

function formatNumber(value, digits = 4) {
  return Number(value).toFixed(digits);
}

async function fetchJson(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}

async function loadStatus() {
  const data = await fetchJson('/status');
  if (data.status === 'no-data') {
    statusChip.textContent = 'no-data';
    return;
  }

  statusChip.textContent = data.status || 'active';
  priceEl.textContent = `1 ${data.symbol0} = ${formatNumber(data.price0In1, 4)} ${data.symbol1}`;
  rangeEl.textContent = `tick ${data.tickLower} ~ ${data.tickUpper} (now ${data.currentTick})`;
  assetEl.textContent = `${data.symbol0} ${formatNumber(data.ratio0, 0)}% / ${data.symbol1} ${formatNumber(data.ratio1, 0)}%`;
  netValueEl.textContent = `${formatNumber(data.netValueIn1, 4)} ${data.symbol1}`;
  pnlEl.textContent = `${data.pnl >= 0 ? '+' : ''}${formatNumber(data.pnl, 4)} ${data.symbol1} (${formatNumber(data.pnlPct, 2)}%)`;
  feesEl.textContent = `${formatNumber(data.feeTotalIn1, 4)} ${data.symbol1} (+${formatNumber(data.feeYieldPct, 2)}%)`;
}

async function loadConfig() {
  const config = await fetchJson('/config');
  Object.entries(config).forEach(([key, value]) => {
    const field = configForm.elements.namedItem(key);
    if (field) field.value = value;
  });
}

configForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const payload = {};
  ['tickRange', 'rebalanceDelaySec', 'slippageBps', 'stopLossPercent', 'maxGasPriceGwei'].forEach((key) => {
    const field = configForm.elements.namedItem(key);
    if (field && field.value !== '') {
      payload[key] = Number(field.value);
    }
  });
  await fetchJson('/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
});

rebalanceBtn.addEventListener('click', async () => {
  if (!confirm('今すぐリバランスを実行しますか？')) return;
  await fetchJson('/action/rebalance', { method: 'POST' });
});

closeBtn.addEventListener('click', async () => {
  if (!confirm('リバランスせずにポジションをクローズしますか？')) return;
  await fetchJson('/action/close', { method: 'POST' });
});

panicBtn.addEventListener('click', async () => {
  if (!confirm('緊急停止: 全解除してプロセスを終了します。実行しますか？')) return;
  await fetchJson('/action/panic', { method: 'POST' });
});

async function boot() {
  try {
    await Promise.all([loadConfig(), loadStatus()]);
  } catch (error) {
    console.error(error);
  }
  setInterval(() => {
    loadStatus().catch((error) => console.error(error));
  }, 4000);
}

boot();
