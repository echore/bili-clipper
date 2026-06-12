// extension/page-hook.js — 以 world:"MAIN" 注入页面主世界。
// content script 的 isolated world 改不到页面的 history 对象，
// 必须在主世界打补丁，再用 DOM 事件通知 isolated world（content.js）。
(function () {
  const notify = () => window.dispatchEvent(new Event("bili-clipper:navigation"));
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method].bind(history);
    history[method] = function (...args) {
      const result = original(...args);
      notify();
      return result;
    };
  }
})();
