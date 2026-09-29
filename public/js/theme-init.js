try {
  var t = JSON.parse(localStorage.getItem('hebtype.theme'));
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) { /* storage unavailable */ }
