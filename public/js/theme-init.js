(() => {
  try {
    let theme = JSON.parse(localStorage.getItem('hebtype.theme'));
    if (theme !== 'light' && theme !== 'dark') theme = window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
  } catch (e) { /* storage unavailable */ }
})();
