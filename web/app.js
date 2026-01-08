const statusChip = document.getElementById('status-chip');
const priceEl = document.getElementById('price');
const activeTokenEl = document.getElementById('active-token');
const activeRangeEl = document.getElementById('active-range');
const activeRangePriceEl = document.getElementById('active-range-price');
const activeSizeEl = document.getElementById('active-size');
const activeStopLossEl = document.getElementById('active-stop-loss');
const activePriceEl = document.getElementById('active-price');
const activeGasEl = document.getElementById('active-gas');
const activeStatusEl = document.getElementById('active-status');
const netValueEl = document.getElementById('net-value');
const netPnlEl = document.getElementById('net-pnl');
const feesEl = document.getElementById('fees');
const profitTotalEl = document.getElementById('profit-total');
const profitSubEl = document.getElementById('profit-sub');
const profitDetailEl = document.getElementById('profit-detail');
const profitRatioPnl = document.getElementById('profit-ratio-pnl');
const profitRatioFees = document.getElementById('profit-ratio-fees');
const profitRatioGas = document.getElementById('profit-ratio-gas');
const profitRatioText = document.getElementById('profit-ratio-text');
const ratioFill0 = document.getElementById('ratio-fill');
const ratioFill1 = document.getElementById('ratio-fill-1');
const ratioText = document.getElementById('ratio-text');
const feeRatioFill0 = document.getElementById('fee-ratio-fill');
const feeRatioFill1 = document.getElementById('fee-ratio-fill-1');
const feeRatioText = document.getElementById('fee-ratio-text');
const createdPriceEl = document.getElementById('created-price');
const holdTimeEl = document.getElementById('hold-time');
const rebalanceEtaEl = document.getElementById('rebalance-eta');
const createdAtEl = document.getElementById('created-at');
const historyBodyEl = document.getElementById('history-body');
const historyEmptyEl = document.getElementById('history-empty');
const configForm = document.getElementById('config-form');
const rebalanceBtn = document.getElementById('btn-rebalance');
const closeBtn = document.getElementById('btn-close');
const createBtn = document.getElementById('btn-create');
const createHint = document.getElementById('create-hint');
const navItems = document.querySelectorAll('.nav-item');

const API_BASE = window.location.origin;
let activeGasIn1 = null;
let activeSymbol1 = null;
let activeSizeIn1 = null;
let activeCreatedAtMs = null;
let stopLossPercentValue = null;
let profitPctValue = null;
let aprPctValue = null;
let profitToggleApr = false;
let lastRebalanceRemainingSec = null;
let lastStatusTimeMs = null;
let lastOutOfRange = false;

function formatNumber(value, digits = 4) {
  return Number(value).toFixed(digits);
}

function formatSigned(value, digits = 4) {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${formatNumber(value, digits)}`;
}

function tickToPrice(tick, token0Decimals, token1Decimals) {
  const decimalAdjust = Math.pow(10, token0Decimals - token1Decimals);
  return Math.pow(1.0001, tick) * decimalAdjust;
}

function formatPercent(value) {
  const digits = Math.abs(value) >= 100 ? 0 : 2;
  return formatSigned(value, digits);
}

function updateProfitSub() {
  if (profitPctValue == null) {
    profitSubEl.textContent = '-';
    return;
  }
  if (profitToggleApr && aprPctValue != null) {
    profitSubEl.textContent = `(${formatPercent(aprPctValue)}%)`;
    return;
  }
  profitSubEl.textContent = `(${formatPercent(profitPctValue)}%)`;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad2 = (value) => String(value).padStart(2, '0');
  if (days > 0) return `${days}d ${pad2(hours)}h ${pad2(minutes)}m`;
  if (hours > 0) return `${pad2(hours)}h ${pad2(minutes)}m`;
  return `${pad2(minutes)}m ${pad2(seconds)}s`;
}

function setActiveView(viewName) {
  const targetId = `view-${viewName}`;
  const targetView = document.getElementById(targetId);
  const resolvedView = targetView ? targetId : 'view-positions';
  document.querySelectorAll('.view').forEach((view) => {
    view.classList.toggle('view-active', view.id === resolvedView);
  });
  navItems.forEach((item) => {
    item.classList.toggle('active', item.dataset.view === (targetView ? viewName : 'positions'));
  });
  if (resolvedView === 'view-history') {
    loadHistory().catch((error) => console.error(error));
  }
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
    holdTimeEl.textContent = '-';
    rebalanceEtaEl.textContent = '-';
    createdAtEl.textContent = '-';
    profitTotalEl.textContent = '-';
    profitPctValue = null;
    aprPctValue = null;
    profitToggleApr = false;
    updateProfitSub();
    profitDetailEl.textContent = '-';
    profitRatioPnl.style.width = '33%';
    profitRatioFees.style.width = '33%';
    profitRatioGas.style.width = '34%';
    profitRatioText.textContent = '-';
    profitTotalEl.classList.remove('profit-positive', 'profit-negative');
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

  lastOutOfRange = Boolean(data.outOfRange);
  lastRebalanceRemainingSec =
    typeof data.rebalanceRemainingSec === 'number' ? data.rebalanceRemainingSec : null;
  lastStatusTimeMs = data.timestamp ? Date.parse(data.timestamp) : Date.now();
  if (lastOutOfRange && lastRebalanceRemainingSec != null) {
    rebalanceEtaEl.textContent =
      lastRebalanceRemainingSec <= 0 ? '0-' : formatDuration(lastRebalanceRemainingSec * 1000);
  } else {
    rebalanceEtaEl.textContent = '-';
  }

  const gasIn1 = activeGasIn1 ?? 0;
  const symbol1 = activeSymbol1 ?? data.symbol1 ?? '';
  const profitTotal = (data.pnl ?? 0) + (data.feeTotalIn1 ?? 0) - gasIn1;
  const baseSize = activeSizeIn1 ?? 0;
  const profitPct = baseSize > 0 ? (profitTotal / baseSize) * 100 : null;
  let aprPct = null;
  if (baseSize > 0 && activeCreatedAtMs) {
    const elapsedSeconds = Math.max(1, (Date.now() - activeCreatedAtMs) / 1000);
    const annualized = (profitTotal / baseSize) * (365 * 24 * 60 * 60 / elapsedSeconds) * 100;
    if (Number.isFinite(annualized)) {
      aprPct = annualized;
    }
  }
  const profitLabel = `${formatSigned(profitTotal, 4)} ${symbol1}`.trim();
  profitTotalEl.textContent = profitLabel || '-';
  profitPctValue = profitPct;
  aprPctValue = aprPct;
  updateProfitSub();
  const pnlValue = data.pnl ?? 0;
  const feeValue = data.feeTotalIn1 ?? 0;
  profitDetailEl.textContent = `PnL ${formatNumber(pnlValue, 2)} + Fees ${formatNumber(feeValue, 2)} - Gas ${formatNumber(gasIn1, 4)}`;
  const totalAbs = Math.abs(pnlValue) + Math.abs(feeValue) + Math.abs(gasIn1);
  const pnlRatio = totalAbs > 0 ? (Math.abs(pnlValue) / totalAbs) * 100 : 0;
  const feeRatio = totalAbs > 0 ? (Math.abs(feeValue) / totalAbs) * 100 : 0;
  const gasRatio = totalAbs > 0 ? (Math.abs(gasIn1) / totalAbs) * 100 : 0;
  profitRatioPnl.style.width = `${pnlRatio}%`;
  profitRatioFees.style.width = `${feeRatio}%`;
  profitRatioGas.style.width = `${gasRatio}%`;
  profitRatioText.textContent = `PnL ${formatNumber(pnlRatio, 2)}% / Fees ${formatNumber(feeRatio, 2)}% / Gas ${formatNumber(gasRatio, 2)}%`;
  profitTotalEl.classList.toggle('profit-positive', profitTotal > 0);
  profitTotalEl.classList.toggle('profit-negative', profitTotal < 0);
  profitSubEl.classList.toggle('profit-positive', profitTotal > 0);
  profitSubEl.classList.toggle('profit-negative', profitTotal < 0);
}

async function loadConfig() {
  const config = await fetchJson('/config');
  stopLossPercentValue =
    typeof config.stopLossPercent === 'number' ? config.stopLossPercent : stopLossPercentValue;
  Object.entries(config).forEach(([key, value]) => {
    const field = configForm.elements.namedItem(key);
    if (field) field.value = value;
  });
}

async function loadHistory() {
  const rows = await fetchJson('/positions?limit=100');
  const closed = rows.filter((row) => row.status === 'closed');
  if (closed.length === 0) {
    historyBodyEl.innerHTML = '';
    historyEmptyEl.textContent = 'No closed positions.';
    return;
  }
  historyEmptyEl.textContent = '';
  historyBodyEl.innerHTML = closed
    .map((row) => {
      const tokenId = row.tokenId ?? '-';
      const range = row.tickLower != null && row.tickUpper != null ? `tick ${row.tickLower} ~ ${row.tickUpper}` : '-';
      const size = row.netValueIn1 != null ? `${formatNumber(row.netValueIn1, 4)} ${row.token1Symbol}` : '-';
      const closedNet =
        row.closedNetValueIn1 != null ? `${formatNumber(row.closedNetValueIn1, 4)} ${row.token1Symbol}` : '-';
      const fees = row.realizedFeesIn1 != null ? `${formatNumber(row.realizedFeesIn1, 4)} ${row.token1Symbol}` : '-';
      const pnl = row.realizedPnlIn1 != null ? `${formatSigned(row.realizedPnlIn1, 4)} ${row.token1Symbol}` : '-';
      const gas = row.gasCostIn1 != null ? `${formatNumber(row.gasCostIn1, 4)} ${row.token1Symbol}` : '-';
      const profitValue =
        row.realizedPnlIn1 != null && row.realizedFeesIn1 != null && row.gasCostIn1 != null
          ? row.realizedPnlIn1 + row.realizedFeesIn1 - row.gasCostIn1
          : null;
      const profitLabel = profitValue != null ? `${formatSigned(profitValue, 4)} ${row.token1Symbol}` : '-';
      const profitClass = profitValue == null ? '' : profitValue >= 0 ? 'positive' : 'negative';
      const closeReason = row.closeReason ?? '-';
      const closedAt = row.closedAt ? new Date(row.closedAt).toLocaleString() : '-';
      return `<tr>
        <td>${tokenId}</td>
        <td>${range}</td>
        <td>${size}</td>
        <td>${closedNet}</td>
        <td>${fees}</td>
        <td>${pnl}</td>
        <td>${gas}</td>
        <td class="history-profit ${profitClass}">${profitLabel}</td>
        <td>${closeReason}</td>
        <td>${closedAt}</td>
      </tr>`;
    })
    .join('');
}

async function loadActivePosition() {
  const data = await fetchJson('/positions/active');
  if (data.status === 'no-data') {
    activeTokenEl.textContent = '-';
    activeRangeEl.textContent = '-';
    activeRangePriceEl.textContent = '-';
    activeSizeEl.textContent = '-';
    activeStopLossEl.textContent = '-';
    activePriceEl.textContent = '-';
    activeGasEl.textContent = '-';
    activeStatusEl.textContent = 'no active position';
    activeGasIn1 = null;
    activeSymbol1 = null;
    activeSizeIn1 = null;
    activeCreatedAtMs = null;
    createBtn.disabled = false;
    createHint.textContent = '';
    return;
  }
  activeTokenEl.textContent = data.tokenId;
  activeRangeEl.textContent = `tick ${data.tickLower} ~ ${data.tickUpper}`;
  const tickLower = Number(data.tickLower);
  const tickUpper = Number(data.tickUpper);
  const dec0 = Number(data.token0Decimals);
  const dec1 = Number(data.token1Decimals);
  if (Number.isFinite(tickLower) && Number.isFinite(tickUpper) && Number.isFinite(dec0) && Number.isFinite(dec1)) {
    const priceLower = tickToPrice(tickLower, dec0, dec1);
    const priceUpper = tickToPrice(tickUpper, dec0, dec1);
    const minPrice = Math.min(priceLower, priceUpper);
    const maxPrice = Math.max(priceLower, priceUpper);
    activeRangePriceEl.textContent = `${formatNumber(minPrice, 4)} ~ ${formatNumber(maxPrice, 4)} ${data.token1Symbol}`;
  } else {
    activeRangePriceEl.textContent = '-';
  }
  const createdSize = Number(data.netValueIn1);
  activeSizeIn1 = Number.isFinite(createdSize) && createdSize > 0 ? createdSize : null;
  activeSizeEl.textContent = `${formatNumber(data.netValueIn1, 4)} ${data.token1Symbol}`;
  if (stopLossPercentValue == null) {
    const stopLossField = configForm.elements.namedItem('stopLossPercent');
    const stopLossInput = stopLossField ? Number(stopLossField.value) : NaN;
    if (Number.isFinite(stopLossInput)) {
      stopLossPercentValue = stopLossInput;
    }
  }
  if (activeSizeIn1 != null && stopLossPercentValue != null) {
    const stopLossValue = activeSizeIn1 * (1 - stopLossPercentValue / 100);
    activeStopLossEl.textContent = `${formatNumber(stopLossValue, 4)} ${data.token1Symbol}`;
  } else {
    activeStopLossEl.textContent = '-';
  }
  activePriceEl.textContent = `1 ${data.token0Symbol} = ${formatNumber(data.price0In1, 4)} ${data.token1Symbol}`;
  activeGasEl.textContent =
    data.gasCostIn1 != null ? `${formatNumber(data.gasCostIn1, 4)} ${data.token1Symbol}` : '-';
  activeStatusEl.textContent = data.status;
  activeGasIn1 = data.gasCostIn1 ?? null;
  activeSymbol1 = data.token1Symbol ?? null;
  activeCreatedAtMs = data.createdAt ? Date.parse(data.createdAt) : null;
  createdPriceEl.textContent = activePriceEl.textContent;
  if (activeCreatedAtMs) {
    holdTimeEl.textContent = formatDuration(Date.now() - activeCreatedAtMs);
    createdAtEl.textContent = new Date(activeCreatedAtMs).toLocaleString();
  } else {
    holdTimeEl.textContent = '-';
    createdAtEl.textContent = '-';
  }
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
  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      const viewName = item.dataset.view;
      if (!viewName) return;
      setActiveView(viewName);
    });
  });
  setInterval(() => {
    loadStatus().catch((error) => console.error(error));
    loadActivePosition().catch((error) => console.error(error));
  }, 4000);
  setInterval(() => {
    if (activeCreatedAtMs) {
      holdTimeEl.textContent = formatDuration(Date.now() - activeCreatedAtMs);
    } else {
      holdTimeEl.textContent = '-';
    }
    if (lastOutOfRange && lastRebalanceRemainingSec != null && lastStatusTimeMs) {
      const elapsed = Math.floor((Date.now() - lastStatusTimeMs) / 1000);
      const remaining = Math.max(0, lastRebalanceRemainingSec - elapsed);
      rebalanceEtaEl.textContent = remaining <= 0 ? '0-' : formatDuration(remaining * 1000);
    }
  }, 1000);
  setInterval(() => {
    if (profitPctValue != null) {
      profitToggleApr = !profitToggleApr;
      updateProfitSub();
    }
  }, 5000);
}

boot();
