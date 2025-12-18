/**
 * Query Plan Visualization
 */

// Tree layout constants
const NODE_WIDTH = 140;
const NODE_HEIGHT = 50;
const HORIZONTAL_SPACING = 30;
const VERTICAL_SPACING = 70;

// DOM elements
let planDropZone, planFileInput, planContainer, planCanvas, planReset;

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
  });
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
      console.error('Error parsing JSON:', err);
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

  // Extract all operators from fragments
  const { operators, connections } = extractOperatorsFromFragments(execution);
  console.log('Extracted operators:', operators);
  console.log('Connections:', connections);

  // Build the graph
  const graph = buildOperatorGraph(operators, connections);
  console.log('Graph:', graph);

  // Find root (RESULT_SINK)
  const root = findRoot(graph);
  if (!root) {
    alert('Could not find root operator (RESULT_SINK)');
    return;
  }

  // Calculate tree layout
  const layout = calculateTreeLayout(root, graph);
  
  // Render with SVG
  renderTreeWithSVG(layout, graph);
  
  // Show the plan container, hide drop zone
  planDropZone.style.display = 'none';
  planContainer.style.display = 'block';
}

/**
 * Extract operators and connections from fragments
 */
function extractOperatorsFromFragments(execution) {
  const operators = [];
  const connections = [];
  
  // Track operators by their unique key for connection building
  const operatorIndex = {};
  
  // Iterate through fragments
  for (const key of Object.keys(execution)) {
    if (!key.startsWith('Fragment ')) continue;
    
    const fragmentId = parseInt(key.split(' ')[1]);
    const fragment = execution[key];
    
    // Iterate through pipelines
    for (const pipeKey of Object.keys(fragment)) {
      const pipeMatch = pipeKey.match(/Pipeline \(id=(\d+)\)/);
      if (!pipeMatch) continue;
      
      const pipelineId = parseInt(pipeMatch[1]);
      const pipeline = fragment[pipeKey];
      
      // Extract operators from this pipeline
      const pipelineOps = [];
      
      for (const opKey of Object.keys(pipeline)) {
        const opMatch = opKey.match(/(.+) \(plan_node_id=(-?\d+)\)/);
        if (!opMatch) continue;
        
        const opName = opMatch[1];
        const planNodeId = parseInt(opMatch[2]);
        
        const opId = `f${fragmentId}_p${pipelineId}_${opName}_${planNodeId}`;
        
        const operator = {
          id: opId,
          name: opName,
          planNodeId: planNodeId,
          fragmentId: fragmentId,
          pipelineId: pipelineId,
          children: [],
          metrics: pipeline[opKey]
        };
        
        operators.push(operator);
        pipelineOps.push(operator);
        
        // Index by type and planNodeId for cross-connections
        const typeKey = `${opName}_${planNodeId}`;
        if (!operatorIndex[typeKey]) {
          operatorIndex[typeKey] = [];
        }
        operatorIndex[typeKey].push(operator);
      }
      
      // Connect operators within pipeline (sequential: bottom feeds into top)
      // In the JSON, operators are listed top-to-bottom (sink first, source last)
      // So we connect: op[i] <- op[i+1] (i+1 feeds into i)
      for (let i = 0; i < pipelineOps.length - 1; i++) {
        connections.push({
          parent: pipelineOps[i].id,
          child: pipelineOps[i + 1].id,
          type: 'pipeline'
        });
      }
    }
  }
  
  // Build cross-fragment and cross-pipeline connections
  // EXCHANGE_SINK -> EXCHANGE_SOURCE (same planNodeId)
  // HASH_JOIN_BUILD -> HASH_JOIN_PROBE (same planNodeId)
  // LOCAL_EXCHANGE_SINK -> LOCAL_EXCHANGE_SOURCE (same planNodeId, same fragment)
  // AGGREGATE_*_SINK -> AGGREGATE_*_SOURCE
  
  for (const op of operators) {
    const name = op.name.toUpperCase();
    
    // EXCHANGE_SOURCE receives from EXCHANGE_SINK
    if (name === 'EXCHANGE_SOURCE') {
      const sinkKey = `EXCHANGE_SINK_${op.planNodeId}`;
      const sinks = operatorIndex[sinkKey] || [];
      for (const sink of sinks) {
        connections.push({
          parent: op.id,
          child: sink.id,
          type: 'exchange'
        });
      }
    }
    
    // HASH_JOIN_PROBE receives from HASH_JOIN_BUILD
    // Match by same planNodeId, same fragment (but different pipelines - build sends to probe)
    if (name === 'HASH_JOIN_PROBE') {
      const buildKey = `HASH_JOIN_BUILD_${op.planNodeId}`;
      const builds = operatorIndex[buildKey] || [];
      for (const build of builds) {
        if (build.fragmentId === op.fragmentId) {
          connections.push({
            parent: op.id,
            child: build.id,
            type: 'join'
          });
        }
      }
    }
    
    // LOCAL_EXCHANGE_SOURCE receives from LOCAL_EXCHANGE_SINK
    // Match by same planNodeId, same fragment
    // Data flows from lower pipelineId to higher pipelineId
    if (name === 'LOCAL_EXCHANGE_SOURCE') {
      const sinkKey = `LOCAL_EXCHANGE_SINK_${op.planNodeId}`;
      const sinks = operatorIndex[sinkKey] || [];
      
      // Filter to same fragment
      const sameFragmentSinks = sinks.filter(sink => sink.fragmentId === op.fragmentId);
      
      // Count how many SOURCEs have this same fragmentId and planNodeId
      const sourceKey = `LOCAL_EXCHANGE_SOURCE_${op.planNodeId}`;
      const sameSources = (operatorIndex[sourceKey] || []).filter(s => s.fragmentId === op.fragmentId);
      
      if (sameSources.length === 1) {
        // Only one SOURCE - connect ALL SINKs to it (fan-in pattern like UNION)
        for (const sink of sameFragmentSinks) {
          connections.push({
            parent: op.id,
            child: sink.id,
            type: 'local_exchange'
          });
        }
      } else {
        // Multiple SOURCEs (e.g., HASH_JOIN with probe and build sides)
        // Match based on pipeline ordering: SINK in pipeline N → SOURCE in pipeline N+1
        // Find SINKs with lower pipelineId and pick the closest one
        const candidateSinks = sameFragmentSinks.filter(sink => sink.pipelineId < op.pipelineId);
        if (candidateSinks.length > 0) {
          // Pick the one with the highest pipelineId (closest to this SOURCE)
          const bestSink = candidateSinks.reduce((best, sink) => 
            sink.pipelineId > best.pipelineId ? sink : best
          );
          connections.push({
            parent: op.id,
            child: bestSink.id,
            type: 'local_exchange'
          });
        }
      }
    }
    
    // AGGREGATE_*_SOURCE receives from AGGREGATE_*_SINK
    if (name.includes('AGGREGATE') && name.includes('SOURCE')) {
      const baseName = name.replace('SOURCE', 'SINK');
      const sinkKey = `${baseName}_${op.planNodeId}`;
      const sinks = operatorIndex[sinkKey] || [];
      for (const sink of sinks) {
        if (sink.fragmentId === op.fragmentId) {
          connections.push({
            parent: op.id,
            child: sink.id,
            type: 'aggregate'
          });
        }
      }
    }
  }
  
  return { operators, connections };
}

/**
 * Build operator graph from operators and connections
 */
function buildOperatorGraph(operators, connections) {
  // Create a map of operators
  const graph = {};
  for (const op of operators) {
    graph[op.id] = { ...op, children: [] };
  }
  
  // Apply connections
  for (const conn of connections) {
    const parent = graph[conn.parent];
    const child = graph[conn.child];
    if (parent && child && !parent.children.includes(conn.child)) {
      parent.children.push(conn.child);
    }
  }
  
  return graph;
}

/**
 * Find the root node (RESULT_SINK)
 */
function findRoot(graph) {
  // Find RESULT_SINK - it has no parent
  for (const id in graph) {
    if (graph[id].name === 'RESULT_SINK') {
      return graph[id];
    }
  }
  
  // Fallback: find node with no incoming edges
  const hasParent = new Set();
  for (const id in graph) {
    for (const childId of graph[id].children) {
      hasParent.add(childId);
    }
  }
  
  for (const id in graph) {
    if (!hasParent.has(id)) {
      return graph[id];
    }
  }
  
  return null;
}

/**
 * Calculate tree layout positions
 */
function calculateTreeLayout(root, graph) {
  // First pass: calculate subtree widths
  function calcSubtreeWidth(node, visited = new Set()) {
    if (visited.has(node.id)) {
      return NODE_WIDTH; // Prevent cycles
    }
    visited.add(node.id);
    
    if (!node.children || node.children.length === 0) {
      node._width = NODE_WIDTH;
      return NODE_WIDTH;
    }
    
    let totalWidth = 0;
    node.children.forEach((childId, i) => {
      const child = graph[childId];
      if (child) {
        totalWidth += calcSubtreeWidth(child, visited);
        if (i < node.children.length - 1) {
          totalWidth += HORIZONTAL_SPACING;
        }
      }
    });
    
    node._width = Math.max(NODE_WIDTH, totalWidth);
    return node._width;
  }
  
  calcSubtreeWidth(root);
  
  // Second pass: assign positions
  const positions = {};
  let maxY = 0;
  
  function assignPositions(node, x, y, visited = new Set()) {
    if (visited.has(node.id)) return;
    visited.add(node.id);
    
    positions[node.id] = { 
      x: x + (node._width - NODE_WIDTH) / 2, 
      y: y
    };
    
    maxY = Math.max(maxY, y);
    
    if (node.children && node.children.length > 0) {
      let childX = x;
      node.children.forEach(childId => {
        const child = graph[childId];
        if (child) {
          assignPositions(child, childX, y + NODE_HEIGHT + VERTICAL_SPACING, visited);
          childX += (child._width || NODE_WIDTH) + HORIZONTAL_SPACING;
        }
      });
    }
  }
  
  assignPositions(root, 0, 0);
  
  return {
    positions,
    width: root._width,
    height: maxY + NODE_HEIGHT,
    root
  };
}

/**
 * Get CSS class for node based on operator type
 */
function getNodeClass(name) {
  const n = name.toUpperCase();
  if (n.includes('RESULT')) return 'result';
  if (n.includes('CONNECTOR_SCAN') || n.includes('OLAP_SCAN')) return 'scan';
  if (n.includes('JOIN')) return 'join';
  if (n.includes('EXCHANGE')) return 'exchange';
  if (n.includes('PROJECT')) return 'project';
  if (n.includes('AGGREGATE') || n.includes('AGG')) return 'aggregate';
  if (n.includes('UNION')) return 'union';
  if (n.includes('CHUNK_ACCUMULATE')) return 'project';
  return '';
}

/**
 * Render the tree with SVG edges
 */
function renderTreeWithSVG(layout, graph) {
  const { positions, width, height, root } = layout;
  const padding = 40;
  
  // Collect all edges
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
  
  // Render edges as SVG paths
  let edgeSvg = '';
  for (const edge of edges) {
    const fromPos = positions[edge.from];
    const toPos = positions[edge.to];
    if (fromPos && toPos) {
      const x1 = fromPos.x + NODE_WIDTH / 2;
      const y1 = fromPos.y + NODE_HEIGHT;
      const x2 = toPos.x + NODE_WIDTH / 2;
      const y2 = toPos.y;
      
      const midY = (y1 + y2) / 2;
      edgeSvg += `<path d="M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}" 
                        fill="none" stroke="#30363d" stroke-width="1.5"/>`;
    }
  }
  
  // Render nodes
  let nodesHtml = '';
  for (const [id, pos] of Object.entries(positions)) {
    const node = graph[id];
    if (!node) continue;
    
    const nodeClass = getNodeClass(node.name);
    const displayName = node.name.length > 18 ? node.name.substring(0, 16) + '...' : node.name;
    
    nodesHtml += `
      <div class="plan-node ${nodeClass}" 
           style="left: ${pos.x}px; top: ${pos.y}px;"
           data-node-id="${id}"
           data-pipeline-id="${node.pipelineId}"
           title="${node.name} (plan_node_id=${node.planNodeId}, pipeline=${node.pipelineId})">
        <div class="plan-node-name">${displayName}</div>
        <div class="plan-node-id">plan_node_id=${node.planNodeId}</div>
        <div class="plan-node-pipeline">pipeline=${node.pipelineId}</div>
      </div>
    `;
  }
  
  // Create container
  const containerHtml = `
    <div class="plan-svg-container" style="width: ${width + padding * 2}px; height: ${height + padding * 2}px;">
      <svg class="plan-svg" width="${width + padding * 2}" height="${height + padding * 2}">
        <g transform="translate(${padding}, ${padding})">
          ${edgeSvg}
        </g>
      </svg>
      <div class="plan-nodes-container" style="position: relative; width: ${width}px; height: ${height}px; margin-left: ${padding}px; margin-top: ${padding}px;">
        ${nodesHtml}
      </div>
    </div>
  `;
  
  planCanvas.innerHTML = containerHtml;
}

