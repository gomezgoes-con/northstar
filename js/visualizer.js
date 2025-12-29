/**
 * Query Plan Visualization
 * Renders the execution plan tree from the Topology structure
 */

// Tree layout constants
const NODE_WIDTH = 160;
const NODE_HEIGHT = 65;
const HORIZONTAL_SPACING = 40;
const VERTICAL_SPACING = 100; // Increased to ensure edge labels are always visible

// DOM elements
let planDropZone, planFileInput, planContainer, planCanvas, planReset;

// Camera-based viewport state
let camera = { x: 0, y: 0, zoom: 1 };
let currentContentSize = { width: 0, height: 0 };
let viewportState = {
  isPanning: false,
  isSpacePressed: false,
  startX: 0,
  startY: 0,
  startCameraX: 0,
  startCameraY: 0,
  pointerId: null
};

/**
 * Setup plan visualization drop zone
 */
export function setupPlanDropZone() {
  planDropZone = document.getElementById('planDropZone');
  planFileInput = document.getElementById('planFileInput');
  planContainer = document.getElementById('planContainer');
  planCanvas = document.getElementById('planCanvas');
  planReset = document.getElementById('planReset');

  planDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    planDropZone.classList.add('drag-over');
  });

  planDropZone.addEventListener('dragleave', () => {
    planDropZone.classList.remove('drag-over');
  });

  planDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    planDropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) loadPlanFile(file);
  });

  planDropZone.addEventListener('click', () => planFileInput.click());
  planFileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) loadPlanFile(e.target.files[0]);
  });

  planReset.addEventListener('click', () => {
    planDropZone.style.display = 'block';
    planContainer.style.display = 'none';
    planCanvas.innerHTML = '';
    // Reset camera state
    camera = { x: 0, y: 0, zoom: 1 };
    currentContentSize = { width: 0, height: 0 };
    cleanupViewport();
  });
  
  // Track expanded nodes and their widths
  window.expandedNodes = new Set();

  // Global toggle function
  window.toggleNodeMetrics = function(nodeId, event) {
    event.stopPropagation();
    const dropdown = document.getElementById(`metrics-${nodeId}`);
    const icon = document.getElementById(`icon-${nodeId}`);
    const node = document.getElementById(`node-${nodeId}`);

    if (!dropdown) return;

    const isHidden = dropdown.style.display === 'none';

    // Toggle current node
    if (isHidden) {
      dropdown.style.display = 'block';
      icon.textContent = '▲';
      node.style.zIndex = '100';
      // Check if it's a join node (needs more width for predicates)
      const nodeTitle = node.querySelector('span')?.textContent || '';
      const expandedWidth = nodeTitle.toUpperCase().includes('JOIN') ? 380 : 320;
      node.style.width = expandedWidth + 'px';
      window.expandedNodes.add(nodeId);

      // Trigger layout recalculation
      window.recalculateLayout?.();
    } else {
      // Close this node
      dropdown.style.display = 'none';
      icon.textContent = '▼';
      node.style.zIndex = '1';
      node.style.width = '160px';
      window.expandedNodes.delete(nodeId);

      // Trigger layout recalculation
      window.recalculateLayout?.();
    }
  };
}

/**
 * Convert screen coordinates to world coordinates
 */
function screenToWorld(screenX, screenY) {
  return {
    x: camera.x + screenX / camera.zoom,
    y: camera.y + screenY / camera.zoom
  };
}

/**
 * Convert world coordinates to screen coordinates
 */
function worldToScreen(worldX, worldY) {
  return {
    x: (worldX - camera.x) * camera.zoom,
    y: (worldY - camera.y) * camera.zoom
  };
}

/**
 * Apply camera transform to the zoom container
 */
function updateTransform() {
  const zoomContainer = planCanvas?.querySelector('.zoom-container');
  if (!zoomContainer) return;

  // Apply transform: translate by negative camera position (scaled) then scale
  zoomContainer.style.transform =
    `translate(${-camera.x * camera.zoom}px, ${-camera.y * camera.zoom}px) scale(${camera.zoom})`;
  zoomContainer.style.transformOrigin = '0 0';
}

/**
 * Fit the visualization to the viewport
 */
function fitToView() {
  if (!planCanvas) return;

  const containerRect = planCanvas.getBoundingClientRect();
  const contentWidth = currentContentSize.width;
  const contentHeight = currentContentSize.height;

  if (contentWidth === 0 || contentHeight === 0) return;

  // Calculate scale to fit content in viewport with padding
  const padding = 40;
  const scaleX = (containerRect.width - padding * 2) / contentWidth;
  const scaleY = (containerRect.height - padding * 2) / contentHeight;
  const scale = Math.min(scaleX, scaleY, 1); // Don't zoom in beyond 100%

  // Clamp scale to zoom limits
  camera.zoom = Math.max(0.1, Math.min(8, scale));

  // Center the content
  // Camera x,y represents the top-left world coordinate visible at viewport top-left
  // To center: we want (contentWidth * zoom) centered in containerRect.width
  camera.x = -(containerRect.width / camera.zoom - contentWidth) / 2;
  camera.y = -(containerRect.height / camera.zoom - contentHeight) / 2;

  updateTransform();
}

/**
 * Setup viewport interactions using Pointer Events
 */
function setupViewport() {
  if (!planCanvas) return;

  const zoomContainer = planCanvas.querySelector('.zoom-container');
  if (!zoomContainer) return;

  // Disable context menu for right-click panning
  planCanvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  // Double-click to fit view
  planCanvas.addEventListener('dblclick', () => {
    fitToView();
  });

  // Keyboard events for Space key
  const handleKeyDown = (e) => {
    if (e.code === 'Space' && !viewportState.isSpacePressed) {
      e.preventDefault();
      viewportState.isSpacePressed = true;
      if (!viewportState.isPanning) {
        planCanvas.style.cursor = 'grab';
      }
    }
  };

  const handleKeyUp = (e) => {
    if (e.code === 'Space') {
      e.preventDefault();
      viewportState.isSpacePressed = false;
      if (!viewportState.isPanning) {
        planCanvas.style.cursor = 'default';
      }
    }
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);

  // Store cleanup function
  planCanvas._viewportCleanup = () => {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
  };

  // Pointer down - start pan
  planCanvas.addEventListener('pointerdown', (e) => {
    // Left click with Space, or right click
    const shouldPan = (e.button === 0 && viewportState.isSpacePressed) || e.button === 2;

    if (shouldPan) {
      e.preventDefault();
      viewportState.isPanning = true;
      viewportState.pointerId = e.pointerId;
      viewportState.startX = e.clientX;
      viewportState.startY = e.clientY;
      viewportState.startCameraX = camera.x;
      viewportState.startCameraY = camera.y;

      planCanvas.style.cursor = 'grabbing';
      planCanvas.setPointerCapture(e.pointerId);
    }
  });

  // Pointer move - pan camera
  planCanvas.addEventListener('pointermove', (e) => {
    if (viewportState.isPanning && e.pointerId === viewportState.pointerId) {
      e.preventDefault();

      const dx = e.clientX - viewportState.startX;
      const dy = e.clientY - viewportState.startY;

      // Update camera position (negative because we're moving the viewport)
      camera.x = viewportState.startCameraX - dx / camera.zoom;
      camera.y = viewportState.startCameraY - dy / camera.zoom;

      updateTransform();
    }
  });

  // Pointer up - end pan
  planCanvas.addEventListener('pointerup', (e) => {
    if (viewportState.isPanning && e.pointerId === viewportState.pointerId) {
      e.preventDefault();
      viewportState.isPanning = false;
      viewportState.pointerId = null;

      planCanvas.style.cursor = viewportState.isSpacePressed ? 'grab' : 'default';
      if (planCanvas.hasPointerCapture(e.pointerId)) {
        planCanvas.releasePointerCapture(e.pointerId);
      }
    }
  });

  // Pointer cancel - end pan
  planCanvas.addEventListener('pointercancel', (e) => {
    if (viewportState.isPanning && e.pointerId === viewportState.pointerId) {
      viewportState.isPanning = false;
      viewportState.pointerId = null;
      planCanvas.style.cursor = viewportState.isSpacePressed ? 'grab' : 'default';
    }
  });

  // Wheel - zoom to cursor (reduced sensitivity: 3% per tick)
  planCanvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = planCanvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Get world position before zoom
    const worldPos = screenToWorld(mouseX, mouseY);

    // Calculate new zoom with reduced sensitivity (3% per tick instead of 10%)
    const zoomDelta = e.deltaY > 0 ? 0.97 : 1.03;
    const oldZoom = camera.zoom;
    camera.zoom = Math.max(0.1, Math.min(8, camera.zoom * zoomDelta));

    // Adjust camera position to keep world point under cursor
    // worldX = camera.x + mouseX / oldZoom
    // We want: worldX = camera.x_new + mouseX / newZoom
    // Therefore: camera.x_new = worldX - mouseX / newZoom
    camera.x = worldPos.x - mouseX / camera.zoom;
    camera.y = worldPos.y - mouseY / camera.zoom;

    updateTransform();
  }, { passive: false });

  // Set initial cursor
  planCanvas.style.cursor = 'default';
}

/**
 * Cleanup viewport event listeners
 */
function cleanupViewport() {
  if (planCanvas && planCanvas._viewportCleanup) {
    planCanvas._viewportCleanup();
    delete planCanvas._viewportCleanup;
  }
  viewportState.isPanning = false;
  viewportState.isSpacePressed = false;
  viewportState.pointerId = null;
}

/**
 * Load plan file
 */
function loadPlanFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      renderPlan(data);
    } catch (err) {
      alert('Invalid JSON file');
    }
  };
  reader.readAsText(file);
}

/**
 * Render the execution plan
 */
function renderPlan(data) {
  const execution = data?.Query?.Execution;
  if (!execution) {
    alert('No execution data found in this profile');
    return;
  }

  if (!execution.Topology) {
    alert('No Topology found in execution data');
    return;
  }

  try {
    const topology = JSON.parse(execution.Topology);
    const metricsMap = extractMetricsByPlanNodeId(execution);
    renderFromTopology(topology, metricsMap);
  } catch (err) {
    alert('Failed to parse Topology: ' + err.message);
  }
}

/**
 * Extract operator metrics from fragments, indexed by plan_node_id
 */
function extractMetricsByPlanNodeId(execution) {
  const metricsMap = {};
  
  for (const key of Object.keys(execution)) {
    if (!key.startsWith('Fragment ')) continue;
    
    const fragment = execution[key];
    
    for (const pipeKey of Object.keys(fragment)) {
      const pipeMatch = pipeKey.match(/Pipeline \(id=(\d+)\)/);
      if (!pipeMatch) continue;
      
      const pipeline = fragment[pipeKey];
      
      for (const opKey of Object.keys(pipeline)) {
        const opMatch = opKey.match(/(.+) \(plan_node_id=(-?\d+)\)/);
        if (!opMatch) continue;
        
        const opName = opMatch[1];
        const planNodeId = parseInt(opMatch[2]);
        
        if (!metricsMap[planNodeId]) {
          metricsMap[planNodeId] = {
            instances: []
          };
        }
        
        // Store operator name with each instance for proper matching
        metricsMap[planNodeId].instances.push({
          operatorName: opName,
          metrics: pipeline[opKey]
        });
      }
    }
  }
  
  return metricsMap;
}

/**
 * Get aggregated metrics for a scan operator
 * Looks through all instances to find the actual SCAN operator (not CHUNK_ACCUMULATE etc.)
 */
function getScanMetrics(metricsData) {
  if (!metricsData || !metricsData.instances || metricsData.instances.length === 0) {
    return null;
  }
  
  // Find the SCAN instance (CONNECTOR_SCAN, OLAP_SCAN, etc.)
  let scanInstance = null;
  
  for (const inst of metricsData.instances) {
    const opName = inst.operatorName.toUpperCase();
    if (opName.includes('SCAN')) {
      scanInstance = inst.metrics;
      break;
    }
  }
  
  // Fallback to first instance if no scan found
  if (!scanInstance) {
    scanInstance = metricsData.instances[0].metrics;
  }
  
  const common = scanInstance.CommonMetrics || {};
  const unique = scanInstance.UniqueMetrics || {};
  
  return {
    operatorTotalTime: common.OperatorTotalTime || 'N/A',
    pullRowNum: common.PullRowNum || '0',
    table: unique.Table || unique.Rollup || 'N/A',
    bytesRead: unique.BytesRead || '0 B',
    rowsRead: unique.RowsRead || '0',
    rawRowsRead: unique.RawRowsRead || '0',
    scanTime: unique.ScanTime || '0ns',
    tabletCount: unique.TabletCount || '0'
  };
}

// Store current graph data for recalculation
let currentGraph = null;
let currentRoot = null;

/**
 * Render from the Topology structure (logical plan)
 */
function renderFromTopology(topology, metricsMap) {
  const { rootId, nodes } = topology;

  const graph = {};
  for (const node of nodes) {
    graph[node.id] = {
      id: node.id,
      name: node.name,
      planNodeId: node.id,
      children: node.children || [],
      properties: node.properties || {},
      metrics: metricsMap[node.id] || null
    };
  }

  const root = graph[rootId];
  if (!root) {
    alert('Could not find root node in topology');
    return;
  }

  // Store for recalculation
  currentGraph = graph;
  currentRoot = root;

  // Setup recalculation function
  window.recalculateLayout = function() {
    if (!currentGraph || !currentRoot) return;
    const layout = calculateTreeLayout(currentRoot, currentGraph);
    renderTreeWithSVG(layout, currentGraph);
  };

  const layout = calculateTreeLayout(root, graph);
  renderTreeWithSVG(layout, graph);

  planDropZone.style.display = 'none';
  planContainer.style.display = 'block';
}

/**
 * Get the effective width of a node (expanded or normal)
 */
function getNodeEffectiveWidth(node) {
  const nodeId = String(node.id);
  if (window.expandedNodes?.has(nodeId)) {
    // Join nodes need more width for predicates
    return node.name.toUpperCase().includes('JOIN') ? 380 : 320;
  }
  return NODE_WIDTH;
}

/**
 * Get the effective height of a node (expanded or normal)
 * Accounts for the metrics dropdown when expanded
 */
function getNodeEffectiveHeight(node) {
  const nodeId = String(node.id);
  if (!window.expandedNodes?.has(nodeId)) {
    return NODE_HEIGHT;
  }

  // Calculate dropdown height based on node type
  // Each metric row is approximately 22px (padding + font)
  const ROW_HEIGHT = 22;
  const DROPDOWN_MARGIN = 16; // margin-top + padding-top

  const name = node.name.toUpperCase();
  if (name.includes('SCAN')) {
    return NODE_HEIGHT + DROPDOWN_MARGIN + (8 * ROW_HEIGHT); // 8 metrics rows
  }
  if (name.includes('JOIN')) {
    return NODE_HEIGHT + DROPDOWN_MARGIN + (11 * ROW_HEIGHT); // 11 metrics rows
  }
  if (name.includes('EXCHANGE')) {
    return NODE_HEIGHT + DROPDOWN_MARGIN + (10 * ROW_HEIGHT); // 10 metrics rows
  }

  return NODE_HEIGHT;
}

/**
 * Calculate tree layout positions
 */
function calculateTreeLayout(root, graph) {
  function calcSubtreeWidth(node, visited = new Set()) {
    if (visited.has(node.id)) return getNodeEffectiveWidth(node);
    visited.add(node.id);

    const nodeWidth = getNodeEffectiveWidth(node);

    if (!node.children || node.children.length === 0) {
      node._width = nodeWidth;
      node._nodeWidth = nodeWidth;
      return nodeWidth;
    }

    let totalChildrenWidth = 0;
    node.children.forEach((childId, i) => {
      const child = graph[childId];
      if (child) {
        totalChildrenWidth += calcSubtreeWidth(child, visited);
        if (i < node.children.length - 1) totalChildrenWidth += HORIZONTAL_SPACING;
      }
    });

    node._width = Math.max(nodeWidth, totalChildrenWidth);
    node._nodeWidth = nodeWidth;
    return node._width;
  }

  calcSubtreeWidth(root);

  const positions = {};
  let maxY = 0;

  function assignPositions(node, x, y, visited = new Set()) {
    if (visited.has(node.id)) return;
    visited.add(node.id);

    const nodeWidth = node._nodeWidth || NODE_WIDTH;
    const nodeHeight = getNodeEffectiveHeight(node);
    positions[node.id] = { x: x + (node._width - nodeWidth) / 2, y };
    maxY = Math.max(maxY, y + nodeHeight);

    if (node.children && node.children.length > 0) {
      let childX = x;
      // Use effective height for vertical spacing
      const childY = y + nodeHeight + VERTICAL_SPACING;
      node.children.forEach(childId => {
        const child = graph[childId];
        if (child) {
          assignPositions(child, childX, childY, visited);
          childX += (child._width || NODE_WIDTH) + HORIZONTAL_SPACING;
        }
      });
    }
  }

  assignPositions(root, 0, 0);

  return { positions, width: root._width, height: maxY, root };
}

/**
 * Get CSS class for node based on operator type
 */
function getNodeClass(name) {
  const n = name.toUpperCase();
  if (n.includes('SCAN')) return 'scan';
  if (n.includes('JOIN')) return 'join';
  if (n.includes('EXCHANGE') || n.includes('MERGE')) return 'exchange';
  if (n.includes('PROJECT') || n.includes('LIMIT') || n.includes('TOP_N')) return 'project';
  if (n.includes('AGGREGATE') || n.includes('AGG')) return 'aggregate';
  if (n.includes('UNION')) return 'union';
  if (n.includes('SORT')) return 'project';
  return '';
}

/**
 * Check if node is a scan operator
 */
function isScanOperator(name) {
  return name.toUpperCase().includes('SCAN');
}

/**
 * Check if node is a join operator
 */
function isJoinOperator(name) {
  return name.toUpperCase().includes('JOIN');
}

/**
 * Check if node is an exchange operator
 */
function isExchangeOperator(name) {
  const n = name.toUpperCase();
  return n === 'EXCHANGE' || n.includes('EXCHANGE');
}

/**
 * Parse time string to microseconds for calculations
 */
function parseTimeToMicroseconds(timeStr) {
  if (!timeStr || timeStr === 'N/A') return 0;
  
  const str = String(timeStr).toLowerCase();
  const value = parseFloat(str);
  if (isNaN(value)) return 0;
  
  if (str.includes('ms')) return value * 1000;
  if (str.includes('us')) return value;
  if (str.includes('ns')) return value / 1000;
  if (str.includes('s') && !str.includes('us') && !str.includes('ns') && !str.includes('ms')) return value * 1000000;
  
  return value;
}

/**
 * Format microseconds to human readable time
 */
function formatMicroseconds(us) {
  if (us >= 1000000) return (us / 1000000).toFixed(2) + 's';
  if (us >= 1000) return (us / 1000).toFixed(2) + 'ms';
  if (us >= 1) return us.toFixed(2) + 'us';
  return (us * 1000).toFixed(0) + 'ns';
}

/**
 * Get aggregated metrics for a join operator
 * Finds HASH_JOIN_PROBE and HASH_JOIN_BUILD instances
 */
function getJoinMetrics(metricsData) {
  if (!metricsData || !metricsData.instances || metricsData.instances.length === 0) {
    return null;
  }
  
  let probeInstance = null;
  let buildInstance = null;
  
  for (const inst of metricsData.instances) {
    const opName = inst.operatorName.toUpperCase();
    if (opName.includes('JOIN_PROBE')) {
      probeInstance = inst.metrics;
    } else if (opName.includes('JOIN_BUILD')) {
      buildInstance = inst.metrics;
    }
  }
  
  // Need at least one of probe or build
  if (!probeInstance && !buildInstance) {
    return null;
  }
  
  const probeCommon = probeInstance?.CommonMetrics || {};
  const probeUnique = probeInstance?.UniqueMetrics || {};
  const buildCommon = buildInstance?.CommonMetrics || {};
  const buildUnique = buildInstance?.UniqueMetrics || {};
  
  // Extract times
  const buildTime = buildCommon.OperatorTotalTime || 'N/A';
  const probeTime = probeCommon.OperatorTotalTime || 'N/A';
  
  // Calculate total join time
  const buildUs = parseTimeToMicroseconds(buildTime);
  const probeUs = parseTimeToMicroseconds(probeTime);
  const totalUs = buildUs + probeUs;
  const totalTime = totalUs > 0 ? formatMicroseconds(totalUs) : 'N/A';
  
  return {
    joinType: probeUnique.JoinType || buildUnique.JoinType || 'N/A',
    distributionMode: probeUnique.DistributionMode || buildUnique.DistributionMode || 'N/A',
    joinPredicates: buildUnique.JoinPredicates || 'N/A',
    buildTime: buildTime,
    probeTime: probeTime,
    totalJoinTime: totalTime,
    buildHashTableTime: buildUnique.BuildHashTableTime || 'N/A',
    searchHashTableTime: probeUnique.SearchHashTableTime || 'N/A',
    hashTableMemory: buildUnique.HashTableMemoryUsage || 'N/A',
    pullRowNum: probeCommon.PullRowNum || '0',
    buildRows: buildCommon.PushRowNum || '0'
  };
}

/**
 * Get aggregated metrics for an exchange operator
 * Finds EXCHANGE_SOURCE and EXCHANGE_SINK instances
 */
function getExchangeMetrics(metricsData) {
  if (!metricsData || !metricsData.instances || metricsData.instances.length === 0) {
    return null;
  }
  
  let sourceInstance = null;
  let sinkInstance = null;
  
  for (const inst of metricsData.instances) {
    const opName = inst.operatorName.toUpperCase();
    if (opName === 'EXCHANGE_SOURCE') {
      sourceInstance = inst.metrics;
    } else if (opName === 'EXCHANGE_SINK') {
      sinkInstance = inst.metrics;
    }
  }
  
  // Need at least one of source or sink
  if (!sourceInstance && !sinkInstance) {
    return null;
  }
  
  const sourceCommon = sourceInstance?.CommonMetrics || {};
  const sourceUnique = sourceInstance?.UniqueMetrics || {};
  const sinkCommon = sinkInstance?.CommonMetrics || {};
  const sinkUnique = sinkInstance?.UniqueMetrics || {};
  
  // Extract times
  const sourceTime = sourceCommon.OperatorTotalTime || '0';
  const sinkTime = sinkCommon.OperatorTotalTime || '0';
  const networkTime = sinkUnique.NetworkTime || '0';
  
  // Calculate totals in microseconds
  const sourceUs = parseTimeToMicroseconds(sourceTime);
  const sinkUs = parseTimeToMicroseconds(sinkTime);
  const networkUs = parseTimeToMicroseconds(networkTime);
  const cpuUs = sourceUs + sinkUs;
  const totalUs = cpuUs + networkUs;
  
  // Calculate percentages
  const cpuPercent = totalUs > 0 ? Math.round((cpuUs / totalUs) * 100) : 0;
  const networkPercent = totalUs > 0 ? Math.round((networkUs / totalUs) * 100) : 0;
  
  return {
    partType: sinkUnique.PartType || 'N/A',
    totalTime: totalUs > 0 ? formatMicroseconds(totalUs) : 'N/A',
    cpuTime: cpuUs > 0 ? formatMicroseconds(cpuUs) : 'N/A',
    cpuPercent: cpuPercent,
    networkTime: networkUs > 0 ? formatMicroseconds(networkUs) : 'N/A',
    networkPercent: networkPercent,
    sourceTime: sourceTime,
    sinkTime: sinkTime,
    bytesSent: sinkUnique.BytesSent || 'N/A',
    bytesReceived: sourceUnique.BytesReceived || 'N/A',
    pullRowNum: sourceCommon.PullRowNum || '0',
    networkBandwidth: sinkUnique.NetworkBandwidth || 'N/A'
  };
}

/**
 * Calculate total time for a node based on all its operators
 * Rules:
 * - SCAN: OperatorTotalTime + ScanTime
 * - EXCHANGE: OperatorTotalTime (source + sink) + NetworkTime
 * - JOIN: OperatorTotalTime (probe + build)
 * - Others: OperatorTotalTime
 */
function getNodeTotalTime(metricsData) {
  if (!metricsData || !metricsData.instances || metricsData.instances.length === 0) {
    return null;
  }
  
  let totalUs = 0;
  
  for (const inst of metricsData.instances) {
    const opName = inst.operatorName.toUpperCase();
    const common = inst.metrics?.CommonMetrics || {};
    const unique = inst.metrics?.UniqueMetrics || {};
    
    // Skip subordinate operators that are just buffering (their time is minimal)
    if (opName === 'CHUNK_ACCUMULATE') continue;
    
    // Add OperatorTotalTime for all operators
    if (common.OperatorTotalTime) {
      totalUs += parseTimeToMicroseconds(common.OperatorTotalTime);
    }
    
    // Add ScanTime for SCAN operators
    if (opName.includes('SCAN') && unique.ScanTime) {
      totalUs += parseTimeToMicroseconds(unique.ScanTime);
    }
    
    // Add NetworkTime for EXCHANGE_SINK operators
    if (opName === 'EXCHANGE_SINK' && unique.NetworkTime) {
      totalUs += parseTimeToMicroseconds(unique.NetworkTime);
    }
  }
  
  return totalUs > 0 ? formatMicroseconds(totalUs) : null;
}

/**
 * Get row count (PullRowNum) from a node's metrics
 * Returns formatted string or null if not available
 */
function getNodeRowCount(node) {
  if (!node || !node.metrics || !node.metrics.instances) return null;
  
  // Find an instance with PullRowNum
  for (const inst of node.metrics.instances) {
    const common = inst.metrics?.CommonMetrics;
    if (common && common.PullRowNum) {
      return formatRowCount(common.PullRowNum);
    }
  }
  return null;
}

/**
 * Format row count for display (e.g., "1.5K", "2.3M")
 */
function formatRowCount(value) {
  if (!value) return null;
  
  // Handle string values like "207.615K (207615)"
  let numStr = String(value);
  
  // If it already has K/M suffix, extract just the short form
  const match = numStr.match(/^([\d.]+[KMB]?)/i);
  if (match) {
    return match[1];
  }
  
  // Parse as number and format
  const num = parseFloat(numStr.replace(/[,\s]/g, ''));
  if (isNaN(num)) return value;
  
  if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return String(num);
}

/**
 * Build metrics dropdown HTML for scan nodes
 */
function buildScanMetricsDropdown(node) {
  const m = getScanMetrics(node.metrics);
  if (!m) return '';
  
  const rowStyle = 'display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #21262d;gap:12px;';
  const labelStyle = 'color:#8b949e;font-size:11px;white-space:nowrap;flex-shrink:0;';
  const valueStyle = 'color:#e6edf3;font-size:11px;font-weight:500;text-align:right;word-break:break-all;';
  const timeStyle = valueStyle + 'color:#3fb950;';
  const bytesStyle = valueStyle + 'color:#d29922;';
  const rowsStyle = valueStyle + 'color:#a5d6ff;';
  
  return `
    <div id="metrics-${node.id}" class="node-metrics-dropdown" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid #30363d;">
      <div style="${rowStyle}"><span style="${labelStyle}">Table</span><span style="${valueStyle}">${m.table}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Operator Time</span><span style="${timeStyle}">${m.operatorTotalTime}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Scan Time</span><span style="${timeStyle}">${m.scanTime}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Bytes Read</span><span style="${bytesStyle}">${m.bytesRead}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Pull Rows</span><span style="${rowsStyle}">${m.pullRowNum}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Rows Read</span><span style="${rowsStyle}">${m.rowsRead}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Raw Rows Read</span><span style="${rowsStyle}">${m.rawRowsRead}</span></div>
      <div style="${rowStyle};border-bottom:none;"><span style="${labelStyle}">Tablets</span><span style="${valueStyle}">${m.tabletCount}</span></div>
    </div>
  `;
}

/**
 * Build metrics dropdown HTML for join nodes
 */
function buildJoinMetricsDropdown(node) {
  const m = getJoinMetrics(node.metrics);
  if (!m) return '';
  
  const rowStyle = 'display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #21262d;gap:12px;';
  const labelStyle = 'color:#8b949e;font-size:11px;white-space:nowrap;flex-shrink:0;';
  const valueStyle = 'color:#e6edf3;font-size:11px;font-weight:500;text-align:right;word-break:break-all;';
  const timeStyle = valueStyle + 'color:#3fb950;';
  const memoryStyle = valueStyle + 'color:#d29922;';
  const rowsStyle = valueStyle + 'color:#a5d6ff;';
  const typeStyle = valueStyle + 'color:#f85149;';
  
  return `
    <div id="metrics-${node.id}" class="node-metrics-dropdown" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid #30363d;">
      <div style="${rowStyle}"><span style="${labelStyle}">Join Type</span><span style="${typeStyle}">${m.joinType}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Distribution</span><span style="${valueStyle}">${m.distributionMode}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Predicates</span><span style="${valueStyle}">${m.joinPredicates}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Total Join Time</span><span style="${timeStyle}">${m.totalJoinTime}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Build Time</span><span style="${timeStyle}">${m.buildTime}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Probe Time</span><span style="${timeStyle}">${m.probeTime}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Build Hash Table</span><span style="${timeStyle}">${m.buildHashTableTime}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Search Hash Table</span><span style="${timeStyle}">${m.searchHashTableTime}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Hash Table Memory</span><span style="${memoryStyle}">${m.hashTableMemory}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Build Rows</span><span style="${rowsStyle}">${m.buildRows}</span></div>
      <div style="${rowStyle};border-bottom:none;"><span style="${labelStyle}">Output Rows</span><span style="${rowsStyle}">${m.pullRowNum}</span></div>
    </div>
  `;
}

/**
 * Build metrics dropdown HTML for exchange nodes
 */
function buildExchangeMetricsDropdown(node) {
  const m = getExchangeMetrics(node.metrics);
  if (!m) return '';
  
  const rowStyle = 'display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid #21262d;gap:12px;';
  const labelStyle = 'color:#8b949e;font-size:11px;white-space:nowrap;flex-shrink:0;';
  const valueStyle = 'color:#e6edf3;font-size:11px;font-weight:500;text-align:right;word-break:break-all;';
  const timeStyle = valueStyle + 'color:#3fb950;';
  const networkStyle = valueStyle + 'color:#58a6ff;';
  const bytesStyle = valueStyle + 'color:#d29922;';
  const rowsStyle = valueStyle + 'color:#a5d6ff;';
  
  return `
    <div id="metrics-${node.id}" class="node-metrics-dropdown" style="display:none;margin-top:8px;padding-top:8px;border-top:1px solid #30363d;">
      <div style="${rowStyle}"><span style="${labelStyle}">Partition Type</span><span style="${valueStyle}">${m.partType}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Total Time</span><span style="${timeStyle}">${m.totalTime}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">CPU Time</span><span style="${timeStyle}">${m.cpuTime} <span style="color:#8b949e;">(${m.cpuPercent}%)</span></span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Network Time</span><span style="${networkStyle}">${m.networkTime} <span style="color:#8b949e;">(${m.networkPercent}%)</span></span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Source Time</span><span style="${timeStyle}">${m.sourceTime}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Sink Time</span><span style="${timeStyle}">${m.sinkTime}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Bytes Sent</span><span style="${bytesStyle}">${m.bytesSent}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Bytes Received</span><span style="${bytesStyle}">${m.bytesReceived}</span></div>
      <div style="${rowStyle}"><span style="${labelStyle}">Bandwidth</span><span style="${bytesStyle}">${m.networkBandwidth}</span></div>
      <div style="${rowStyle};border-bottom:none;"><span style="${labelStyle}">Rows</span><span style="${rowsStyle}">${m.pullRowNum}</span></div>
    </div>
  `;
}

/**
 * Build metrics dropdown HTML based on node type
 */
function buildMetricsDropdown(node) {
  if (!node.metrics) return '';
  
  if (isScanOperator(node.name)) {
    return buildScanMetricsDropdown(node);
  }
  
  if (isJoinOperator(node.name)) {
    return buildJoinMetricsDropdown(node);
  }
  
  if (isExchangeOperator(node.name)) {
    return buildExchangeMetricsDropdown(node);
  }
  
  return '';
}

/**
 * Check if node has expandable metrics
 */
function hasExpandableMetrics(node) {
  if (!node.metrics) return false;
  return isScanOperator(node.name) || isJoinOperator(node.name) || isExchangeOperator(node.name);
}

/**
 * Render the tree with SVG edges
 */
function renderTreeWithSVG(layout, graph) {
  const { positions, width, height, root } = layout;
  const padding = 40;

  if (!root || Object.keys(positions).length === 0) {
    planCanvas.innerHTML = '<div style="padding:2rem;color:#f85149;">No operators found</div>';
    return;
  }

  // Collect edges
  const edges = [];
  const visited = new Set();

  function collectEdges(node) {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    if (node.children) {
      for (const childId of node.children) {
        const child = graph[childId];
        if (child && positions[childId]) {
          edges.push({ from: node.id, to: childId });
          collectEdges(child);
        }
      }
    }
  }
  collectEdges(root);

  // Render SVG edges (lines only) and collect label positions
  let edgeSvg = '';
  let edgeLabelsHtml = '';
  for (const edge of edges) {
    const fromPos = positions[edge.from];
    const toPos = positions[edge.to];
    const fromNode = graph[edge.from];
    const toNode = graph[edge.to];
    if (fromPos && toPos && fromNode && toNode) {
      // Use effective dimensions for edge connection points
      const fromWidth = getNodeEffectiveWidth(fromNode);
      const fromHeight = getNodeEffectiveHeight(fromNode);
      const toWidth = getNodeEffectiveWidth(toNode);
      const x1 = fromPos.x + fromWidth / 2;
      const y1 = fromPos.y + fromHeight;
      const x2 = toPos.x + toWidth / 2;
      const y2 = toPos.y;
      const midY = (y1 + y2) / 2;

      // Draw the edge path - straight down then curve to child
      // Control points ensure the line goes straight down from parent before curving
      const dropY = y1 + 30; // Go straight down 30px before curving
      edgeSvg += `<path d="M ${x1} ${y1} L ${x1} ${dropY} Q ${x1} ${midY}, ${(x1+x2)/2} ${midY} Q ${x2} ${midY}, ${x2} ${y2 - 20} L ${x2} ${y2}" fill="none" stroke="#30363d" stroke-width="1.5"/>`;

      // Get row count from the child node (source of data flow)
      const childNode = graph[edge.to];
      const rowCount = getNodeRowCount(childNode) || '0';

      if (rowCount) {
        // Calculate label position (centered in the gap between nodes)
        const labelX = (x1 + x2) / 2;
        const labelY = midY;

        // Render label as HTML element with high z-index (always on top)
        edgeLabelsHtml += `
          <div style="
            position: absolute;
            left: ${labelX + padding}px;
            top: ${labelY + padding - 9}px;
            transform: translateX(-50%);
            background: #161b22;
            border: 1px solid #30363d;
            border-radius: 4px;
            padding: 2px 6px;
            font-size: 10px;
            font-family: 'JetBrains Mono', monospace;
            color: #a5d6ff;
            z-index: 200;
            pointer-events: none;
          ">${rowCount}</div>
        `;
      }
    }
  }

  // Render nodes
  let nodesHtml = '';
  for (const [id, pos] of Object.entries(positions)) {
    const node = graph[id];
    if (!node) continue;

    const nodeClass = getNodeClass(node.name);
    const displayName = node.name.length > 18 ? node.name.substring(0, 16) + '...' : node.name;
    const hasMetrics = hasExpandableMetrics(node);
    const metricsDropdown = buildMetricsDropdown(node);
    const totalTime = node.metrics ? getNodeTotalTime(node.metrics) : null;

    // Check if this node is expanded
    const isExpanded = window.expandedNodes?.has(String(id));
    const nodeWidth = isExpanded ? getNodeEffectiveWidth(node) : NODE_WIDTH;
    const zIndex = isExpanded ? 100 : 1;
    const dropdownDisplay = isExpanded ? 'block' : 'none';
    const iconText = isExpanded ? '▲' : '▼';

    const nodeStyle = `
      position:absolute;
      left:${pos.x + padding}px;
      top:${pos.y + padding}px;
      width:${nodeWidth}px;
      background:#161b22;
      border:1px solid #30363d;
      border-radius:8px;
      padding:8px 10px;
      text-align:center;
      z-index:${zIndex};
      ${hasMetrics ? 'cursor:pointer;' : ''}
    `;

    const borderColor = nodeClass === 'scan' ? '#d29922' :
                        nodeClass === 'join' ? '#f85149' :
                        nodeClass === 'exchange' ? '#58a6ff' :
                        nodeClass === 'aggregate' ? '#a371f7' :
                        nodeClass === 'union' ? '#3fb950' : '#8b949e';

    // Build time display - show in green if we have it
    const timeDisplay = totalTime
      ? `<div style="font-size:10px;color:#3fb950;margin-top:2px;font-weight:500;">⏱ ${totalTime}</div>`
      : '';

    // Build metrics dropdown with correct display state
    const metricsDropdownWithState = metricsDropdown.replace(
      'style="display:none;',
      `style="display:${dropdownDisplay};`
    );

    nodesHtml += `
      <div id="node-${id}" class="plan-node ${nodeClass} ${hasMetrics ? 'has-metrics' : ''}"
           style="${nodeStyle}border-left:3px solid ${borderColor};"
           ${hasMetrics ? `onclick="toggleNodeMetrics('${id}', event)"` : ''}>
        <div style="display:flex;align-items:center;justify-content:center;gap:6px;">
          <span style="font-size:11px;font-weight:600;color:#e6edf3;">${displayName}</span>
          ${hasMetrics ? `<span id="icon-${id}" class="expand-icon" style="font-size:8px;color:#00d4aa;">${iconText}</span>` : ''}
        </div>
        <div style="font-size:10px;color:#8b949e;margin-top:2px;">id=${node.planNodeId}</div>
        ${timeDisplay}
        ${metricsDropdownWithState}
      </div>
    `;
  }

  // Store content size for camera calculations
  currentContentSize = {
    width: width + padding * 2,
    height: height + padding * 2
  };

  // Check if viewport is already initialized (preserve camera on re-render)
  const isInitialized = planCanvas.innerHTML !== '' && planCanvas._viewportCleanup;
  const previousCamera = isInitialized ? { ...camera } : null;

  planCanvas.innerHTML = `
    <div class="zoom-container" style="position:relative;width:${width + padding * 2}px;height:${height + padding * 2}px;transform-origin:0 0;">
      <svg style="position:absolute;top:0;left:0;" width="${width + padding * 2}" height="${height + padding * 2}">
        <g transform="translate(${padding}, ${padding})">${edgeSvg}</g>
      </svg>
      <div style="position:absolute;top:0;left:0;width:${width + padding * 2}px;height:${height + padding * 2}px;">
        ${nodesHtml}
      </div>
      <div style="position:absolute;top:0;left:0;width:${width + padding * 2}px;height:${height + padding * 2}px;pointer-events:none;">
        ${edgeLabelsHtml}
      </div>
    </div>
  `;

  // Setup viewport if first time, or restore camera position
  if (!isInitialized) {
    setupViewport();
    // Initial fit to view
    setTimeout(() => fitToView(), 50);
  } else {
    // Restore camera after re-render (when nodes expand/collapse)
    if (previousCamera) {
      camera = previousCamera;
    }
    // Re-setup viewport event listeners (since DOM was replaced)
    setupViewport();
    updateTransform();
  }
}
