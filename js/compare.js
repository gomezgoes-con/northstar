/**
 * Query comparison functionality
 */

import { parseNumericValue, sumMetric, formatNumber, formatBytes, formatTime } from './utils.js';
import { findConnectorScans } from './scanParser.js';
import { findHashJoins, combineJoinOperators, calculateJoinStats, sumOperatorTimesByPlanNodeId, extractJoinMetrics } from './joinParser.js';
import { trackEvent } from './analytics.js';

// Store loaded comparison data
let compareData = {
  baseline: null,
  optimized: null
};

/**
 * Setup comparison drop zones
 */
export function setupCompareDropZone(dropZoneId, fileInputId, type) {
  const dropZone = document.getElementById(dropZoneId);
  const fileInput = document.getElementById(fileInputId);

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.json')) {
      loadCompareFile(file, type, dropZone);
    }
  });

  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      loadCompareFile(file, type, dropZone);
    }
  });
}

/**
 * Load a comparison file
 */
function loadCompareFile(file, type, dropZone) {
  const reader = new FileReader();
  
  reader.onload = (e) => {
    try {
      const json = JSON.parse(e.target.result);
      const query = json.Query;
      
      if (!query) {
        alert('Invalid query profile format');
        return;
      }

      // Extract data
      const summary = query.Summary || {};
      const execution = query.Execution || {};
      const scans = findConnectorScans(execution);

      // Extract join data
      const { probes, builds } = findHashJoins(execution);
      const joins = combineJoinOperators(probes, builds);
      const planNodeIds = new Set(joins.map(j => j.planNodeId));
      const totalTimesByPlanNodeId = sumOperatorTimesByPlanNodeId(execution, planNodeIds);

      // Build join metrics with total time (using extractJoinMetrics for proper structure)
      const joinMetrics = joins.map(join => {
        const totalTime = totalTimesByPlanNodeId.get(join.planNodeId) || 0;
        return extractJoinMetrics(join, totalTime, null);
      });

      const joinStats = calculateJoinStats(joinMetrics);

      compareData[type] = {
        summary,
        execution,
        scans,
        joins: joinMetrics,
        joinStats,
        filename: file.name
      };

      // Update drop zone to show loaded state
      dropZone.classList.add('loaded');
      dropZone.innerHTML = `
        <h3>${type === 'baseline' ? '📊 Baseline' : '🚀 Optimized'}</h3>
        <p class="loaded-info">✓ ${file.name}</p>
        <p>${summary['Query ID'] || 'Unknown'}</p>
        <p>Duration: ${summary['Total'] || 'N/A'}</p>
      `;

      // Track successful upload
      trackEvent(`upload-compare-${type}`);

      // Check if both files are loaded
      if (compareData.baseline && compareData.optimized) {
        renderComparison();
      }
    } catch (error) {
      console.error('Error parsing JSON:', error);
      alert('Error parsing JSON: ' + error.message);
    }
  };

  reader.readAsText(file);
}

/**
 * Render the comparison view
 */
function renderComparison() {
  const results = document.getElementById('compareResults');
  results.classList.add('visible');

  const baseline = compareData.baseline;
  const optimized = compareData.optimized;

  // Render query info
  document.getElementById('compareMetaBaseline').innerHTML = `
    <span>Query ID:</span><strong>${baseline.summary['Query ID'] || 'N/A'}</strong>
    <span>Duration:</span><strong>${baseline.summary['Total'] || 'N/A'}</strong>
  `;
  document.getElementById('compareMetaOptimized').innerHTML = `
    <span>Query ID:</span><strong>${optimized.summary['Query ID'] || 'N/A'}</strong>
    <span>Duration:</span><strong>${optimized.summary['Total'] || 'N/A'}</strong>
  `;

  // Memory comparison
  const memoryMetrics = [
    { key: 'QueryAllocatedMemoryUsage', label: 'Allocated Memory' },
    { key: 'QuerySumMemoryUsage', label: 'Sum Memory Usage' },
  ];
  renderCompareCards('compareMemoryCards', memoryMetrics, baseline.execution, optimized.execution, true);

  // Time comparison
  const timeMetrics = [
    { key: 'QueryCumulativeCpuTime', label: 'CPU Time' },
    { key: 'QueryCumulativeScanTime', label: 'Scan Time' },
    { key: 'QueryCumulativeOperatorTime', label: 'Operator Time' },
    { key: 'QueryCumulativeNetworkTime', label: 'Network Time' },
  ];
  renderCompareCards('compareTimeCards', timeMetrics, baseline.execution, optimized.execution, true);

  // Scan metrics comparison
  const scanCards = [
    {
      label: 'Connector Scan Operators',
      baseline: baseline.scans.length,
      optimized: optimized.scans.length,
      lowerIsBetter: true
    },
    {
      label: 'Total Bytes Read',
      baseline: sumMetric(baseline.scans, 'BytesRead', 'unique'),
      optimized: sumMetric(optimized.scans, 'BytesRead', 'unique'),
      format: 'bytes',
      lowerIsBetter: true
    },
    {
      label: 'Total Rows Scanned',
      baseline: sumMetric(baseline.scans, 'RawRowsRead', 'unique'),
      optimized: sumMetric(optimized.scans, 'RawRowsRead', 'unique'),
      format: 'number',
      lowerIsBetter: true
    },
    {
      label: 'Total Rows Read',
      baseline: sumMetric(baseline.scans, 'RowsRead', 'unique'),
      optimized: sumMetric(optimized.scans, 'RowsRead', 'unique'),
      format: 'number',
      lowerIsBetter: true
    },
  ];
  document.getElementById('compareScanCards').innerHTML = generateCompareCardsHTML(scanCards);

  // Join metrics comparison
  // Note: Time metrics are sum of avg time per instance, not total query time
  const joinCards = [
    {
      label: 'Join Operators',
      baseline: baseline.joinStats.totalJoins,
      optimized: optimized.joinStats.totalJoins,
      lowerIsBetter: true
    },
    {
      label: 'Hash Table Memory',
      baseline: baseline.joinStats.totalHashTableMemoryBytes,
      optimized: optimized.joinStats.totalHashTableMemoryBytes,
      format: 'bytes',
      lowerIsBetter: true
    },
    {
      label: 'Rows Spilled',
      baseline: baseline.joinStats.totalRowsSpilled,
      optimized: optimized.joinStats.totalRowsSpilled,
      format: 'number',
      lowerIsBetter: true
    },
    {
      label: 'Join Time (Avg/Instance)',
      baseline: baseline.joinStats.totalTimeSeconds,
      optimized: optimized.joinStats.totalTimeSeconds,
      format: 'time',
      lowerIsBetter: true
    },
    {
      label: 'Build Time (Avg/Instance)',
      baseline: baseline.joinStats.totalBuildTimeSeconds,
      optimized: optimized.joinStats.totalBuildTimeSeconds,
      format: 'time',
      lowerIsBetter: true
    },
    {
      label: 'Probe Time (Avg/Instance)',
      baseline: baseline.joinStats.totalProbeTimeSeconds,
      optimized: optimized.joinStats.totalProbeTimeSeconds,
      format: 'time',
      lowerIsBetter: true
    },
  ];
  document.getElementById('compareJoinCards').innerHTML = generateCompareCardsHTML(joinCards);
}

/**
 * Render comparison cards from execution object
 */
function renderCompareCards(containerId, metrics, baselineExec, optimizedExec, lowerIsBetter) {
  const container = document.getElementById(containerId);
  
  container.innerHTML = metrics.map(metric => {
    const baselineVal = baselineExec[metric.key] || 'N/A';
    const optimizedVal = optimizedExec[metric.key] || 'N/A';
    
    const baselineNum = parseNumericValue(baselineVal);
    const optimizedNum = parseNumericValue(optimizedVal);
    
    const change = baselineNum > 0 ? ((optimizedNum - baselineNum) / baselineNum) * 100 : 0;
    const improved = lowerIsBetter ? change < 0 : change > 0;
    const changeClass = Math.abs(change) < 1 ? 'neutral' : (improved ? 'improved' : 'regressed');
    const changeSymbol = change > 0 ? '+' : '';
    
    return `
      <div class="compare-card">
        <div class="compare-card-label">${metric.label}</div>
        <div class="compare-card-values">
          <div class="compare-value">
            <div class="compare-value-label">Baseline</div>
            <div class="compare-value-num baseline">${baselineVal}</div>
          </div>
          <div class="compare-value">
            <div class="compare-value-label">Optimized</div>
            <div class="compare-value-num optimized">${optimizedVal}</div>
          </div>
          <div class="compare-change">
            <div class="compare-change-pct ${changeClass}">${changeSymbol}${change.toFixed(1)}%</div>
            <div class="compare-change-label">${improved ? '✓ Better' : (Math.abs(change) < 1 ? '≈ Same' : '⚠ Worse')}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Generate HTML for comparison cards with custom values
 */
function generateCompareCardsHTML(cards) {
  return cards.map(card => {
    const baselineNum = card.baseline;
    const optimizedNum = card.optimized;

    const formatValue = (val) => {
      if (card.format === 'bytes') return formatBytes(val);
      if (card.format === 'number') return formatNumber(val);
      if (card.format === 'time') return formatTime(val);
      return val;
    };

    const baselineDisplay = formatValue(baselineNum);
    const optimizedDisplay = formatValue(optimizedNum);

    const change = baselineNum > 0 ? ((optimizedNum - baselineNum) / baselineNum) * 100 : 0;
    const improved = card.lowerIsBetter ? change < 0 : change > 0;
    const changeClass = Math.abs(change) < 1 ? 'neutral' : (improved ? 'improved' : 'regressed');
    const changeSymbol = change > 0 ? '+' : '';

    return `
      <div class="compare-card">
        <div class="compare-card-label">${card.label}</div>
        <div class="compare-card-values">
          <div class="compare-value">
            <div class="compare-value-label">Baseline</div>
            <div class="compare-value-num baseline">${baselineDisplay}</div>
          </div>
          <div class="compare-value">
            <div class="compare-value-label">Optimized</div>
            <div class="compare-value-num optimized">${optimizedDisplay}</div>
          </div>
          <div class="compare-change">
            <div class="compare-change-pct ${changeClass}">${changeSymbol}${change.toFixed(1)}%</div>
            <div class="compare-change-label">${improved ? '✓ Better' : (Math.abs(change) < 1 ? '≈ Same' : '⚠ Worse')}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Initialize comparison functionality
 */
export function initCompare() {
  setupCompareDropZone('compareDropBaseline', 'compareFileBaseline', 'baseline');
  setupCompareDropZone('compareDropOptimized', 'compareFileOptimized', 'optimized');
}

