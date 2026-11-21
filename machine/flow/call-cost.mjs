import { SpanType } from '@mastra/core/observability';
import { TokenCostControl } from '@mastra/core/processors';
import { DefaultObservabilityInstance } from '@mastra/observability';

const generationOf = span => {
  if (!span) return null;
  return span.type === SpanType.MODEL_GENERATION ? span : generationOf(span.parent);
};

// Mastra prices MODEL_GENERATION on completion. Its MODEL_INFERENCE children
// carry each completed call's usage, including calls in a still-running agent.
export class CallCostObservability extends DefaultObservabilityInstance {
  counted = new WeakSet();
  synthetic = false;
  suppressTotals = false;

  emitTracingEvent(event) {
    if (!this.synthetic) super.emitTracingEvent(event);
  }

  getMetricsContext(span) {
    const metrics = super.getMetricsContext(span);
    return this.suppressTotals ? { ...metrics, emit() {} } : metrics;
  }

  emitSpanEnded(span, excludedUsage) {
    if (span.type === SpanType.MODEL_INFERENCE && span.attributes?.usage) {
      const generation = generationOf(span.parent);
      if (generation) {
        this.counted.add(generation);
        const inferenceAsGeneration = new Proxy(span, {
          get(target, key) {
            if (key === 'type') return SpanType.MODEL_GENERATION;
            const value = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        this.synthetic = true;
        try { super.emitSpanEnded(inferenceAsGeneration); } finally { this.synthetic = false; }
      }
    }
    this.suppressTotals = span.type === SpanType.MODEL_GENERATION && this.counted.has(span);
    try { super.emitSpanEnded(span, excludedUsage); } finally { this.suppressTotals = false; }
  }
}

// Wait for all completed calls' queued metric writes before asking the stock
// guard. Calls already in flight may still finish after the limit is crossed.
export class CallCostControl extends TokenCostControl {
  __registerMastra(mastra) {
    super.__registerMastra(mastra);
    this.observability = mastra.observability;
  }

  async queryCost(scopeFilter) {
    if (!this.observabilityStorage) throw new Error('No cost storage');
    const filters = this.buildFilters(scopeFilter);
    const [total, incomplete] = await Promise.all([
      this.observabilityStorage.getMetricAggregate({ name: ['mastra_model_total_input_tokens', 'mastra_model_total_output_tokens'], aggregation: 'sum', filters }),
      this.observabilityStorage.getMetricAggregate({ name: ['mastra_model_total_input_tokens', 'mastra_model_total_output_tokens'], aggregation: 'count', filters: { ...filters, labels: { usageIncomplete: 'true' } } }),
    ]);
    if (incomplete.value > 0 || !Number.isFinite(total.estimatedCost ?? 0)) throw new Error('Incomplete cost records');
    return { estimatedCost: total.estimatedCost ?? 0, costUnit: total.costUnit ?? null, incomplete: false };
  }

  async processInputStep(args) {
    if (!this.resolveScopeFilter(args.requestContext, args.tracing?.currentSpan?.traceId)) {
      return args.abort('Cost check unavailable: missing card identity', { retry: false });
    }
    try {
      await this.observability.flush();
    } catch (error) {
      return args.abort(`Cost check unavailable: ${error.message}`, { retry: false });
    }
    const resolved = this.resolveScopeFilter(args.requestContext, args.tracing?.currentSpan?.traceId);
    try {
      await this.queryCost(resolved.filter);
    } catch (error) {
      return args.abort(`Cost check unavailable: ${error.message}`, { retry: false });
    }
    return super.processInputStep(args);
  }
}
