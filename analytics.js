(() => {
  'use strict';

  const SCHEMA_VERSION = '1.0';
  const DEFAULT_VERSION = '1.0';
  const state = {
    toolId: '',
    toolName: '',
    toolVersion: DEFAULT_VERSION,
    flowId: '',
    startedAt: 0,
    completed: false
  };

  function clean(value, maxLength = 100) {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value === 'string') return value.slice(0, maxLength);
    return value;
  }

  function compact(params) {
    return Object.fromEntries(
      Object.entries(params || {})
        .map(([key, value]) => [key, clean(value)])
        .filter(([, value]) => value !== undefined)
    );
  }

  function newFlowId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function send(eventName, params) {
    if (typeof window.gtag !== 'function') return false;
    window.gtag('event', eventName, compact(params));
    return true;
  }

  function configure(config = {}) {
    state.toolId = config.toolId || state.toolId;
    state.toolName = config.toolName || state.toolName || state.toolId;
    state.toolVersion = config.toolVersion || state.toolVersion;
  }

  function common(params = {}) {
    return {
      schema_version: SCHEMA_VERSION,
      tool_id: state.toolId,
      tool_name: state.toolName,
      tool_version: state.toolVersion,
      flow_id: state.flowId,
      ...params
    };
  }

  function start(params = {}) {
    if (state.flowId && !state.completed) return state.flowId;
    state.flowId = newFlowId();
    state.startedAt = Date.now();
    state.completed = false;
    send('tool_start', common(params));
    return state.flowId;
  }

  function complete(params = {}) {
    if (!state.flowId || state.completed) return false;
    state.completed = true;
    return send('tool_complete', common({
      duration_ms: Math.max(0, Date.now() - state.startedAt),
      ...params
    }));
  }

  function error(params = {}) {
    if (!state.flowId || state.completed) return false;
    state.completed = true;
    return send('tool_error', common({
      duration_ms: Math.max(0, Date.now() - state.startedAt),
      error_code: params.error_code || 'unknown_error',
      error_message: clean(params.error_message || '', 100),
      ...params
    }));
  }

  function legacy(eventName, params = {}) {
    return send(eventName, {
      migration_source: 'tool_events_v1',
      ...params
    });
  }

  function observeResultTool(options = {}) {
    configure(options);
    const root = document.querySelector(options.rootSelector || '#root');
    if (!root) return;

    const interactionSelector = options.interactionSelector || 'input, select, textarea, button';
    const completeSelector = options.completeSelector;
    let resultWasComplete = false;

    const beginFromInteraction = (event) => {
      const control = event.target.closest?.(interactionSelector);
      if (!control || !root.contains(control)) return;
      if (control.matches(options.ignoreSelector || '[data-analytics-ignore]')) return;
      start({ tool_action: options.startAction || 'calculate' });
    };

    root.addEventListener('click', beginFromInteraction, true);
    root.addEventListener('change', beginFromInteraction, true);
    root.addEventListener('input', beginFromInteraction, { capture: true, once: true });

    if (completeSelector) {
      const checkComplete = () => {
        const isComplete = Boolean(root.querySelector(completeSelector));
        if (isComplete && !resultWasComplete) {
          complete({ tool_action: options.completeAction || 'calculate' });
        }
        if (!isComplete && resultWasComplete) {
          state.flowId = '';
          state.startedAt = 0;
          state.completed = false;
        }
        resultWasComplete = isComplete;
      };
      new MutationObserver(checkComplete).observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class']
      });
      checkComplete();
    }

    const runtimeError = (message) => {
      error({
        tool_action: options.errorAction || 'calculate',
        error_code: 'runtime_error',
        error_message: message
      });
    };
    window.addEventListener('error', (event) => runtimeError(event.message || 'runtime error'));
    window.addEventListener('unhandledrejection', (event) => {
      runtimeError(event.reason?.message || String(event.reason || 'unhandled rejection'));
    });
  }

  window.WelmoaAnalytics = Object.freeze({
    configure,
    start,
    complete,
    error,
    legacy,
    observeResultTool
  });
})();
