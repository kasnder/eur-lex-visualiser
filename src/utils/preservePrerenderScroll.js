const USER_NAVIGATION_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"];

export function preservePrerenderScroll({
  root,
  targetY = window.scrollY,
  maxWaitMs = 5000,
} = {}) {
  if (!root || targetY <= 0) return () => {};

  let stopped = false;
  let frameId = null;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    window.clearTimeout(timeoutId);
    if (frameId !== null) window.cancelAnimationFrame(frameId);
    USER_NAVIGATION_EVENTS.forEach((eventName) => {
      window.removeEventListener(eventName, stop);
    });
  };

  const restore = () => {
    frameId = null;
    if (stopped) return;
    window.scrollTo(0, targetY);
    if (Math.abs(window.scrollY - targetY) <= 1) stop();
  };

  const scheduleRestore = () => {
    if (stopped || frameId !== null) return;
    frameId = window.requestAnimationFrame(restore);
  };

  const observer = new MutationObserver(scheduleRestore);
  observer.observe(root, { childList: true, subtree: true });
  const timeoutId = window.setTimeout(stop, maxWaitMs);
  USER_NAVIGATION_EVENTS.forEach((eventName) => {
    window.addEventListener(eventName, stop, { passive: true });
  });

  return stop;
}
