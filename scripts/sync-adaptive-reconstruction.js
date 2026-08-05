#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const modulePath = path.join(root, 'lib', 'adaptive-reconstruction.js');
const userscriptPath = path.join(root, 'remove-gemini-watermark.userscript.js');
const startMarker = '    // BEGIN SYNCED ADAPTIVE RECONSTRUCTION';
const endMarker = '    // END SYNCED ADAPTIVE RECONSTRUCTION';

const moduleSource = fs.readFileSync(modulePath, 'utf8');
const functionStart = moduleSource.indexOf('function adaptiveReconstructRegion(input) {');
const functionEnd = moduleSource.indexOf('\nif (typeof module', functionStart);
if (functionStart < 0 || functionEnd < 0) throw new Error('Could not locate adaptiveReconstructRegion in the shared module.');

const functionSource = moduleSource.slice(functionStart, functionEnd).trimEnd();
const indentedFunction = functionSource.split(/\r?\n/).map((line) => line ? `    ${line}` : '').join('\n');
const replacement = `${startMarker}\n${indentedFunction}\n${endMarker}`;
const userscriptSource = fs.readFileSync(userscriptPath, 'utf8');
const markerStart = userscriptSource.indexOf(startMarker);
const markerEnd = userscriptSource.indexOf(endMarker, markerStart);
if (markerStart < 0 || markerEnd < 0) throw new Error('Could not locate adaptive reconstruction sync markers in the userscript.');
const expected = `${userscriptSource.slice(0, markerStart)}${replacement}${userscriptSource.slice(markerEnd + endMarker.length)}`;

if (process.argv.includes('--check')) {
  if (expected !== userscriptSource) {
    console.error('Userscript adaptive reconstruction is out of sync. Run npm run sync:reconstruction.');
    process.exitCode = 1;
  }
} else {
  fs.writeFileSync(userscriptPath, expected);
}
