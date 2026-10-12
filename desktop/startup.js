window.startup?.onStatus(({title, detail, error}) => {
  document.getElementById('status').textContent = title;
  document.getElementById('detail').textContent = detail;
  document.body.classList.toggle('error', !!error);
});
