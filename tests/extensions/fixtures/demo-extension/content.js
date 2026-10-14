(() => {
  if (document.getElementById('obsidian-chrome-bridge-demo')) return;
  const badge = document.createElement('div');
  badge.id = 'obsidian-chrome-bridge-demo';
  badge.textContent = 'Chrome Bridge · Demo OK';
  Object.assign(badge.style, {
    position: 'fixed', right: '16px', top: '16px', zIndex: '2147483647',
    background: '#6d28d9', color: 'white', padding: '10px 16px',
    borderRadius: '8px', font: '13px system-ui, sans-serif',
    boxShadow: '0 4px 18px #0004'
  });
  (document.body || document.documentElement).appendChild(badge);
})();
