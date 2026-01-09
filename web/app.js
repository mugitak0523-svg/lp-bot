const statusChip = document.getElementById('status-chip');
const priceEl = document.getElementById('price');
const activeTokenEl = document.getElementById('active-token');
const activeRangeEl = document.getElementById('active-range');
const activeRangePriceEl = document.getElementById('active-range-price');
const activeSizeEl = document.getElementById('active-size');
const activeStopLossEl = document.getElementById('active-stop-loss');
const activePriceEl = document.getElementById('active-price');
const activeGasEl = document.getElementById('active-gas');
const activeSwapFeeEl = document.getElementById('active-swap-fee');
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
const profitRatioSwap = document.getElementById('profit-ratio-swap');
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
const historyProfitChartEl = document.getElementById('history-profit-chart');
const historyTodayChartEl = document.getElementById('history-today-chart');
const historyTotalProfitEl = document.getElementById('history-total-profit');
const historyTodayTotalEl = document.getElementById('history-today-total');
const chartSvg = document.getElementById('price-chart');
const chartMetaEl = document.getElementById('chart-meta');
let chartProfitEl = document.getElementById('chart-profit');
const logStreamEl = document.getElementById('monitor-logs');
const logStatusEl = document.getElementById('log-status');
const configForm = document.getElementById('config-form');
const rebalanceBtn = document.getElementById('btn-rebalance');
const closeBtn = document.getElementById('btn-close');
const createBtn = document.getElementById('btn-create');
const createHint = document.getElementById('create-hint');
const navItems = document.querySelectorAll('.nav-item');

const API_BASE = window.location.origin;
let activeGasIn1 = null;
let activeSwapFeeIn1 = null;
let activeSymbol1 = null;
let activeSizeIn1 = null;
let activeCreatedAtMs = null;
let stopLossPercentValue = null;
let rebalanceDelaySecValue = null;
let profitPctValue = null;
let aprPctValue = null;
let profitToggleApr = false;
let lastRebalanceRemainingSec = null;
let lastStatusTimeMs = null;
let outOfRangeStartMs = null;
let lastOutOfRange = false;
let winRateCache = null;
let winRateLastFetch = 0;
let winRateFetching = false;
let lastProfitLabel = null;

function setProfitHeader() {
  if (!profitTotalEl) return;
  const base = lastProfitLabel ?? '-';
  profitTotalEl.textContent = base;
}

if (!chartProfitEl && chartSvg) {
  const chartHeader = document.querySelector('#card-chart .chart-header');
  if (chartHeader) {
    const span = document.createElement('span');
    span.className = 'stat-sub';
    span.id = 'chart-profit';
    span.textContent = '-';
    chartHeader.appendChild(span);
    chartProfitEl = span;
  }
}
let historyProfitChart = null;
let historyTodayChart = null;

function formatNumber(value, digits = 4) {
  return Number(value).toFixed(digits);
}

function formatSigned(value, digits = 4) {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${formatNumber(value, digits)}`;
}

function formatChartTime(epochSeconds) {
  const date = new Date(epochSeconds * 1000);
  return date.toLocaleString();
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

function computeProfitValue(row) {
  if (row.realizedPnlIn1 == null || row.realizedFeesIn1 == null || row.gasCostIn1 == null) {
    return null;
  }
  const swapFee = typeof row.swapFeeIn1 === 'number' ? row.swapFeeIn1 : 0;
  return row.realizedPnlIn1 + row.realizedFeesIn1 - row.gasCostIn1 - swapFee;
}

function setWinRateFromClosed(closed) {
  let wins = 0;
  let total = 0;
  closed.forEach((row) => {
    const profit = computeProfitValue(row);
    if (profit == null) return;
    total += 1;
    if (profit > 0) wins += 1;
  });
  winRateCache = total > 0 ? (wins / total) * 100 : null;
}

function computeHistoryApr(closed) {
  const rows = closed.filter((row) => row.closedAt);
  if (rows.length < 2) return null;
  const times = rows.map((row) => new Date(row.closedAt).getTime()).filter((t) => Number.isFinite(t));
  if (times.length < 2) return null;
  const start = Math.min(...times);
  const end = Math.max(...times);
  const elapsedSeconds = Math.max(1, (end - start) / 1000);
  const totalProfit = rows
    .map((row) => computeProfitValue(row))
    .filter((value) => value != null)
    .reduce((acc, value) => acc + value, 0);
  const totalSize = rows
    .map((row) => Number(row.netValueIn1))
    .filter((value) => Number.isFinite(value) && value > 0)
    .reduce((acc, value) => acc + value, 0);
  if (!totalSize) return null;
  const annualized = (totalProfit / totalSize) * (365 * 24 * 60 * 60 / elapsedSeconds) * 100;
  return Number.isFinite(annualized) ? annualized : null;
}

async function refreshWinRateIfNeeded() {
  if (winRateFetching) return;
  if (Date.now() - winRateLastFetch < 60000) return;
  winRateFetching = true;
  try {
    const rows = await fetchJson('/positions?limit=200');
    const closed = rows.filter((row) => row.status === 'closed');
    setWinRateFromClosed(closed);
    setProfitHeader();
  } catch (error) {
    // keep previous cache
  } finally {
    winRateLastFetch = Date.now();
    winRateFetching = false;
  }
}

function buildProfitTrend(closed) {
  const points = closed
    .filter((row) => row.closedAt)
    .map((row) => ({
      time: new Date(row.closedAt).getTime(),
      profit: computeProfitValue(row),
    }))
    .filter((row) => Number.isFinite(row.time) && row.profit != null)
    .sort((a, b) => a.time - b.time);

  let cumulative = 0;
  return points.map((point) => {
    cumulative += point.profit;
    return { time: point.time, value: cumulative };
  });
}

function buildTodayProfit(closed) {
  const now = new Date();
  const todayKey = now.toDateString();
  const buckets = Array.from({ length: 24 }, () => 0);

  closed.forEach((row) => {
    if (!row.closedAt) return;
    const time = new Date(row.closedAt);
    if (time.toDateString() !== todayKey) return;
    const profit = computeProfitValue(row);
    if (profit == null) return;
    buckets[time.getHours()] += profit;
  });

  return buckets;
}

function updateHistoryCharts(closed) {
  if (!historyProfitChartEl || !historyTodayChartEl || typeof window.Chart === 'undefined') {
    return;
  }

  if (historyTotalProfitEl) {
    const totalProfit = closed
      .map((row) => computeProfitValue(row))
      .filter((value) => value != null)
      .reduce((acc, value) => acc + value, 0);
    const aprValue = computeHistoryApr(closed);
    const winRateText = winRateCache == null ? '-' : `${formatNumber(winRateCache, 1)}%`;
    const aprText = aprValue == null ? '-' : `${formatNumber(aprValue, 1)}%`;
    historyTotalProfitEl.textContent = `Total ${formatSigned(totalProfit, 4)} (Win : ${winRateText} / APR : ${aprText})`;
  }

  const trend = buildProfitTrend(closed);
  const trendLabels = trend.map((point) => new Date(point.time).toLocaleDateString());
  const trendValues = trend.map((point) => Number(point.value.toFixed(4)));

  const todayBuckets = buildTodayProfit(closed);
  const todayValues = todayBuckets.map((value) => Number(value.toFixed(4)));
  if (historyTodayTotalEl) {
    const todayTotal = todayBuckets.reduce((acc, value) => acc + value, 0);
    const aprValue = computeHistoryApr(closed);
    const winRateText = winRateCache == null ? '-' : `${formatNumber(winRateCache, 1)}%`;
    const aprText = aprValue == null ? '-' : `${formatNumber(aprValue, 1)}%`;
    historyTodayTotalEl.textContent = `Total ${formatSigned(todayTotal, 4)} (Win : ${winRateText} / APR : ${aprText})`;
  }
  const hourLabels = Array.from({ length: 24 }, (_, idx) => `${idx}h`);

  if (!historyProfitChart) {
    historyProfitChart = new window.Chart(historyProfitChartEl.getContext('2d'), {
      type: 'line',
      data: {
        labels: trendLabels,
        datasets: [
          {
            label: 'Cumulative Profit',
            data: trendValues,
            borderColor: '#f36a2b',
            backgroundColor: 'rgba(243, 106, 43, 0.15)',
            fill: true,
            tension: 0.3,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxTicksLimit: 6 } },
          y: { ticks: { maxTicksLimit: 5 } },
        },
      },
    });
  } else {
    historyProfitChart.data.labels = trendLabels;
    historyProfitChart.data.datasets[0].data = trendValues;
    historyProfitChart.update();
  }

  if (!historyTodayChart) {
    historyTodayChart = new window.Chart(historyTodayChartEl.getContext('2d'), {
      type: 'bar',
      data: {
        labels: hourLabels,
        datasets: [
          {
            label: 'Today Profit',
            data: todayValues,
            backgroundColor: '#3b82f6',
          },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxTicksLimit: 8 } },
          y: { ticks: { maxTicksLimit: 5 } },
        },
      },
    });
  } else {
    historyTodayChart.data.labels = hourLabels;
    historyTodayChart.data.datasets[0].data = todayValues;
    historyTodayChart.update();
  }
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
    if (chartProfitEl) {
      chartProfitEl.textContent = '-';
    }
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
  const parsedTime = data.timestamp ? Date.parse(data.timestamp) : NaN;
  lastStatusTimeMs = Number.isFinite(parsedTime) ? parsedTime : Date.now();
  if (lastOutOfRange) {
    if (outOfRangeStartMs == null) {
      const baseSec = lastRebalanceRemainingSec ?? 0;
      outOfRangeStartMs = lastStatusTimeMs - baseSec * 1000;
    }
    const elapsed = Math.floor((Date.now() - outOfRangeStartMs) / 1000);
    const delaySec = rebalanceDelaySecValue ?? 0;
    const remaining = Math.max(0, delaySec - elapsed);
    rebalanceEtaEl.textContent = remaining <= 0 ? '0-' : formatDuration(remaining * 1000);
  } else {
    outOfRangeStartMs = null;
    rebalanceEtaEl.textContent = '-';
  }

  const gasIn1 = activeGasIn1 ?? 0;
  const swapFeeIn1 = activeSwapFeeIn1 ?? 0;
  const symbol1 = activeSymbol1 ?? data.symbol1 ?? '';
  const profitTotal = (data.pnl ?? 0) + (data.feeTotalIn1 ?? 0) - gasIn1 - swapFeeIn1;
  if (chartProfitEl) {
    chartProfitEl.textContent = `Total Profit ${formatSigned(profitTotal, 4)} ${symbol1}`.trim();
  }
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
  lastProfitLabel = profitLabel || '-';
  setProfitHeader();
  void refreshWinRateIfNeeded();
  profitPctValue = profitPct;
  aprPctValue = aprPct;
  updateProfitSub();
  const pnlValue = data.pnl ?? 0;
  const feeValue = data.feeTotalIn1 ?? 0;
  profitDetailEl.textContent = `PnL ${formatNumber(pnlValue, 2)} + Fees ${formatNumber(feeValue, 2)} - Gas ${formatNumber(gasIn1, 4)} - Swap ${formatNumber(swapFeeIn1, 4)}`;
  const swapValue = swapFeeIn1 ?? 0;
  const totalAbs = Math.abs(pnlValue) + Math.abs(feeValue) + Math.abs(gasIn1) + Math.abs(swapValue);
  const pnlRatio = totalAbs > 0 ? (Math.abs(pnlValue) / totalAbs) * 100 : 0;
  const feeRatio = totalAbs > 0 ? (Math.abs(feeValue) / totalAbs) * 100 : 0;
  const gasRatio = totalAbs > 0 ? (Math.abs(gasIn1) / totalAbs) * 100 : 0;
  const swapRatio = totalAbs > 0 ? (Math.abs(swapValue) / totalAbs) * 100 : 0;
  profitRatioPnl.style.width = `${pnlRatio}%`;
  profitRatioFees.style.width = `${feeRatio}%`;
  profitRatioGas.style.width = `${gasRatio}%`;
  if (profitRatioSwap) {
    profitRatioSwap.style.width = `${swapRatio}%`;
  }
  profitRatioText.textContent = `PnL ${formatNumber(pnlRatio, 2)}% / Fees ${formatNumber(feeRatio, 2)}% / Gas ${formatNumber(gasRatio, 2)}% / Swap ${formatNumber(swapRatio, 2)}%`;
  profitTotalEl.classList.toggle('profit-positive', profitTotal > 0);
  profitTotalEl.classList.toggle('profit-negative', profitTotal < 0);
  profitSubEl.classList.toggle('profit-positive', profitTotal > 0);
  profitSubEl.classList.toggle('profit-negative', profitTotal < 0);
}

async function loadConfig() {
  const config = await fetchJson('/config');
  stopLossPercentValue =
    typeof config.stopLossPercent === 'number' ? config.stopLossPercent : stopLossPercentValue;
  rebalanceDelaySecValue =
    typeof config.rebalanceDelaySec === 'number' ? config.rebalanceDelaySec : rebalanceDelaySecValue;
  Object.entries(config).forEach(([key, value]) => {
    const field = configForm.elements.namedItem(key);
    if (field) field.value = value;
  });
}

async function loadHistory() {
  const rows = await fetchJson('/positions?limit=100');
  const closed = rows.filter((row) => row.status === 'closed');
  setWinRateFromClosed(closed);
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
      const gas =
        row.gasCostIn1 != null ? `${formatSigned(-row.gasCostIn1, 4)} ${row.token1Symbol}` : '-';
      const swapFee =
        row.swapFeeIn1 != null ? `${formatSigned(-row.swapFeeIn1, 4)} ${row.token1Symbol}` : '-';
      const profitValue = computeProfitValue(row);
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
        <td>${swapFee}</td>
        <td class="history-profit ${profitClass}">${profitLabel}</td>
        <td>${closeReason}</td>
        <td>${closedAt}</td>
      </tr>`;
    })
    .join('');
  updateHistoryCharts(closed);
}

async function loadLogs() {
  if (!logStreamEl) return;
  const entries = await fetchJson('/logs?limit=30');
  if (!Array.isArray(entries) || entries.length === 0) {
    logStreamEl.textContent = '-';
    if (logStatusEl) logStatusEl.textContent = 'No logs';
    return;
  }
  const shouldStickToBottom =
    logStreamEl.scrollTop + logStreamEl.clientHeight >= logStreamEl.scrollHeight - 16;
  const text = entries
    .map((entry) => (entry?.message ? entry.message : ''))
    .filter((line) => line.length > 0)
    .join('\n\n');
  logStreamEl.textContent = text || '-';
  if (shouldStickToBottom) {
    logStreamEl.scrollTop = logStreamEl.scrollHeight;
  }
  const last = entries[entries.length - 1];
  if (logStatusEl && last?.timestamp) {
    const lastTime = new Date(last.timestamp).toLocaleTimeString();
    logStatusEl.textContent = `Last ${lastTime}`;
  }
}

function renderPriceChart(points, meta) {
  if (!chartSvg) return;
  chartSvg.innerHTML = '';
  if (!Array.isArray(points) || points.length < 2) {
    chartMetaEl.textContent = meta || 'No data';
    return;
  }

  const values = points.map((p) => p.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = 8;
  const width = 640;
  const height = 240;
  const range = max - min || 1;

  const path = points
    .map((point, index) => {
      const x = padding + (index / (points.length - 1)) * (width - padding * 2);
      const y = padding + (1 - (point.price - min) / range) * (height - padding * 2);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  pathEl.setAttribute('d', path);
  pathEl.setAttribute('fill', 'none');
  pathEl.setAttribute('stroke', '#f36a2b');
  pathEl.setAttribute('stroke-width', '2');
  pathEl.setAttribute('stroke-linecap', 'round');
  chartSvg.appendChild(pathEl);

  const latest = points[points.length - 1];
  chartMetaEl.textContent = `${formatNumber(latest.price, 4)} @ ${formatChartTime(latest.time)}`;
}

async function loadChart() {
  try {
    const data = await fetchJson('/chart?interval=hour&limit=96');
    renderPriceChart(data.points || [], data.meta);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Chart load failed';
    chartMetaEl.textContent = message.length > 80 ? `${message.slice(0, 80)}...` : message;
  }
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
    if (activeSwapFeeEl) activeSwapFeeEl.textContent = '-';
    activeStatusEl.textContent = 'no active position';
    activeStatusEl.classList.remove('status-active');
    activeGasIn1 = null;
    activeSwapFeeIn1 = null;
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
  if (activeSwapFeeEl) {
    activeSwapFeeEl.textContent =
      data.swapFeeIn1 != null ? `${formatNumber(data.swapFeeIn1, 4)} ${data.token1Symbol}` : '-';
  }
  activeStatusEl.textContent = data.status;
  activeStatusEl.classList.toggle('status-active', data.status === 'active');
  activeGasIn1 = data.gasCostIn1 ?? null;
  activeSwapFeeIn1 = data.swapFeeIn1 ?? null;
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
  const payload = Object.fromEntries(new FormData(configForm).entries());
  const numericPayload = {};
  Object.entries(payload).forEach(([key, value]) => {
    const numValue = Number(value);
    numericPayload[key] = Number.isFinite(numValue) ? numValue : value;
  });
  await fetchJson('/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(numericPayload),
  });
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
  loadChart().catch((error) => console.error(error));
  loadLogs().catch((error) => console.error(error));
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
    loadChart().catch((error) => console.error(error));
  }, 30000);
  setInterval(() => {
    loadLogs().catch((error) => console.error(error));
  }, 5000);
  setInterval(() => {
    if (activeCreatedAtMs) {
      holdTimeEl.textContent = formatDuration(Date.now() - activeCreatedAtMs);
    } else {
      holdTimeEl.textContent = '-';
    }
    if (lastOutOfRange && outOfRangeStartMs != null) {
      const elapsed = Math.floor((Date.now() - outOfRangeStartMs) / 1000);
      const delaySec = rebalanceDelaySecValue ?? 0;
      const remaining = Math.max(0, delaySec - elapsed);
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
