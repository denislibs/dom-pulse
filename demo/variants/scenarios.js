// Shared stage behaviour for the demo variants.
// Every handler is a named function on purpose: DOM Pulse reports these names
// in its Sources panel, so the demo doubles as a test of its own attribution.
(function () {
  const $ = s => document.querySelector(s);
  const list = $('#list'), rows = $('#rows');

  for (let i = 0; i < 30; i++) {
    const r = document.createElement('div');
    r.className = 'row';
    r.style.setProperty('width', (18 + i * 2.6) + '%');
    rows.appendChild(r);
  }

  const fill = n => {
    list.innerHTML = Array.from({ length: n }, (_, i) => `<li class="item">item ${i}</li>`).join('');
  };
  fill(20);

  const burst = (fn, ms, total) => {
    const id = setInterval(fn, ms);
    setTimeout(() => clearInterval(id), total);
  };

  $('#btn-flip').onclick = function flipClass() {
    burst(() => $('#badge').classList.toggle('on'), 50, 3000);
  };

  let n = 0;
  $('#btn-text').onclick = function tickCounter() {
    burst(() => { $('#counter').firstChild.data = String(++n); }, 100, 3000);
  };

  $('#btn-mass').onclick = function massInsert() { fill(500); };

  $('#btn-recreate').onclick = function recreateList() {
    const items = [...list.children];
    items.forEach(li => li.remove());
    items.forEach(li => list.appendChild(li.cloneNode(true)));
  };

  // Reads layout, then writes it back — the textbook thrashing loop.
  // setProperty rather than `style.width =`: Chrome exposes named style
  // properties per instance, so those writes carry no attributable source.
  $('#btn-thrash').onclick = function forceLayout() {
    for (const r of rows.children) r.style.setProperty('width', (r.offsetWidth + 1) + 'px');
  };

  $('#btn-shift').onclick = function shiftLayout() {
    const b = document.createElement('div');
    b.id = 'banner';
    b.textContent = 'This banner pushed everything below it down.';
    $('#content').prepend(b);
    setTimeout(() => b.remove(), 1500);
  };
})();
