/**
 * Dashboard rendering functions
 */

import { parseNumericValue, sumMetric, formatNumber, formatBytes } from './utils.js';
import { setupNodeLinkHandlers } from './nodePopup.js';

// Define which metrics we want to display
// Columns are grouped - columns with the same 'group' value will share a header
// group: null means no group header (standalone column)
// description: tooltip text explaining the metric
// headerClass: CSS class for colored group headers
export const METRICS_CONFIG = [
  // === Summary (identity info) ===
  { key: 'Table',                           label: 'Table',              source: 'unique', type: 'string',    group: 'Summary',       sticky: true, description: 'Name of the table being scanned' },
  { key: 'planNodeId',                      label: 'Node ID',            source: 'meta',   type: 'number',    group: 'Summary',       clickable: true, description: 'Plan node identifier in the query execution tree' },
  { key: 'Predicates',                      label: 'Predicates',         source: 'unique', type: 'predicate', group: 'Summary', description: 'Filter conditions applied during the scan' },

  // === Output (what the scan produces) ===
  { key: 'PullRowNum',                      label: 'Pull Rows',          source: 'common', type: 'rows',      group: 'Output', headerClass: 'output-header', description: 'Final output rows from the scan operator' },
  { key: 'BytesRead',                       label: 'Bytes Read',         source: 'unique', type: 'bytes',     group: 'Output', headerClass: 'output-header', description: 'Total bytes read from storage' },

  // === Operator Time (top-level timing + skew) ===
  { key: 'OperatorTotalTime',               label: 'Operator Time',      source: 'common', type: 'time', group: 'Operator Time', headerClass: 'operator-time-header', description: 'Total time spent in this operator' },
  { key: 'OperatorSkew',                    label: 'Skew',               source: 'computed', type: 'skew',    group: 'Operator Time', headerClass: 'operator-time-header', description: 'Max/min ratio across tablets - high values indicate data skew' },

  // === Scan Time (hierarchical breakdown) ===
  { key: 'ScanTime',                        label: 'Scan Time',          source: 'unique', type: 'time',      group: 'Scan Time', headerClass: 'scan-time-header', description: 'Time spent performing the actual scan operation' },
  { key: 'IOTaskWaitTime',                  label: 'IO Wait',            source: 'unique', type: 'timeWithScanPct', group: 'Scan Time', headerClass: 'scan-time-header', description: 'Time waiting for I/O - high % indicates thread-pool starvation' },
  { key: 'IOTaskExecTime',                  label: 'IO Exec',            source: 'unique', type: 'timeWithScanPct', group: 'Scan Time', headerClass: 'scan-time-header', description: 'Time executing I/O operations (reading from disk/cache)' },
  { key: 'SegmentInit',                     label: 'Seg Init',           source: 'unique', type: 'time',      group: 'Scan Time', headerClass: 'scan-time-header', description: 'Time initializing segments - high values indicate fragmentation' },
  { key: 'SegmentRead',                     label: 'Seg Read',           source: 'unique', type: 'time',      group: 'Scan Time', headerClass: 'scan-time-header', description: 'Time spent reading data from segments' },

  // === Index Filters (storage-tier filtering) ===
  { key: 'ZoneMapIndexFilterRows',          label: 'Zone Map',           source: 'unique', type: 'rows',      group: 'Index Filters', headerClass: 'index-filters-header', description: 'Rows filtered using zone map index (min/max per column chunk)' },
  { key: 'SegmentZoneMapFilterRows',        label: 'Seg Zone Map',       source: 'unique', type: 'rows',      group: 'Index Filters', headerClass: 'index-filters-header', description: 'Rows filtered at segment level using zone maps' },
  { key: 'BloomFilterFilterRows',           label: 'Bloom',              source: 'unique', type: 'rows',      group: 'Index Filters', headerClass: 'index-filters-header', description: 'Rows filtered using bloom filter index' },
  { key: 'ShortKeyFilterRows',              label: 'ShortKey',           source: 'unique', type: 'rows',      group: 'Index Filters', headerClass: 'index-filters-header', description: 'Rows filtered using short key index (first N sort key columns)' },
  { key: 'DelVecFilterRows',                label: 'Del Vec',            source: 'unique', type: 'rows',      group: 'Index Filters', headerClass: 'index-filters-header', description: 'Rows filtered by delete vector - high values indicate need for compaction' },

  // === Predicate Filters (predicate pushdown effectiveness) ===
  { key: 'RawRowsRead',                     label: 'Raw Rows',           source: 'unique', type: 'rows',      group: 'Predicate Filters', headerClass: 'pred-filters-header', description: 'Total raw rows read after index filtering' },
  { key: 'PredFilterRows',                  label: 'Pred Filter',        source: 'unique', type: 'rows',      group: 'Predicate Filters', headerClass: 'pred-filters-header', description: 'Rows filtered out by predicate evaluation' },
  { key: 'RowsRead',                        label: 'Rows Read',          source: 'unique', type: 'rows',      group: 'Predicate Filters', headerClass: 'pred-filters-header', description: 'Rows remaining after predicate filters' },
  { key: 'PushdownPredicates',              label: 'Pushdown Count',     source: 'unique', type: 'number',    group: 'Predicate Filters', headerClass: 'pred-filters-header', description: 'Number of predicates pushed to storage - 0 indicates pushdown issues' },

  // === Runtime Filters (join-pushed filters) ===
  { key: 'JoinRuntimeFilterInputRows',      label: 'RF Input',           source: 'common', type: 'rows',      group: 'Runtime Filters', headerClass: 'runtime-filters-header', description: 'Rows before applying runtime filters from joins' },
  { key: 'JoinRuntimeFilterOutputRows',     label: 'RF Output',          source: 'common', type: 'rows',      group: 'Runtime Filters', headerClass: 'runtime-filters-header', description: 'Rows after runtime filters - lower = more effective filtering' },

  // === Storage (fragmentation indicators) ===
  { key: 'TabletCount',                     label: 'Tablets',            source: 'unique', type: 'number',    group: 'Storage', headerClass: 'storage-header', description: 'Number of tablets scanned (data partitions)' },
  { key: 'RowsetsReadCount',                label: 'Rowsets',            source: 'unique', type: 'number',    group: 'Storage', headerClass: 'storage-header', description: 'Number of rowsets - high count indicates fragmentation' },
  { key: 'SegmentsReadCount',               label: 'Segments',           source: 'unique', type: 'number',    group: 'Storage', headerClass: 'storage-header', description: 'Number of segments read (columnar storage files)' },
];

// Store data globally for sorting
let currentData = [];
let sortColumn = null;
let sortDirection = 'asc';
let groupStartIndices = new Set();

/**
 * Main function to render the dashboard
 */
export function renderDashboard(summary, execution, connectorScans, dropZone, dashboard) {
  // Hide drop zone, show dashboard
  dropZone.classList.add('hidden');
  dashboard.classList.add('visible');

  // Store for sorting
  currentData = connectorScans;

  // 1. Render Query Metadata
  renderQueryMeta(summary);

  // 2. Render Summary Cards
  renderSummaryCards(connectorScans, execution);

  // 3. Render the Table
  renderTable(connectorScans);
}

/**
 * Render Query Metadata Section
 */
function renderQueryMeta(summary) {
  const container = document.getElementById('queryMeta');
  
  // Define which fields to show
  const fields = [
    { label: 'Query ID', key: 'Query ID' },
    { label: 'Start Time', key: 'Start Time' },
    { label: 'Duration', key: 'Total' },
    { label: 'State', key: 'Query State' },
    { label: 'User', key: 'User' },
    { label: 'Database', key: 'Default Db' },
    { label: 'Warehouse', key: 'Warehouse' },
  ];

  container.innerHTML = fields.map(f => `
    <div class="meta-item">
      <label>${f.label}</label>
      <span>${summary[f.key] || 'N/A'}</span>
    </div>
  `).join('');
}

/**
 * Render Summary Cards (Organized in Sections)
 */
function renderSummaryCards(scans, execution) {
  // Calculate totals from CONNECTOR_SCAN operators
  const totalScans = scans.length;
  const totalBytesRead = sumMetric(scans, 'BytesRead', 'unique');
  const totalRowsRead = sumMetric(scans, 'RowsRead', 'unique');
  const totalRawRows = sumMetric(scans, 'RawRowsRead', 'unique');

  // Get execution-level metrics directly from the Execution object
  const allocatedMemory = execution.QueryAllocatedMemoryUsage || 'N/A';
  const sumMemory = execution.QuerySumMemoryUsage || 'N/A';
  const cpuTime = execution.QueryCumulativeCpuTime || 'N/A';
  const scanTime = execution.QueryCumulativeScanTime || 'N/A';
  const operatorTime = execution.QueryCumulativeOperatorTime || 'N/A';
  const networkTime = execution.QueryCumulativeNetworkTime || 'N/A';

  // Helper to render cards
  const renderCards = (cards) => cards.map(c => `
    <div class="card">
      <div class="card-label">${c.label}</div>
      <div class="card-value ${c.type}">${c.value}</div>
    </div>
  `).join('');

  // Memory Section
  const memoryCards = [
    { label: 'Allocated Memory', value: allocatedMemory, type: 'bytes' },
    { label: 'Sum Memory Usage', value: sumMemory, type: 'bytes' },
  ];
  document.querySelector('#memoryCards .summary-cards').innerHTML = renderCards(memoryCards);

  // Time Section
  const timeCards = [
    { label: 'CPU Time', value: cpuTime, type: 'time' },
    { label: 'Scan Time', value: scanTime, type: 'time' },
    { label: 'Operator Time', value: operatorTime, type: 'time' },
    { label: 'Network Time', value: networkTime, type: 'time' },
  ];
  document.querySelector('#timeCards .summary-cards').innerHTML = renderCards(timeCards);

  // Scan Metrics Section
  const scanMetricCards = [
    { label: 'Connector Scan Operators', value: totalScans, type: 'number' },
    { label: 'Total Bytes Read', value: formatBytes(totalBytesRead), type: 'bytes' },
    { label: 'Total Rows Scanned', value: formatNumber(totalRawRows), type: 'rows' },
    { label: 'Total Rows Read', value: formatNumber(totalRowsRead), type: 'rows' },
  ];
  document.querySelector('#scanCards .summary-cards').innerHTML = renderCards(scanMetricCards);
}

/**
 * Render Data Table with Grouped Headers
 */
function renderTable(scans) {
  const thead = document.getElementById('tableHead');

  // Clear existing content
  thead.innerHTML = '';

  // =============================================
  // ROW 1: Group Headers (spans multiple columns)
  // =============================================
  const groupHeaderRow = document.createElement('tr');
  groupHeaderRow.className = 'group-header-row';
  
  let currentGroup = null;
  let currentHeaderClass = null;
  let colspan = 0;
  let groupCells = [];

  // Track which columns start a new group (for border styling)
  groupStartIndices = new Set();

  METRICS_CONFIG.forEach((col, idx) => {
    if (col.group !== currentGroup) {
      // Save the previous group if it existed
      if (colspan > 0) {
        groupCells.push({ group: currentGroup, colspan, headerClass: currentHeaderClass });
      }
      // Track the start of a new group
      if (col.group !== null) {
        groupStartIndices.add(idx);
      }
      currentGroup = col.group;
      currentHeaderClass = col.headerClass || null;
      colspan = 1;
    } else {
      colspan++;
    }
  });
  // Don't forget the last group
  if (colspan > 0) {
    groupCells.push({ group: currentGroup, colspan, headerClass: currentHeaderClass });
  }

  // Build the group header row
  // Count leading sticky columns
  let stickyCount = 0;
  while (stickyCount < METRICS_CONFIG.length && METRICS_CONFIG[stickyCount].sticky) {
    stickyCount++;
  }

  let colOffset = 0;
  groupCells.forEach(cell => {
    const cellStart = colOffset;
    const cellEnd = colOffset + cell.colspan;
    colOffset = cellEnd;

    // Check if this cell contains sticky columns
    if (cellStart < stickyCount) {
      // Add separate cell(s) for sticky columns
      const stickyInCell = Math.min(stickyCount, cellEnd) - cellStart;
      for (let i = 0; i < stickyInCell; i++) {
        const th = document.createElement('th');
        th.className = 'group-spacer sticky-col';
        th.textContent = '';
        groupHeaderRow.appendChild(th);
      }
      // If there are non-sticky columns remaining in this cell
      const remaining = cell.colspan - stickyInCell;
      if (remaining > 0) {
        const th = document.createElement('th');
        th.colSpan = remaining;
        th.className = cell.group === null ? 'group-spacer' : '';
        // Add headerClass if present
        if (cell.headerClass) {
          th.classList.add(cell.headerClass);
        }
        th.textContent = cell.group || '';
        groupHeaderRow.appendChild(th);
      }
    } else {
      // No sticky columns in this cell, render normally
      const th = document.createElement('th');
      th.colSpan = cell.colspan;
      if (cell.group === null) {
        th.className = 'group-spacer';
        th.textContent = '';
      } else {
        th.textContent = cell.group;
        // Add headerClass if present
        if (cell.headerClass) {
          th.classList.add(cell.headerClass);
        }
      }
      groupHeaderRow.appendChild(th);
    }
  });

  // =============================================
  // ROW 2: Individual Column Headers (sortable)
  // =============================================
  const columnHeaderRow = document.createElement('tr');

  METRICS_CONFIG.forEach((col, idx) => {
    const th = document.createElement('th');
    th.dataset.col = idx;
    th.dataset.key = col.key;
    th.textContent = col.label;

    // Add tooltip if description exists
    if (col.description) {
      th.dataset.tooltip = col.description;
      th.classList.add('has-tooltip');
    }

    // Add group-start class for left border
    if (groupStartIndices.has(idx)) {
      th.classList.add('group-start');
    }

    // Add sticky class for fixed columns
    if (col.sticky) {
      th.classList.add('sticky-col');
    }

    // Add click handler for sorting
    th.addEventListener('click', () => sortTable(th));

    columnHeaderRow.appendChild(th);
  });

  // Append both rows to thead
  thead.appendChild(groupHeaderRow);
  thead.appendChild(columnHeaderRow);

  // Build body rows
  renderTableBody(scans);
}

/**
 * Compute skew ratio from max/min values
 */
function computeSkew(scan, metricKey) {
  const maxKey = `__MAX_OF_${metricKey}`;
  const minKey = `__MIN_OF_${metricKey}`;
  const maxVal = parseNumericValue(scan.commonMetrics[maxKey] || scan.uniqueMetrics[maxKey]);
  const minVal = parseNumericValue(scan.commonMetrics[minKey] || scan.uniqueMetrics[minKey]);

  if (minVal === 0 || isNaN(minVal) || isNaN(maxVal)) {
    return { ratio: 1, max: maxVal, min: minVal };
  }
  return { ratio: maxVal / minVal, max: maxVal, min: minVal };
}

/**
 * Format skew ratio for display
 */
function formatSkewRatio(ratio) {
  if (ratio < 1.1) return '1x';
  if (ratio < 10) return ratio.toFixed(1) + 'x';
  return Math.round(ratio) + 'x';
}

/**
 * Get skew severity class
 */
function getSkewClass(ratio) {
  if (ratio <= 2) return 'skew-ok';
  if (ratio <= 10) return 'skew-warning';
  return 'skew-danger';
}

/**
 * Render table body rows
 */
function renderTableBody(scans) {
  const tbody = document.getElementById('tableBody');

  tbody.innerHTML = scans.map(scan => {
    // Pre-compute values needed for percentages
    const scanTime = parseNumericValue(scan.uniqueMetrics.ScanTime);

    const cells = METRICS_CONFIG.map((col, idx) => {
      // Get value based on source type
      let value;
      if (col.source === 'meta') {
        value = scan[col.key];
      } else if (col.source === 'common') {
        value = scan.commonMetrics[col.key];
      } else if (col.source === 'unique') {
        value = scan.uniqueMetrics[col.key];
      } else if (col.source === 'computed') {
        // Handle computed values
        if (col.key === 'OperatorSkew') {
          const skewData = computeSkew(scan, 'OperatorTotalTime');
          value = skewData;
        }
      }

      // Apply styling based on type
      let displayValue = value ?? '-';
      let classNames = [];
      let titleText = String(value || '');

      // Add group-start class for left border
      if (groupStartIndices.has(idx)) {
        classNames.push('group-start');
      }

      // Add sticky class for fixed columns
      if (col.sticky) {
        classNames.push('sticky-col');
      }

      // Add clickable class for interactive columns
      if (col.clickable) {
        classNames.push('clickable-cell');
      }

      switch (col.type) {
        case 'string':
          classNames.push('table-name');
          break;
        case 'predicate':
          classNames.push('predicate');
          // Truncate long predicates
          if (typeof displayValue === 'string' && displayValue.length > 50) {
            titleText = displayValue;
            displayValue = displayValue.substring(0, 50) + '...';
          }
          break;
        case 'bytes':
          classNames.push('number', 'bytes');
          break;
        case 'time':
          classNames.push('number', 'time');
          break;
        case 'timeWithScanPct':
          classNames.push('number', 'time');
          if (value && value !== '-' && scanTime > 0) {
            const timeVal = parseNumericValue(value);
            const pct = ((timeVal / scanTime) * 100).toFixed(1);
            displayValue = `${value} <span class="time-pct">(${pct}%)</span>`;
          }
          break;
        case 'skew':
          classNames.push('number', 'skew');
          if (value && typeof value === 'object') {
            const skewClass = getSkewClass(value.ratio);
            classNames.push(skewClass);
            displayValue = formatSkewRatio(value.ratio);
            titleText = `Max: ${value.max.toFixed(6)}s, Min: ${value.min.toFixed(6)}s`;
          } else {
            displayValue = '-';
          }
          break;
        case 'rows':
          classNames.push('number', 'rows');
          break;
        case 'number':
          classNames.push('number');
          break;
      }

      // If clickable, wrap content in a link-like span with data attribute
      if (col.clickable && displayValue !== '-') {
        displayValue = `<span class="node-link" data-node-id="${value}">${displayValue}</span>`;
      }

      return `<td class="${classNames.join(' ')}" title="${titleText}">${displayValue}</td>`;
    }).join('');

    return `<tr>${cells}</tr>`;
  }).join('');

  // Add click handlers for node links
  setupNodeLinkHandlers(tbody, 'scan');
}

/**
 * Sort table by column
 */
function sortTable(th) {
  const key = th.dataset.key;
  const colIndex = parseInt(th.dataset.col);
  const config = METRICS_CONFIG[colIndex];

  // Toggle direction if same column
  if (sortColumn === key) {
    sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    sortColumn = key;
    sortDirection = 'asc';
  }

  // Update header styling
  document.querySelectorAll('#tableHead th').forEach(t => {
    t.classList.remove('sorted-asc', 'sorted-desc');
  });
  th.classList.add(sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc');

  // Sort the data
  currentData.sort((a, b) => {
    let valA, valB;

    // Handle computed values
    if (config.source === 'computed') {
      if (key === 'OperatorSkew') {
        valA = computeSkew(a, 'OperatorTotalTime').ratio;
        valB = computeSkew(b, 'OperatorTotalTime').ratio;
      }
    } else {
      const sourceA = config.source === 'meta' ? a : (config.source === 'common' ? a.commonMetrics : a.uniqueMetrics);
      const sourceB = config.source === 'meta' ? b : (config.source === 'common' ? b.commonMetrics : b.uniqueMetrics);

      valA = sourceA[key] ?? '';
      valB = sourceB[key] ?? '';

      // Parse numeric values from strings like "18.636 KB" or "1.592ms"
      if (config.type !== 'string' && config.type !== 'predicate') {
        valA = parseNumericValue(valA);
        valB = parseNumericValue(valB);
      }
    }

    // Compare
    if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // Re-render table body
  renderTableBody(currentData);
}
