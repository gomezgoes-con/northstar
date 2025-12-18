/**
 * NorthStar - Query Analyzer for StarRocks
 * Main entry point
 */

import { processQueryProfile } from './parser.js';
import { renderDashboard } from './render.js';
import { initCompare } from './compare.js';
import { setupPlanDropZone } from './visualizer.js';

// ========================================
// DOM Elements
// ========================================
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const dashboard = document.getElementById('dashboard');

// ========================================
// File Loading - Drag and Drop
// ========================================

// When user drags a file over the drop zone
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault(); // Prevent browser from opening the file
  dropZone.classList.add('drag-over'); // Add visual feedback
});

// When user's drag leaves the drop zone
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

// When user drops a file
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  
  // Get the dropped file (we only care about the first one)
  const file = e.dataTransfer.files[0];
  if (file && file.name.endsWith('.json')) {
    loadFile(file);
  } else {
    alert('Please drop a JSON file');
  }
});

// Click on drop zone opens file picker
dropZone.addEventListener('click', () => {
  fileInput.click();
});

// When user selects a file via the file picker
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    loadFile(file);
  }
});

// ========================================
// File Loading Function
// ========================================
function loadFile(file) {
  const reader = new FileReader();
  
  reader.onload = (e) => {
    try {
      // Parse the JSON content
      const json = JSON.parse(e.target.result);
      console.log('Loaded JSON:', json);
      
      // Process the data
      const { summary, execution, connectorScans } = processQueryProfile(json);
      
      // Render the dashboard
      renderDashboard(summary, execution, connectorScans, dropZone, dashboard);
      
    } catch (error) {
      console.error('Error parsing JSON:', error);
      alert('Error parsing JSON file: ' + error.message);
    }
  };
  
  reader.readAsText(file);
}

// ========================================
// Tab Navigation
// ========================================
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Update button states
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Show the selected tab panel
    const tabId = btn.dataset.tab;
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');
  });
});

// ========================================
// Initialize
// ========================================

// Initialize comparison functionality
initCompare();

// Initialize plan visualization
setupPlanDropZone();

console.log('NorthStar - Query Analyzer for StarRocks loaded!');

