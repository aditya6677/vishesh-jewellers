'use strict';
const fs = require('node:fs');

function validBounds(value, displays) {
  if (!value || !['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))) return null;
  if (value.width < 1000 || value.height < 700 || value.width > 16000 || value.height > 16000) return null;
  const screen = displays.find(({ workArea: area }) => value.x < area.x + area.width - 80 && value.x + value.width > area.x + 80 && value.y >= area.y && value.y < area.y + area.height - 80);
  if (!screen) return null;
  const width = Math.round(Math.min(value.width, screen.workArea.width));
  const height = Math.round(Math.min(value.height, screen.workArea.height));
  return { x: Math.round(Math.max(screen.workArea.x, Math.min(value.x, screen.workArea.x + screen.workArea.width - width))), y: Math.round(Math.min(value.y, screen.workArea.y + screen.workArea.height - height)), width, height };
}
function loadWindowState(file, displays) {
  try { const state = JSON.parse(fs.readFileSync(file, 'utf8')); const bounds = validBounds(state.bounds, displays); return bounds ? { bounds, maximized: state.maximized === true } : null; } catch { return null; }
}
function saveWindowState(file, window) {
  if (window.isDestroyed() || window.isMinimized()) return;
  try {
    const temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify({ bounds: window.getNormalBounds(), maximized: window.isMaximized() }), { mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch { /* Window preferences are optional and contain no business data. */ }
}
module.exports = { validBounds, loadWindowState, saveWindowState };
