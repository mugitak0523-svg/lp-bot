const statusChip = document.getElementById('status-chip');
const priceEl = document.getElementById('price');
const activeTokenEl = document.getElementById('active-token');
const activeRangeEl = document.getElementById('active-range');
const activeSizeEl = document.getElementById('active-size');
const activePriceEl = document.getElementById('active-price');
const activeStatusEl = document.getElementById('active-status');
const netValueEl = document.getElementById('net-value');
const netPnlEl = document.getElementById('net-pnl');
const feesEl = document.getElementById('fees');
const ratioFill0 = document.getElementById('ratio-fill');
const ratioFill1 = document.getElementById('ratio-fill-1');
const ratioText = document.getElementById('ratio-text');
const feeRatioFill0 = document.getElementById('fee-ratio-fill');
const feeRatioFill1 = document.getElementById('fee-ratio-fill-1');
const feeRatioText = document.getElementById('fee-ratio-text');
const feesCard = document.getElementById('card-fees');
const createdPriceEl = document.getElementById('created-price');
const configForm = document.getElementById('config-form');
const rebalanceBtn = document.getElementById('btn-rebalance');
const closeBtn = document.getElementById('btn-close');
const createBtn = document.getElementById('btn-create');
const createHint = document.getElementById('create-hint');

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
    statusChip.className = 'status-pill';
    netPnlEl.textContent = '';
    netPnlEl.classList.add('hidden');
    ratioFill0.style.width = '50%';
    ratioFill1.style.width = '50%';
    ratioText.textContent = '-';
    feeRatioFill0.style.width = '50%';
    feeRatioFill1.style.width = '50%';
    feeRatioText.textContent = '-';
    createdPriceEl.textContent = '-';
    feesCard.classList.remove('positive', 'negative');
    return;
  }

  const inRange = data.status === 'IN RANGE';
  statusChip.textContent = data.status || 'active';
  statusChip.className = `status-pill ${inRange ? 'ok' : 'warn'}`;
  priceEl.textContent = `1 ${data.symbol0} = ${formatNumber(data.price0In1, 4)} ${data.symbol1}`;
  netValueEl.textContent = `${formatNumber(data.netValueIn1, 4)} ${data.symbol1}`;
  const pnlText = `${data.pnl >= 0 ? '+' : ''}${formatNumber(data.pnl, 2)} (${formatNumber(data.pnlPct, 1)}%)`;
  netPnlEl.textContent = pnlText;
  netPnlEl.classList.remove('hidden');
  feesEl.textContent = `${formatNumber(data.feeTotalIn1, 4)} ${data.symbol1} (+${formatNumber(data.feeYieldPct, 2)}%)`;
  const ratio0 = Math.max(0, Math.min(100, data.ratio0 ?? 0));
  const ratio1 = Math.max(0, Math.min(100, 100 - ratio0));
  ratioFill0.style.width = `${ratio0}%`;
  ratioFill1.style.width = `${ratio1}%`;
  ratioText.textContent = `${data.symbol0} ${formatNumber(ratio0, 2)}% / ${data.symbol1} ${formatNumber(ratio1, 2)}%`;

  const fee0In1 = (data.fee0 ?? 0) * (data.price0In1 ?? 0);
  const fee1In1 = data.fee1 ?? 0;
  const feeTotal = fee0In1 + fee1In1;
  const feeRatio0 = feeTotal > 0 ? (fee0In1 / feeTotal) * 100 : 0;
  const feeRatio1 = feeTotal > 0 ? (fee1In1 / feeTotal) * 100 : 0;
  feeRatioFill0.style.width = `${feeRatio0}%`;
  feeRatioFill1.style.width = `${feeRatio1}%`;
  feeRatioText.textContent = `${data.symbol0} ${formatNumber(feeRatio0, 2)}% / ${data.symbol1} ${formatNumber(feeRatio1, 2)}%`;

  const pnlPlusFees = (data.pnl ?? 0) + (data.feeTotalIn1 ?? 0);
  feesCard.classList.toggle('positive', pnlPlusFees > 0);
  feesCard.classList.toggle('negative', pnlPlusFees < 0);
}

async function loadConfig() {
  const config = await fetchJson('/config');
  Object.entries(config).forEach(([key, value]) => {
    const field = configForm.elements.namedItem(key);
    if (field) field.value = value;
  });
}

async function loadActivePosition() {
  const data = await fetchJson('/positions/active');
  if (data.status === 'no-data') {
    activeTokenEl.textContent = '-';
    activeRangeEl.textContent = '-';
    activeSizeEl.textContent = '-';
    activePriceEl.textContent = '-';
    activeStatusEl.textContent = 'no active position';
    createBtn.disabled = false;
    createHint.textContent = '';
    return;
  }
  activeTokenEl.textContent = data.tokenId;
  activeRangeEl.textContent = `tick ${data.tickLower} ~ ${data.tickUpper}`;
  activeSizeEl.textContent = `${formatNumber(data.netValueIn1, 4)} ${data.token1Symbol}`;
  activePriceEl.textContent = `1 ${data.token0Symbol} = ${formatNumber(data.price0In1, 4)} ${data.token1Symbol}`;
  activeStatusEl.textContent = data.status;
  createdPriceEl.textContent = activePriceEl.textContent;
  const isActive = data.status === 'active';
  createBtn.disabled = isActive;
  createHint.textContent = isActive ? 'Activeポジションがあるため作成できません' : '';
}

configForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (createBtn.disabled) return;
  await fetchJson('/action/mint', { method: 'POST' });
});

rebalanceBtn.addEventListener('click', async () => {
  if (!confirm('今すぐリバランスを実行しますか？')) return;
  await fetchJson('/action/rebalance', { method: 'POST' });
});


closeBtn.addEventListener('click', async () => {
  if (!confirm('リバランスせずにポジションをクローズしますか？')) return;
  await fetchJson('/action/close', { method: 'POST' });
});


async function boot() {
  try {
    await Promise.all([loadConfig(), loadStatus(), loadActivePosition()]);
  } catch (error) {
    console.error(error);
  }
  setInterval(() => {
    loadStatus().catch((error) => console.error(error));
    loadActivePosition().catch((error) => console.error(error));
  }, 4000);
}

boot();
