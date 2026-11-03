'use strict';
// Header border changes once; all motion is decorative and content is visible without JS.
const editorialHeader = document.querySelector('.header');
if (editorialHeader && 'IntersectionObserver' in window) {
  const sentinel = document.createElement('div');
  sentinel.setAttribute('aria-hidden', 'true');
  sentinel.style.cssText = 'position:absolute;top:1px;width:1px;height:1px;pointer-events:none';
  document.body.prepend(sentinel);
  new IntersectionObserver(entries => {
    editorialHeader.classList.toggle('is-scrolled', !entries[0].isIntersecting);
  }).observe(sentinel);
}
