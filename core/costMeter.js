'use strict';

// ════════════════════════════════════════════════════════════════════════════
// QDASH COST METER — model pricing lookup + per-event cost estimation
// Loads config/model-pricing.json at init(). Reload-safe: call init() again
// to pick up edits without restarting the process. Never invents a cost for
// an event with no token counts — estimateCost returns null in that case.
// ════════════════════════════════════════════════════════════════════════════

const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'model-pricing.json');

// Hardcoded fallback used only if the config file is missing or corrupt.
const FALLBACK_DEFAULT = { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 };

let _models = null;
let _warned = false;

function init() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.models !== 'object' || parsed.models === null) {
      throw new Error('missing "models" object');
    }
    _models = parsed.models;
  } catch (e) {
    if (!_warned) {
      console.warn(`[costMeter] failed to load ${CONFIG_PATH} (${e.message}); falling back to hardcoded default pricing`);
      _warned = true;
    }
    _models = { default: FALLBACK_DEFAULT };
  }
  return _models;
}

function getModels() {
  if (!_models) init();
  return _models;
}

// resolvePricing(modelId) -> { pricing, matched }
// Longest-prefix match of modelId against the keys of models. Unknown or
// missing modelId falls back to the 'default' entry with matched=false.
function resolvePricing(modelId) {
  const models = getModels();
  const defaultEntry = models.default || FALLBACK_DEFAULT;

  if (typeof modelId !== 'string' || !modelId) {
    return { pricing: defaultEntry, matched: false };
  }

  let bestKey = null;
  for (const key of Object.keys(models)) {
    if (key === 'default') continue;
    if (modelId.startsWith(key) && (!bestKey || key.length > bestKey.length)) {
      bestKey = key;
    }
  }

  if (bestKey) return { pricing: models[bestKey], matched: true };
  return { pricing: defaultEntry, matched: false };
}

// estimateCost(event) -> number|null
// Returns null when tokensIn AND tokensOut are both null/undefined — never
// invent a cost. Otherwise computes cost in USD from per-million-token rates.
function estimateCost(event) {
  if (!event || typeof event !== 'object') return null;

  const tokensIn = event.tokensIn;
  const tokensOut = event.tokensOut;
  const hasTokensIn = typeof tokensIn === 'number';
  const hasTokensOut = typeof tokensOut === 'number';
  if (!hasTokensIn && !hasTokensOut) return null;

  const { pricing } = resolvePricing(event.model);
  const metadata = (event.metadata && typeof event.metadata === 'object') ? event.metadata : {};
  const cacheReadTokens = typeof metadata.cacheReadTokens === 'number' ? metadata.cacheReadTokens : 0;
  const cacheWriteTokens = typeof metadata.cacheWriteTokens === 'number' ? metadata.cacheWriteTokens : 0;

  const cost = (
    (hasTokensIn ? tokensIn : 0) * pricing.input +
    (hasTokensOut ? tokensOut : 0) * pricing.output +
    cacheReadTokens * pricing.cacheRead +
    cacheWriteTokens * pricing.cacheWrite
  ) / 1000000;

  return Math.round(cost * 1e6) / 1e6;
}

// applyCost(event) -> the same event with estimatedCostUsd set (only when
// currently null). When the pricing match fell back to 'default', flags
// metadata.pricingFallback = true so the fallback is visible downstream.
function applyCost(event) {
  if (!event || typeof event !== 'object') return event;
  if (event.estimatedCostUsd !== null && event.estimatedCostUsd !== undefined) return event;

  const cost = estimateCost(event);
  if (cost === null) return event;

  event.estimatedCostUsd = cost;

  const { matched } = resolvePricing(event.model);
  if (!matched) {
    if (!event.metadata || typeof event.metadata !== 'object') event.metadata = {};
    event.metadata.pricingFallback = true;
  }

  return event;
}

module.exports = { init, resolvePricing, estimateCost, applyCost };
