'use strict';
// Runs before the stylesheet paints, so a saved theme never flashes the wrong colours.
(function () {
  var saved = null;
  try { saved = localStorage.getItem('via77-theme'); } catch (e) {}
  if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
})();
