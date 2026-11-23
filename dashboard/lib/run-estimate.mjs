// A dollar figure for a run, from the same price list the spending limit counts with.
// Always an estimate: the catalog prices a model call, and a run's calls can be priced by
// different rows of it.

import { costOfTokens, loadCatalog, priceFor, readCorrections } from './model-prices.js';

function providerOf(model) {
  const text = String(model ?? '');
  return text.includes('/') ? text.slice(0, text.indexOf('/')) : '';
}

function modelOf(model) {
  const text = String(model ?? '');
  return text.includes('/') ? text.slice(text.indexOf('/') + 1) : text;
}

/**
 * Returns a function that prices one model call. A model the catalog does not know contributes
 * null rather than a made-up number.
 */
export function createUsdEstimator({ catalog = null, corrections = null, load = loadCatalog, read = readCorrections } = {}) {
  let loaded = catalog ? { catalog, corrections: corrections ?? {} } : null;
  function ready() {
    if (loaded) return loaded;
    try {
      loaded = { catalog: load(), corrections: corrections ?? read() };
    } catch {
      loaded = { catalog: null, corrections: {} };
    }
    return loaded;
  }

  return function estimateUsd(call) {
    const { catalog: prices, corrections: overrides } = ready();
    if (!prices) return null;
    const model = String(call?.model ?? '');
    if (!model) return null;
    // The event may name the provider itself; otherwise the model string is provider/model.
    const provider = String(call?.provider ?? '') || providerOf(model);
    const price = priceFor({ catalog: prices, corrections: overrides, provider, model: call?.provider ? model : modelOf(model) });
    if (!price) return null;
    const cached = Number(call.cachedInputTokens) || 0;
    const input = Math.max(0, (Number(call.inputTokens) || 0) - cached);
    const cost = costOfTokens({ price, tokens: { inputText: input, cacheRead: cached, outputText: Number(call.outputTokens) || 0 } });
    return Number.isFinite(cost?.usd) ? cost.usd : null;
  };
}
