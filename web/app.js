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
const profitRatioPnlPos = document.getElementById('profit-ratio-pnl-pos');
const profitRatioFeesPos = document.getElementById('profit-ratio-fees-pos');
const profitRatioPnlNeg = document.getElementById('profit-ratio-pnl-neg');
const profitRatioGas = document.getElementById('profit-ratio-gas');
const profitRatioSwap = document.getElementById('profit-ratio-swap');
const profitRatioText = document.getElementById('profit-ratio-text');
const profitRatioPositiveBar = document.getElementById('profit-ratio-positive');
const profitRatioNegativeBar = document.getElementById('profit-ratio-negative');
const ratioFill0 = document.getElementById('ratio-fill');
const ratioFill1 = document.getElementById('ratio-fill-1');
const ratioText = document.getElementById('ratio-text');
const feeRatioFill0 = document.getElementById('fee-ratio-fill');
const feeRatioFill1 = document.getElementById('fee-ratio-fill-1');
const feeRatioText = document.getElementById('fee-ratio-text');
const createdPriceEl = document.getElementById('created-price');
const holdTimeEl = document.getElementById('hold-time');
const rebalanceEtaRemainingEl = document.getElementById('rebalance-eta-remaining');
const rebalanceEtaTotalEl = document.getElementById('rebalance-eta-total');
const createdAtEl = document.getElementById('created-at');
const historyBodyEl = document.getElementById('history-body');
const historyEmptyEl = document.getElementById('history-empty');
const historyProfitChartEl = document.getElementById('history-profit-chart');
const historyTodayChartEl = document.getElementById('history-today-chart');
const historyTotalProfitEl = document.getElementById('history-total-profit');
const historyTodayTotalEl = document.getElementById('history-today-total');
const chartCanvas = document.getElementById('price-chart');
const chartMetaEl = document.getElementById('chart-meta');
let chartProfitEl = document.getElementById('chart-profit');
const logStreamEl = document.getElementById('monitor-logs');
const logStatusEl = document.getElementById('log-status');
const walletAddressEl = document.getElementById('wallet-address');
const walletToken0UsdEl = document.getElementById('wallet-token0-usd');
const walletToken1UsdEl = document.getElementById('wallet-token1-usd');
const walletNativeUsdEl = document.getElementById('wallet-native-usd');
const walletToken0AmtEl = document.getElementById('wallet-token0-amount');
const walletToken1AmtEl = document.getElementById('wallet-token1-amount');
const walletNativeAmtEl = document.getElementById('wallet-native-amount');
const walletTotalUsdEl = document.getElementById('wallet-total-usd');
const walletTotalWithPositionEl = document.getElementById('wallet-total-with-position');
const walletToken0Name = document.getElementById('wallet-token0-name');
const walletToken1Name = document.getElementById('wallet-token1-name');
const walletNativeName = document.getElementById('wallet-native-name');
const walletToken0Sub = document.getElementById('wallet-token0-sub');
const walletToken1Sub = document.getElementById('wallet-token1-sub');
const walletNativeSub = document.getElementById('wallet-native-sub');
const walletToken0Logo = document.getElementById('wallet-token0-logo');
const walletToken1Logo = document.getElementById('wallet-token1-logo');
const walletNativeLogo = document.getElementById('wallet-native-logo');
const walletToken0Fallback = document.getElementById('wallet-token0-fallback');
const walletToken1Fallback = document.getElementById('wallet-token1-fallback');
const walletNativeFallback = document.getElementById('wallet-native-fallback');
const tickRangeHintEl = document.getElementById('tick-range-price');

const TOKEN_LOGOS = {
  eth: { id: 'token-eth', viewBox: '0 0 512 512' },
  weth: { id: 'token-weth', viewBox: '0 0 70 70' },
  usdc: { id: 'token-usdc', viewBox: '0 0 70 70' },
};

function resolveTokenLogo(symbol) {
  if (!symbol) return null;
  return TOKEN_LOGOS[symbol.toLowerCase()] ?? null;
}

function setTokenLogo(logoEl, fallbackEl, symbol) {
  if (!logoEl || !fallbackEl) return;
  const logo = resolveTokenLogo(symbol);
  const useEl = logoEl.querySelector('use');
  if (logo && useEl) {
    logoEl.setAttribute('viewBox', logo.viewBox);
    useEl.setAttribute('href', `#${logo.id}`);
    logoEl.style.display = 'block';
    fallbackEl.style.display = 'none';
    fallbackEl.textContent = symbol ? symbol.slice(0, 2) : '-';
    return;
  }
  if (useEl) {
    useEl.removeAttribute('href');
  }
  logoEl.style.display = 'none';
  fallbackEl.style.display = 'block';
  fallbackEl.textContent = symbol ? symbol.slice(0, 2) : '-';
}
const configForm = document.getElementById('config-form');
const rebalanceBtn = document.getElementById('btn-rebalance');
const closeBtn = document.getElementById('btn-close');
const createBtn = document.getElementById('btn-create');
const stopAutoCloseBtn = document.getElementById('btn-stop-auto-close');
const createHint = document.getElementById('create-hint');
const navItems = document.querySelectorAll('.nav-item');

const API_BASE = window.location.origin;
let activeGasIn1 = null;
let activeSwapFeeIn1 = null;
let activeSymbol1 = null;
let activeSizeIn1 = null;
let activeCreatedAtMs = null;
let activeRangePriceLow = null;
let activeRangePriceHigh = null;
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
let lastPrice0In1 = null;
let lastSymbol0 = null;
let lastSymbol1 = null;
let lastActiveTokenId = null;
let lastPositionUsd = null;
let lastRebalanceRemainingLabel = null;
let lastRebalanceTotalLabel = null;
let stopAfterAutoCloseValue = false;
let poolPriceCache = null;
let lastPoolPriceFetchMs = 0;
let lastLogId = null;

function updateTickRangeHint() {
  if (!tickRangeHintEl || !configForm) return;
  const tickField = configForm.elements.namedItem('tickRange');
  const tickRangeValue = tickField ? Number(tickField.value) : NaN;
  if (!Number.isFinite(tickRangeValue) || tickRangeValue <= 0) {
    tickRangeHintEl.textContent = '-';
    return;
  }
  if (!Number.isFinite(lastPrice0In1) || !lastSymbol1) {
    tickRangeHintEl.textContent = '-';
    return;
  }
  const multiplier = Math.pow(1.0001, tickRangeValue);
  const lower = lastPrice0In1 / multiplier;
  const upper = lastPrice0In1 * multiplier;
  const diff = upper - lower;
  tickRangeHintEl.textContent = `${formatNumber(lower, 1)} ~ ${formatNumber(upper, 1)} ${lastSymbol1} (${formatNumber(diff, 1)} ${lastSymbol1})`;
}

async function refreshPoolPriceForRange() {
  const now = Date.now();
  if (poolPriceCache && now - lastPoolPriceFetchMs < 10000) {
    lastPrice0In1 = poolPriceCache.price0In1 ?? lastPrice0In1;
    lastSymbol0 = poolPriceCache.token0Symbol ?? lastSymbol0;
    lastSymbol1 = poolPriceCache.token1Symbol ?? lastSymbol1;
    updateTickRangeHint();
    return;
  }
  try {
    const data = await fetchJson('/pool/price');
    if (Number.isFinite(data.price0In1)) {
      lastPrice0In1 = data.price0In1;
    }
    lastSymbol0 = data.token0Symbol ?? lastSymbol0;
    lastSymbol1 = data.token1Symbol ?? lastSymbol1;
    poolPriceCache = data;
    lastPoolPriceFetchMs = now;
  } catch (error) {
    return;
  }
  updateTickRangeHint();
}

function setProfitHeader() {
  if (!profitTotalEl) return;
  const base = lastProfitLabel ?? '-';
  profitTotalEl.textContent = base;
}

if (!chartProfitEl && chartCanvas) {
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

function formatChartTimeShort(epochSeconds) {
  const date = new Date(epochSeconds * 1000);
  return date.toLocaleString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function extractLogPrice(message) {
  if (!message) return null;
  const lines = message.split('\n');
  for (const line of lines) {
    if (!line.trim().startsWith('Price')) continue;
    const match = line.match(/=\s*([0-9][0-9,]*\.?[0-9]*)/);
    if (!match) continue;
    const value = Number.parseFloat(match[1].replace(/,/g, ''));
    return Number.isFinite(value) ? value : null;
  }
  return null;
}

function tickToPrice(tick, token0Decimals, token1Decimals) {
  const decimalAdjust = Math.pow(10, token0Decimals - token1Decimals);
  return Math.pow(1.0001, tick) * decimalAdjust;
}

function formatPercent(value) {
  const digits = Math.abs(value) >= 100 ? 0 : 2;
  return formatSigned(value, digits);
}

function formatUsd(value) {
  if (!Number.isFinite(value)) return '-';
  return `$${formatNumber(value, 2)}`;
}

function isUsdSymbol(symbol) {
  if (!symbol) return false;
  return symbol.toUpperCase().includes('USD');
}

function formatAddress(address) {
  if (!address || address.length < 10) return address || '-';
  return `${address.slice(0, 6)}...${address.slice(-5)}`;
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

function applyConfigToForm(config) {
  if (!configForm || !config) return;
  const setField = (name, value) => {
    const field = configForm.elements.namedItem(name);
    if (!field || value == null) return;
    field.value = String(value);
  };
  setField('tickRange', config.tickRange);
  setField('rebalanceDelaySec', config.rebalanceDelaySec);
  setField('slippageBps', config.slippageBps);
  setField('stopLossPercent', config.stopLossPercent);
  setField('maxGasPriceGwei', config.maxGasPriceGwei);
  setField('targetTotalToken1', config.targetTotalToken1);
  updateTickRangeHint();
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad2 = (value) => String(value).padStart(2, '0');
  if (days > 0) return `${days}d ${pad2(hours)}h ${pad2(minutes)}m ${pad2(seconds)}s`;
  if (hours > 0) return `${pad2(hours)}h ${pad2(minutes)}m ${pad2(seconds)}s`;
  return `${pad2(minutes)}m ${pad2(seconds)}s`;
}

function formatRebalanceRemaining(rawRemainingSec) {
  if (rawRemainingSec == null) return '-';
  if (rawRemainingSec <= 0) {
    return `-${formatDuration(Math.abs(rawRemainingSec) * 1000)}`;
  }
  return formatDuration(rawRemainingSec * 1000);
}

function formatRebalanceTotal(totalSec) {
  return totalSec > 0 ? `/ ${formatDuration(totalSec * 1000)}` : '/ -';
}

function setRebalanceLabels(remainingLabel, totalLabel) {
  if (rebalanceEtaRemainingEl) {
    if (remainingLabel !== lastRebalanceRemainingLabel || rebalanceEtaRemainingEl.textContent !== remainingLabel) {
      lastRebalanceRemainingLabel = remainingLabel;
      rebalanceEtaRemainingEl.textContent = remainingLabel;
    }
    const delaySec = rebalanceDelaySecValue ?? 0;
    const remainingSec = lastRebalanceRemainingSec ?? null;
    const shouldWarn = delaySec > 0 && typeof remainingSec === 'number' && remainingSec > 0 && remainingSec <= delaySec * 0.1;
    rebalanceEtaRemainingEl.classList.toggle('warn', shouldWarn);
  }
  if (rebalanceEtaTotalEl) {
    if (totalLabel !== lastRebalanceTotalLabel || rebalanceEtaTotalEl.textContent !== totalLabel) {
      lastRebalanceTotalLabel = totalLabel;
      rebalanceEtaTotalEl.textContent = totalLabel;
    }
  }
}

function computeProfitValue(row) {
  if (row.realizedPnlIn1 == null || row.realizedFeesIn1 == null || row.gasCostIn1 == null) {
    return null;
  }
  const swapFee = typeof row.swapFeeIn1 === 'number' ? row.swapFeeIn1 : 0;
  return row.realizedPnlIn1 + row.realizedFeesIn1 - row.gasCostIn1 - swapFee;
}

function computeInterestLabel(row) {
  const profitValue = computeProfitValue(row);
  if (profitValue == null || row.netValueIn1 == null) return '-';
  const base = Number(row.netValueIn1);
  if (!Number.isFinite(base) || base <= 0) return '-';
  if (!row.createdAt || !row.closedAt) return '-';
  const startMs = Date.parse(row.createdAt);
  const endMs = Date.parse(row.closedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return '-';
  const seconds = Math.max(1, (endMs - startMs) / 1000);
  const rate = (profitValue / base) * 100;
  const apr = rate * (365 * 24 * 60 * 60 / seconds);
  return `${formatSigned(rate, 2)}% (${formatSigned(apr, 0)}%)`;
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
    netValueEl.textContent = '-';
    netPnlEl.textContent = '';
    netPnlEl.classList.add('hidden');
    feesEl.textContent = '-';
    lastPrice0In1 = null;
    lastSymbol0 = null;
    lastSymbol1 = null;
    lastPositionUsd = null;
    ratioFill0.style.width = '50%';
    ratioFill1.style.width = '50%';
    ratioText.textContent = '-';
    feeRatioFill0.style.width = '50%';
    feeRatioFill1.style.width = '50%';
    feeRatioText.textContent = '-';
    createdPriceEl.textContent = '-';
    holdTimeEl.textContent = '-';
    setRebalanceLabels('-', formatRebalanceTotal(rebalanceDelaySecValue ?? 0));
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
    if (profitRatioPnlPos) profitRatioPnlPos.style.width = '0%';
    if (profitRatioFeesPos) profitRatioFeesPos.style.width = '0%';
    if (profitRatioPnlNeg) profitRatioPnlNeg.style.width = '0%';
    if (profitRatioGas) profitRatioGas.style.width = '0%';
    if (profitRatioSwap) profitRatioSwap.style.width = '0%';
    if (profitRatioPositiveBar) profitRatioPositiveBar.style.width = '0%';
    if (profitRatioNegativeBar) profitRatioNegativeBar.style.width = '0%';
    if (profitRatioText) profitRatioText.textContent = '-';
    profitTotalEl.classList.remove('profit-positive', 'profit-negative');
    await refreshPoolPriceForRange();
    return;
  }

  const inRange = data.status === 'IN RANGE';
  statusChip.textContent = data.status || 'active';
  statusChip.className = `status-pill ${inRange ? 'ok' : 'warn'}`;
  priceEl.textContent = `1 ${data.symbol0} = ${formatNumber(data.price0In1, 4)} ${data.symbol1}`;
  lastPrice0In1 = Number.isFinite(data.price0In1) ? data.price0In1 : null;
  lastSymbol0 = data.symbol0 ?? null;
  lastSymbol1 = data.symbol1 ?? null;
  lastPositionUsd = isUsdSymbol(lastSymbol1) ? data.netValueIn1 ?? null : null;
  updateTickRangeHint();
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

  const wasOutOfRange = lastOutOfRange;
  lastOutOfRange = Boolean(data.outOfRange);
  lastRebalanceRemainingSec =
    typeof data.rebalanceRemainingSec === 'number' ? data.rebalanceRemainingSec : null;
  const parsedTime = data.timestamp ? Date.parse(data.timestamp) : NaN;
  lastStatusTimeMs = Number.isFinite(parsedTime) ? parsedTime : Date.now();
  if (lastOutOfRange) {
    const parsedStart = data.outOfRangeStartAt ? Date.parse(data.outOfRangeStartAt) : NaN;
    if (Number.isFinite(parsedStart)) {
      outOfRangeStartMs = parsedStart;
    } else if (!wasOutOfRange || outOfRangeStartMs == null) {
      outOfRangeStartMs = lastStatusTimeMs;
    }
    const elapsed = Math.floor((Date.now() - outOfRangeStartMs) / 1000);
    const delaySec = rebalanceDelaySecValue ?? 0;
    const rawRemaining = delaySec - elapsed;
    setRebalanceLabels(formatRebalanceRemaining(rawRemaining), formatRebalanceTotal(delaySec));
  } else {
    outOfRangeStartMs = null;
    setRebalanceLabels('-', formatRebalanceTotal(rebalanceDelaySecValue ?? 0));
  }

  const gasIn1 = activeGasIn1 ?? 0;
  const swapFeeIn1 = activeSwapFeeIn1 ?? 0;
  const symbol1 = activeSymbol1 ?? data.symbol1 ?? '';
  const profitTotal = (data.pnl ?? 0) + (data.feeTotalIn1 ?? 0) - gasIn1 - swapFeeIn1;
  // chart header shows latest pool price, not total profit.
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

  const pnlPos = Math.max(pnlValue, 0);
  const feePos = Math.max(feeValue, 0);
  const pnlNeg = Math.max(-pnlValue, 0);
  const feeNeg = Math.max(-feeValue, 0);
  const gasAbs = Math.abs(gasIn1 ?? 0);
  const swapAbs = Math.abs(swapFeeIn1 ?? 0);

  const posTotal = pnlPos + feePos;
  const negTotal = pnlNeg + feeNeg + gasAbs + swapAbs;
  const maxTotal = Math.max(posTotal, negTotal);
  const posScale = maxTotal > 0 ? (posTotal / maxTotal) * 100 : 0;
  const negScale = maxTotal > 0 ? (negTotal / maxTotal) * 100 : 0;

  const pnlPosRatio = posTotal > 0 ? (pnlPos / posTotal) * 100 : 0;
  const feePosRatio = posTotal > 0 ? (feePos / posTotal) * 100 : 0;
  const pnlNegRatio = negTotal > 0 ? (pnlNeg / negTotal) * 100 : 0;
  const gasNegRatio = negTotal > 0 ? (gasAbs / negTotal) * 100 : 0;
  const swapNegRatio = negTotal > 0 ? (swapAbs / negTotal) * 100 : 0;

  if (profitRatioPnlPos) profitRatioPnlPos.style.width = `${pnlPosRatio}%`;
  if (profitRatioFeesPos) profitRatioFeesPos.style.width = `${feePosRatio}%`;
  if (profitRatioPnlNeg) profitRatioPnlNeg.style.width = `${pnlNegRatio}%`;
  if (profitRatioGas) profitRatioGas.style.width = `${gasNegRatio}%`;
  if (profitRatioSwap) profitRatioSwap.style.width = `${swapNegRatio}%`;
  if (profitRatioPositiveBar) {
    profitRatioPositiveBar.style.width = `${posScale}%`;
  }
  if (profitRatioNegativeBar) {
    profitRatioNegativeBar.style.width = `${negScale}%`;
  }

  if (profitRatioText) {
    const totalAbs = posTotal + negTotal;
    const pnlTotalRatio = totalAbs > 0 ? (Math.abs(pnlValue) / totalAbs) * 100 : 0;
    const feeTotalRatio = totalAbs > 0 ? (Math.abs(feeValue) / totalAbs) * 100 : 0;
    const gasTotalRatio = totalAbs > 0 ? (gasAbs / totalAbs) * 100 : 0;
    const swapTotalRatio = totalAbs > 0 ? (swapAbs / totalAbs) * 100 : 0;
    profitRatioText.textContent =
      totalAbs > 0
        ? `PnL ${formatNumber(pnlTotalRatio, 2)}% / Fees ${formatNumber(feeTotalRatio, 2)}% / Gas ${formatNumber(
            gasTotalRatio,
            2
          )}% / Swap ${formatNumber(swapTotalRatio, 2)}%`
        : '-';
  }
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
  stopAfterAutoCloseValue =
    typeof config.stopAfterAutoClose === 'boolean' ? config.stopAfterAutoClose : stopAfterAutoCloseValue;
  if (stopAutoCloseBtn) {
    stopAutoCloseBtn.classList.toggle('active', stopAfterAutoCloseValue);
    stopAutoCloseBtn.textContent = stopAfterAutoCloseValue ? 'Auto Close Only (ON)' : 'Auto Close Only (OFF)';
  }
  applyConfigToForm(config);
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
      const interestLabel = computeInterestLabel(row);
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
        <td>${interestLabel}</td>
        <td>${closeReason}</td>
        <td>${closedAt}</td>
        <td>
          <button class="icon-btn delete-row" data-token-id="${tokenId}" title="Delete">
            <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
              <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
            </svg>
          </button>
        </td>
      </tr>`;
    })
    .join('');
  historyBodyEl.querySelectorAll('.delete-row').forEach((btn) => {
    btn.addEventListener('click', async (event) => {
      const target = event.currentTarget;
      const tokenId = target?.dataset?.tokenId;
      if (!tokenId) return;
      const ok = confirm(`Token ID ${tokenId} を削除しますか？`);
      if (!ok) return;
      await fetchJson('/positions/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tokenIds: [tokenId] }),
      });
      await loadHistory();
    });
  });
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
    const ageMs = Date.now() - Date.parse(last.timestamp);
    const ageSec = Number.isFinite(ageMs) ? Math.max(0, Math.floor(ageMs / 1000)) : null;
    let ageLabel = '';
    if (ageSec != null) {
      const hours = Math.floor(ageSec / 3600);
      const minutes = Math.floor((ageSec % 3600) / 60);
      const seconds = ageSec % 60;
      if (hours > 0) {
        ageLabel = ` (${hours}h ${minutes}m ${seconds}s ago)`;
      } else if (minutes > 0) {
        ageLabel = ` (${minutes}m ${seconds}s ago)`;
      } else {
        ageLabel = ` (${seconds}s ago)`;
      }
    }
    logStatusEl.textContent = `Last ${lastTime}${ageLabel}`;
  }

  const latestId = last?.id ?? null;
  if (latestId != null && latestId !== lastLogId) {
    lastLogId = latestId;
    const points = entries
      .map((entry) => {
        const price = extractLogPrice(entry?.message);
        const timeMs = entry?.timestamp ? Date.parse(entry.timestamp) : NaN;
        if (!Number.isFinite(price) || !Number.isFinite(timeMs)) return null;
        return { time: Math.floor(timeMs / 1000), price };
      })
      .filter((point) => point != null)
      .sort((a, b) => a.time - b.time);
    // Render pool price chart from log buffer.
    renderPriceChart(points, 'No log data');
  }
}

async function loadWallet() {
  if (!walletAddressEl) return;
  try {
    const data = await fetchJson('/wallet/balances');
    walletAddressEl.textContent = formatAddress(data.owner);
    const token0Symbol = data.token0?.symbol ?? 'Token0';
    const token1Symbol = data.token1?.symbol ?? 'Token1';
    const nativeSymbol = data.native?.symbol ?? 'ETH';
    if (walletToken0Name) walletToken0Name.textContent = token0Symbol;
    if (walletToken1Name) walletToken1Name.textContent = token1Symbol;
    if (walletNativeName) walletNativeName.textContent = nativeSymbol;
    if (walletToken0Sub) walletToken0Sub.textContent = 'Token';
    if (walletToken1Sub) walletToken1Sub.textContent = 'Token';
    if (walletNativeSub) walletNativeSub.textContent = 'Native';
    setTokenLogo(walletToken0Logo, walletToken0Fallback, token0Symbol);
    setTokenLogo(walletToken1Logo, walletToken1Fallback, token1Symbol);
    setTokenLogo(walletNativeLogo, walletNativeFallback, nativeSymbol);
    const balance0 = data.token0?.balance;
    const balance1 = data.token1?.balance;
    const nativeBalance = data.native?.balance;
    const usdSymbol = lastSymbol1 && lastSymbol1.toUpperCase().includes('USD') ? lastSymbol1 : null;
    const canPriceToken0 =
      usdSymbol && lastSymbol0 && token0Symbol.toLowerCase() === lastSymbol0.toLowerCase() && lastPrice0In1;
    const canPriceToken1 =
      usdSymbol && token1Symbol.toLowerCase() === usdSymbol.toLowerCase();
    const canPriceNative =
      usdSymbol && lastSymbol0 && ['eth', 'weth'].includes(lastSymbol0.toLowerCase()) && lastPrice0In1;

    const apiToken0Usd = data.token0?.usdPrice;
    const apiToken1Usd = data.token1?.usdPrice;
    const apiNativeUsd = data.native?.usdPrice;

    const token0Usd =
      Number.isFinite(apiToken0Usd) && Number.isFinite(balance0)
        ? balance0 * apiToken0Usd
        : canPriceToken0 && Number.isFinite(balance0)
          ? balance0 * (lastPrice0In1 ?? 0)
          : null;
    const token1Usd =
      Number.isFinite(apiToken1Usd) && Number.isFinite(balance1)
        ? balance1 * apiToken1Usd
        : canPriceToken1 && Number.isFinite(balance1)
          ? balance1
          : null;
    const nativeUsd =
      Number.isFinite(apiNativeUsd) && Number.isFinite(nativeBalance)
        ? nativeBalance * apiNativeUsd
        : canPriceNative && Number.isFinite(nativeBalance)
          ? nativeBalance * (lastPrice0In1 ?? 0)
          : null;

    walletToken0UsdEl.textContent = token0Usd != null ? formatUsd(token0Usd) : '$-';
    walletToken1UsdEl.textContent = token1Usd != null ? formatUsd(token1Usd) : '$-';
    walletNativeUsdEl.textContent = nativeUsd != null ? formatUsd(nativeUsd) : '$-';

    const totalUsd = [token0Usd, token1Usd, nativeUsd].filter((val) => Number.isFinite(val)).reduce((acc, val) => acc + val, 0);
    walletTotalUsdEl.textContent = totalUsd > 0 ? formatUsd(totalUsd) : '$-';
    if (walletTotalWithPositionEl) {
      if (Number.isFinite(lastPositionUsd) && (totalUsd > 0 || lastPositionUsd > 0)) {
        walletTotalWithPositionEl.textContent = `(${formatUsd(totalUsd + lastPositionUsd)})`;
      } else {
        walletTotalWithPositionEl.textContent = '(-)';
      }
    }

    walletToken0AmtEl.textContent =
      balance0 != null ? `${formatNumber(balance0, 6)} ${token0Symbol}` : '-';
    walletToken1AmtEl.textContent =
      balance1 != null ? `${formatNumber(balance1, 6)} ${token1Symbol}` : '-';
    walletNativeAmtEl.textContent =
      nativeBalance != null ? `${formatNumber(nativeBalance, 6)} ${nativeSymbol}` : '-';
  } catch (error) {
    walletAddressEl.textContent = '-';
    walletToken0UsdEl.textContent = '-';
    walletToken1UsdEl.textContent = '-';
    walletNativeUsdEl.textContent = '-';
    if (walletTotalUsdEl) walletTotalUsdEl.textContent = '-';
    if (walletTotalWithPositionEl) walletTotalWithPositionEl.textContent = '-';
    walletToken0AmtEl.textContent = '-';
    walletToken1AmtEl.textContent = '-';
    walletNativeAmtEl.textContent = '-';
    if (walletToken0Name) walletToken0Name.textContent = '-';
    if (walletToken1Name) walletToken1Name.textContent = '-';
    if (walletNativeName) walletNativeName.textContent = '-';
    if (walletToken0Sub) walletToken0Sub.textContent = '-';
    if (walletToken1Sub) walletToken1Sub.textContent = '-';
    if (walletNativeSub) walletNativeSub.textContent = '-';
    setTokenLogo(walletToken0Logo, walletToken0Fallback, '-');
    setTokenLogo(walletToken1Logo, walletToken1Fallback, '-');
    setTokenLogo(walletNativeLogo, walletNativeFallback, '-');
  }
}

let poolPriceChart = null;

function renderPriceChart(points, meta) {
  if (!chartCanvas || !chartMetaEl || typeof window.Chart === 'undefined') return;
  if (!Array.isArray(points) || points.length < 1) {
    chartMetaEl.textContent = meta || 'No data';
    if (poolPriceChart) {
      poolPriceChart.data.labels = [];
      poolPriceChart.data.datasets[0].data = [];
      poolPriceChart.update();
    }
    return;
  }

  const labels = points.map((point) => formatChartTimeShort(point.time));
  const values = points.map((point) => point.price);
  const rangeLow = Number.isFinite(activeRangePriceLow) ? activeRangePriceLow : null;
  const rangeHigh = Number.isFinite(activeRangePriceHigh) ? activeRangePriceHigh : null;
  const rangeLowData = rangeLow != null ? labels.map(() => rangeLow) : [];
  const rangeHighData = rangeHigh != null ? labels.map(() => rangeHigh) : [];

  const inRangeLine = lastOutOfRange ? '#ef4444' : '#84cc16';
  const inRangeFill = lastOutOfRange ? 'rgba(239, 68, 68, 0.08)' : 'rgba(132, 204, 22, 0.08)';
  const priceLine = lastOutOfRange ? '#ef4444' : '#16a34a';

  if (!poolPriceChart) {
    poolPriceChart = new window.Chart(chartCanvas.getContext('2d'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            data: values,
            borderColor: priceLine,
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.3,
            pointRadius: 0,
          },
          {
            data: rangeLowData,
            borderColor: inRangeLine,
            backgroundColor: 'transparent',
            fill: false,
            tension: 0,
            pointRadius: 0,
            borderDash: [6, 4],
          },
          {
            data: rangeHighData,
            borderColor: inRangeLine,
            backgroundColor: inRangeFill,
            fill: '-1',
            tension: 0,
            pointRadius: 0,
            borderDash: [6, 4],
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { maxTicksLimit: 6 } },
          y: { ticks: { maxTicksLimit: 5 } },
        },
      },
    });
  } else {
    poolPriceChart.data.labels = labels;
    poolPriceChart.data.datasets[0].data = values;
    poolPriceChart.data.datasets[0].borderColor = priceLine;
    poolPriceChart.data.datasets[1].data = rangeLowData;
    poolPriceChart.data.datasets[1].borderColor = inRangeLine;
    poolPriceChart.data.datasets[2].data = rangeHighData;
    poolPriceChart.data.datasets[2].borderColor = inRangeLine;
    poolPriceChart.data.datasets[2].backgroundColor = inRangeFill;
    poolPriceChart.update();
  }

  const latest = points[points.length - 1];
  const symbol = lastSymbol1 ?? '';
  const timeLabel = new Date(latest.time * 1000).toLocaleTimeString('ja-JP', { hour12: false });
  const priceLabel = `${formatNumber(latest.price, 0)} ${symbol} @ ${timeLabel}`.trim();
  if (chartProfitEl) chartProfitEl.textContent = priceLabel;
  chartMetaEl.textContent = '';
}

async function loadChart() {
  renderPriceChart([], 'Waiting for log data');
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
    activeRangePriceLow = null;
    activeRangePriceHigh = null;
    lastActiveTokenId = null;
    outOfRangeStartMs = null;
    lastOutOfRange = false;
    createBtn.disabled = false;
    createHint.textContent = '';
    return;
  }
  if (data.tokenId && data.tokenId !== lastActiveTokenId) {
    lastActiveTokenId = data.tokenId;
    outOfRangeStartMs = null;
    lastOutOfRange = false;
  }
  activeTokenEl.textContent = data.tokenId;
  const tickRangeLabel =
    typeof data.configTickRange === 'number' ? ` (±${data.configTickRange})` : '';
  activeRangeEl.textContent = `${data.tickLower} ~ ${data.tickUpper}${tickRangeLabel}`;
  const tickLower = Number(data.tickLower);
  const tickUpper = Number(data.tickUpper);
  const dec0 = Number(data.token0Decimals);
  const dec1 = Number(data.token1Decimals);
  if (Number.isFinite(tickLower) && Number.isFinite(tickUpper) && Number.isFinite(dec0) && Number.isFinite(dec1)) {
    const priceLower = tickToPrice(tickLower, dec0, dec1);
    const priceUpper = tickToPrice(tickUpper, dec0, dec1);
    const minPrice = Math.min(priceLower, priceUpper);
    const maxPrice = Math.max(priceLower, priceUpper);
    const priceDiff = maxPrice - minPrice;
    activeRangePriceEl.textContent = `${formatNumber(minPrice, 4)} ~ ${formatNumber(maxPrice, 4)} ${data.token1Symbol} (${formatNumber(priceDiff, 4)} ${data.token1Symbol})`;
    activeRangePriceLow = minPrice;
    activeRangePriceHigh = maxPrice;
  } else {
    activeRangePriceEl.textContent = '-';
    activeRangePriceLow = null;
    activeRangePriceHigh = null;
  }
  const createdSize = Number(data.netValueIn1);
  activeSizeIn1 = Number.isFinite(createdSize) && createdSize > 0 ? createdSize : null;
  activeSizeEl.textContent = `${formatNumber(data.netValueIn1, 4)} ${data.token1Symbol}`;
  const positionConfig = {
    tickRange: data.configTickRange,
    rebalanceDelaySec: data.configRebalanceDelaySec,
    slippageBps: data.configSlippageBps,
    stopLossPercent: data.configStopLossPercent,
    maxGasPriceGwei: data.configMaxGasPriceGwei,
    targetTotalToken1: data.configTargetTotalToken1,
  };
  applyConfigToForm(positionConfig);
  if (typeof data.configStopLossPercent === 'number') {
    stopLossPercentValue = data.configStopLossPercent;
  }
  if (typeof data.configRebalanceDelaySec === 'number') {
    rebalanceDelaySecValue = data.configRebalanceDelaySec;
  }
  if (data.configStopAfterAutoClose != null) {
    stopAfterAutoCloseValue = Boolean(data.configStopAfterAutoClose);
    if (stopAutoCloseBtn) {
      stopAutoCloseBtn.classList.toggle('active', stopAfterAutoCloseValue);
      stopAutoCloseBtn.textContent = stopAfterAutoCloseValue ? 'Auto Close Only (ON)' : 'Auto Close Only (OFF)';
    }
  }
  if (stopLossPercentValue == null) {
    const stopLossField = configForm.elements.namedItem('stopLossPercent');
    const stopLossInput = stopLossField ? Number(stopLossField.value) : NaN;
    if (Number.isFinite(stopLossInput)) {
      stopLossPercentValue = stopLossInput;
    }
  }
  if (activeSizeIn1 != null && stopLossPercentValue != null) {
    const stopLossValue = activeSizeIn1 * (1 - stopLossPercentValue / 100);
    const stopDiff = activeSizeIn1 - stopLossValue;
    activeStopLossEl.textContent = `${formatNumber(stopLossValue, 4)} ${data.token1Symbol} (${formatNumber(stopDiff, 4)} ${data.token1Symbol})`;
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

if (configForm) {
  const tickField = configForm.elements.namedItem('tickRange');
  if (tickField) {
    tickField.addEventListener('input', updateTickRangeHint);
  }
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

if (stopAutoCloseBtn) {
  stopAutoCloseBtn.addEventListener('click', async () => {
    stopAfterAutoCloseValue = !stopAfterAutoCloseValue;
    await fetchJson('/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stopAfterAutoClose: stopAfterAutoCloseValue }),
    });
    await loadConfig();
  });
}


async function boot() {
  try {
    await Promise.all([loadConfig(), loadStatus(), loadActivePosition()]);
  } catch (error) {
    console.error(error);
  }
  // Pool price chart now uses log buffer updates.
  loadLogs().catch((error) => console.error(error));
  loadWallet().catch((error) => console.error(error));
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
    loadWallet().catch((error) => console.error(error));
  }, 10000);
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
      const rawRemaining = delaySec - elapsed;
      setRebalanceLabels(formatRebalanceRemaining(rawRemaining), formatRebalanceTotal(delaySec));
    } else {
      setRebalanceLabels('-', formatRebalanceTotal(rebalanceDelaySecValue ?? 0));
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
