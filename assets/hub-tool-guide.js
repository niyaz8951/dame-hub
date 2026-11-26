/* What a team must know before it builds or uploads a tool for an uploaded tile (docs/STANDARDS.md section 13):
   the rules in plain words and a prompt to give an AI that builds the tool. One text, shown in Admin > Tiles after
   a new tile is saved and on the tile's Files page. Change it here only. */
(function () {
  'use strict';
  var el = Core.el;
  var RULES = [
    'The start page is index.html. CSS, JavaScript, images and fonts go with it, with relative paths (css/app.css, not /css/app.css).',
    'No real project data, prices, customer names or keys in the files: they become public in the repo.',
    'Buttons and inputs get their actions with addEventListener. onclick="" written in the HTML is converted; onclick built inside script text is not.',
    'No login, manifest, service worker or install prompt of its own: DAME gives the sign-in and the app.',
    'No calls to outside sites or APIs. Libraries from a CDN are copied in at upload; better put them in the upload.',
    'What the tool saves in the browser (localStorage) stays on that one device. Never call localStorage.clear().',
    'It must fit a phone (390 px wide) and never depend on new tabs or the browser\'s back button.',
    'Upload, open the preview, check it, then Make live. Older versions can be restored.'
  ];
  function prompt(name) {
    return 'Build a tool called "' + (name || 'My tool') + '" for our internal site DAME. It will be uploaded as static files and shown inside the site, which already handles sign-in.\n\n' +
      'Rules, all required:\n' +
      '1. Files: index.html as the start page, plus separate .css and .js files. Relative paths only (css/app.css, never /css/app.css).\n' +
      '2. Plain HTML, CSS and JavaScript. No framework, no build step, no CDN, no external fonts. If a library is needed, name it so I can add its file to the folder.\n' +
      '3. All events with addEventListener in the .js file. No inline onclick, no inline <script> or <style>, no eval, no new Function.\n' +
      '4. No login, no manifest, no service worker, no install prompt, no analytics, no iframes.\n' +
      '5. No fetch, XMLHttpRequest or WebSocket to any outside address.\n' +
      '6. No real data in the files; use invented examples. Data the user enters may be kept in localStorage under keys starting with "' + 'tool.' + '"; never call localStorage.clear(). Offer export and import as a file (JSON or CSV) so data can move between devices.\n' +
      '7. Responsive from 390 px to desktop; no horizontal scroll; buttons at least 40 px high. No target="_blank", no dependence on the browser back button.\n' +
      '8. Clear empty, loading and error states. Plain English labels.\n\n' +
      'What the tool does:\n[describe the tool here: who uses it, what they enter, what it calculates or shows, what they take away]\n\n' +
      'Give me every file in full, with its file name.';
  }
  function copy(text, btn) {
    function done() { var t = btn.textContent; btn.textContent = 'Copied'; window.setTimeout(function () { btn.textContent = t; }, 1500); }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(done, function () { Core.toast('Select the text and copy it.'); }); return; }
    Core.toast('Select the text and copy it.');
  }
  // The guide as a block: rules, then the prompt with a Copy button.
  function box(name) {
    var text = prompt(name);
    var area = el('textarea', { class: 'guide-prompt mono', readonly: true, rows: 9, 'aria-label': 'Prompt for an AI that builds the tool' });
    area.value = text;
    var btn = el('button', { class: 'btn small', type: 'button', text: 'Copy the prompt', on: { click: function () { copy(text, btn); } } });
    var list = el('ul', { class: 'guide-rules' });
    RULES.forEach(function (r) { list.appendChild(el('li', { text: r })); });
    return el('div', { class: 'guide' },
      el('h3', { text: 'Before you build or upload' }), list,
      el('div', { class: 'row between' }, el('h3', { text: 'Prompt for an AI that builds the tool' }), btn),
      el('p', { class: 'faint', text: 'Paste it into Claude or another assistant, replace the part in [brackets], and upload the files it gives you.' }),
      area);
  }
  window.HubGuide = { rules: RULES, prompt: prompt, box: box };
})();
