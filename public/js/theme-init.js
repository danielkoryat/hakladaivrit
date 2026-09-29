try {
  var t = JSON.parse(localStorage.getItem('hebtype.theme'));
  if (t !== 'light' && t !== 'dark') t = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
} catch (e) { /* storage unavailable */ }
