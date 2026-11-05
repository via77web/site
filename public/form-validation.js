/* Shared by the enquiry form and the server function, so both apply the same rules. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VIA77Validation = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const choices = {
    project: ['New Shopify store', 'Move to Shopify', 'Redesign or rebuild', 'Integrations or custom functionality', 'Ongoing improvement', 'Not sure yet'],
    investment: ['$15k–$30k', '$30k–$60k', '$60k–$100k', '$100k+', 'Ongoing work', 'Not sure yet'],
    timeline: ['As soon as possible', '1–3 months', '3–6 months', '6+ months', 'Still exploring'],
  };
  function validate(data) {
    const errors = {};
    const text = (key) => (typeof data[key] === 'string' ? data[key].trim() : '');
    if (!text('name') || text('name').length > 120) errors.name = 'Enter your name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text('email')) || text('email').length > 200) errors.email = 'Enter a valid email address, like name@yourbrand.com.au.';
    if (!text('message')) errors.message = 'Tell us a little about the project.';
    else if (text('message').length > 4000) errors.message = 'Keep the description under 4,000 characters.';
    if (data.type === 'assessment' && !text('website')) errors.website = 'Enter the website you would like assessed.';
    if (text('website')) {
      try {
        const url = new URL(/^https?:\/\//i.test(text('website')) ? text('website') : 'https://' + text('website'));
        if (!url.hostname.includes('.') || text('website').length > 2048) throw new Error('invalid');
      } catch {
        errors.website = 'Enter a website address, like yourbrand.com.au.';
      }
    }
    for (const key of Object.keys(choices)) {
      if (data[key] && !choices[key].includes(data[key])) errors[key] = 'Choose one of the listed options.';
    }
    if (!['project', 'assessment'].includes(data.type)) errors.type = 'This request was not accepted.';
    return errors;
  }
  return { choices, validate };
});
