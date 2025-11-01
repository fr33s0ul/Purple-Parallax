#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function generateSyntheticDataset(targetCount){
  if (!Number.isInteger(targetCount) || targetCount < 1){
    throw new Error(`targetCount must be a positive integer, received ${targetCount}`);
  }
  const root = { name: `Synthetic Atlas (${targetCount} nodes)`, children: [] };
  let remaining = targetCount - 1;
  let counter = 0;
  const queue = [root];
  while (remaining > 0 && queue.length){
    const parent = queue.shift();
    if (!parent.children){
      parent.children = [];
    }
    const siblings = queue.length + 1;
    const ideal = Math.max(2, Math.round(remaining / siblings));
    const childCount = Math.min(8, Math.max(1, Math.min(ideal, remaining)));
    for (let i = 0; i < childCount && remaining > 0; i++){
      const child = { name: `Synthetic Node ${++counter}` };
      parent.children.push(child);
      remaining -= 1;
      if (remaining > 0){
        child.children = [];
        queue.push(child);
      }
    }
  }
  while (remaining > 0){
    const child = { name: `Synthetic Node ${++counter}` };
    root.children.push(child);
    remaining -= 1;
  }
  pruneEmptyChildren(root);
  return root;
}

function pruneEmptyChildren(node){
  if (!node.children || node.children.length === 0){
    delete node.children;
    return;
  }
  node.children.forEach(pruneEmptyChildren);
}

function countNodes(node){
  if (!node || typeof node !== 'object') return 0;
  const children = Array.isArray(node.children) ? node.children : [];
  return 1 + children.reduce((acc, child) => acc + countNodes(child), 0);
}

function writeDataset(targetCount){
  const dataset = generateSyntheticDataset(targetCount);
  const actualCount = countNodes(dataset);
  if (actualCount !== targetCount){
    throw new Error(`Generated dataset node count mismatch: expected ${targetCount}, got ${actualCount}`);
  }
  const fileName = `synthetic-${targetCount}.json`;
  const outputPath = path.join(__dirname, '..', 'docs', 'data', fileName);
  fs.writeFileSync(outputPath, JSON.stringify(dataset, null, 2));
  console.log(`Wrote ${fileName} with ${actualCount} nodes.`);
}

[1000, 5000, 10000].forEach(writeDataset);
