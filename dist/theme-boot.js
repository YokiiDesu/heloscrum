// Apply the saved palette before styles paint, including while the API is offline.
try{const p=JSON.parse(localStorage.getItem('heloscrum.preferences')||'{}'),theme=p.theme==='light'?'light':p.theme==='system'&&!matchMedia('(prefers-color-scheme: dark)').matches?'light':'dark';document.documentElement.dataset.colorTheme=theme;document.documentElement.style.colorScheme=theme;}catch{}
