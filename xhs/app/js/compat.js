(function () {
  "use strict";
  // Training records contain JSON values only, not DOM nodes or binary objects.
  function cloneRecord(value) { return JSON.parse(JSON.stringify(value)); }
  function coalesce(value, fallback) { return value == null ? fallback : value; }
  function createId(prefix) {
    return prefix + "-" + Date.now() + "-" + Math.random().toString(16).slice(2);
  }
  window.ToolCompat = { cloneRecord, coalesce, createId };
})();
