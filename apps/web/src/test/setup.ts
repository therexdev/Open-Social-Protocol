(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom does not implement scrolling; route behavior is tested through navigation state.
if (typeof window !== "undefined") window.scrollTo = () => {};
