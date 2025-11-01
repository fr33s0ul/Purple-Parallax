#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const metricsPath = path.join(__dirname, 'perf-metrics.json');
if (!fs.existsSync(metricsPath)){
  console.error('perf-metrics.json not found.');
  process.exit(1);
}
const raw = fs.readFileSync(metricsPath, 'utf8');
const metrics = JSON.parse(raw);
const rows = [];
let hasFailure = false;
for (const [dataset, entry] of Object.entries(metrics)){
  const { nodeCount, averageFps, minFps, targetMinFps, framesBelow30, sampleDurationMs } = entry;
  const meetsTarget = typeof targetMinFps === 'number' ? minFps >= targetMinFps : true;
  rows.push({
    dataset,
    nodes: nodeCount,
    durationMs: sampleDurationMs,
    averageFps,
    minFps,
    targetMinFps,
    framesBelow30,
    status: meetsTarget ? 'pass' : 'fail'
  });
  if (!meetsTarget){
    hasFailure = true;
  }
}
console.table(rows);
if (hasFailure){
  console.error('Performance regression detected: minimum FPS dipped below the documented baseline.');
  process.exit(1);
}
