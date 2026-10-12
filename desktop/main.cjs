const {app, BrowserWindow, Menu, dialog, shell, nativeImage, session, ipcMain} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {startBackend} = require('./backend.cjs');
const {sameOrigin, externalLink, hasActiveWork} = require('./policy.cjs');
const {createProjectFolderPicker} = require('./folder-picker.cjs');

app.setName('HeloScrum');
let config;
try {
  config = JSON.parse(process.env.HELOSCRUM_DESKTOP_CONFIG || '{}');
  for (const key of ['node', 'root', 'home']) if (typeof config[key] !== 'string' || !path.isAbsolute(config[key])) throw Error(`Missing desktop ${key}. Run bash scripts/setup-desktop.sh first.`);
} catch (error) {dialog.showErrorBox('HeloScrum setup is needed', error.message); app.exit(1);}

if (config?.home) {
  const profile = path.join(config.home, 'profiles', createHash('sha256').update(config.root).digest('hex').slice(0, 16));
  fs.mkdirSync(profile, {recursive: true, mode: 0o700});
  app.setPath('userData', profile);
  app.setPath('logs', path.join(config.home, 'logs'));
  if (!app.requestSingleInstanceLock()) app.exit(0);
  else run().catch(error => {dialog.showErrorBox('HeloScrum could not open', error.message); app.exit(1);});
}

async function run() {
  const codeRoot = path.resolve(__dirname, '..');
  const startupURL = pathToFileURL(path.join(__dirname, 'startup.html')).href;
  let window, backend, origin, allowQuit = false, checkingQuit = false, closing = false;
  fs.mkdirSync(app.getPath('logs'), {recursive: true, mode: 0o700});
  const logFile = path.join(app.getPath('logs'), 'desktop.log');
  if (fs.existsSync(logFile) && fs.statSync(logFile).size > 2 * 1024 * 1024) fs.renameSync(logFile, logFile + '.previous');
  const log = message => {fs.appendFileSync(logFile, message, {mode: 0o600}); process.stdout.write(message);};
  const status = (title, detail, error = false) => {if (window && !window.isDestroyed()) window.webContents.send('startup-status', {title, detail, error});};
  const focus = () => {if (!window || window.isDestroyed()) return; window.show(); if (window.isMinimized()) window.restore(); window.focus();};
  app.on('second-instance', focus);
  app.on('activate', focus);

  async function openLink(value) {
    const url = externalLink(value);
    if (!url || closing) return;
    const result = await dialog.showMessageBox(window, {type: 'question', title: 'Open in your browser?', message: 'Open this link outside HeloScrum?', detail: url, buttons: ['Open Link', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true});
    if (result.response === 0) await shell.openExternal(url);
  }
  async function quit(ask = true) {
    if (closing || checkingQuit) return;
    checkingQuit = true;
    if (ask && backend && !backend.stopped && origin) {
      // The visible project is only one part of this server's workspace. Ask
      // the child over private IPC about sessions across every saved project.
      const state=await backend.activity();
      if (hasActiveWork(state)) {
        const {response} = await dialog.showMessageBox(window, {type: 'question', title: 'Leave HeloScrum?', message: 'Keep your workspace running?', detail: 'Keep Running minimizes this window. Quit stops the local server and managed runs. Native provider sessions may continue separately; stop them in Agents before quitting if needed.', buttons: ['Keep Running', 'Quit HeloScrum', 'Cancel'], defaultId: 0, cancelId: 2, noLink: true});
        if (response !== 1) {checkingQuit = false; if (response === 0) window.minimize(); return;}
      }
    }
    closing = true;
    if (window && !window.isDestroyed()) {await window.loadFile(path.join(__dirname, 'startup.html')); status('Saving and closing', 'Waiting for the local server to finish writing your workspace.');}
    await backend?.stop();
    log('HeloScrum desktop closed.\n');
    allowQuit = true;
    app.quit();
  }
  app.on('before-quit', event => {if (!allowQuit) {event.preventDefault(); void quit();}});
  process.on('SIGINT', () => void quit(false));
  process.on('SIGTERM', () => void quit(false));
  await app.whenReady();
  // Agent output is untrusted web content, even when served from localhost.
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => callback(permission === 'clipboard-sanitized-write' && sameOrigin(contents.getURL(), origin)));
  session.defaultSession.setPermissionCheckHandler((contents, permission, requestingOrigin) => permission === 'clipboard-sanitized-write' && sameOrigin(requestingOrigin, origin));
  window = new BrowserWindow({width: 1440, height: 940, minWidth: 800, minHeight: 600, show: false, title: 'HeloScrum', backgroundColor: '#122126', icon: path.join(__dirname, 'icon.png'), webPreferences: {preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false}});
  ipcMain.handle('choose-project-folder', createProjectFolderPicker({getWindow: () => window, getOrigin: () => origin, dialog, isClosing: () => closing}));
  const icon = nativeImage.createFromPath(path.join(__dirname, 'icon.png'));
  if (!icon.isEmpty()) app.dock?.setIcon(icon);
  window.on('close', event => {if (!allowQuit) {event.preventDefault(); void quit();}});
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('will-navigate', event => {if (!sameOrigin(event.url, origin)) {event.preventDefault(); void openLink(event.url);}});
  window.webContents.on('will-frame-navigate', event => {if (!event.isMainFrame && !sameOrigin(event.url, origin)) event.preventDefault();});
  window.webContents.on('will-redirect', event => {if (!sameOrigin(event.url, origin)) event.preventDefault();});
  window.webContents.setWindowOpenHandler(({url}) => {void openLink(url); return {action: 'deny'};});
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {label: 'HeloScrum', submenu: [{label: 'About HeloScrum', click: () => dialog.showMessageBox(window, {title: 'HeloScrum', message: 'HeloScrum · Desktop', detail: `A local workspace for your coding agents.\n\nElectron ${process.versions.electron}\n${origin || 'Starting local server…'}`})}, {type: 'separator'}, {label: 'Quit HeloScrum', accelerator: 'CmdOrCtrl+Q', click: () => void quit()}]},
    {role: 'editMenu'}, {role: 'viewMenu'}, {role: 'windowMenu'},
    {label: 'Workspace', submenu: [{label: 'Open in Browser', click: () => {if (origin) void shell.openExternal(origin);}}, {label: 'Show Workspace Folder', click: () => void shell.openPath(config.root)}, {label: 'Show Desktop Log', click: () => shell.showItemInFolder(logFile)}]},
    {label: 'Help', submenu: [{label: 'Take a Tour', click: () => {if (origin && sameOrigin(window.webContents.getURL(), origin)) void window.webContents.executeJavaScript("document.dispatchEvent(new CustomEvent('heloscrum-tour-start'))").catch(error => log(`Could not open tour: ${error.message}\n`));}}, {type: 'separator'}, {label: 'Getting Started', click: () => void shell.openPath(path.join(codeRoot, 'docs/GETTING_STARTED.md'))}, {label: 'Desktop Setup Guide', click: () => void shell.openPath(path.join(codeRoot, 'docs/DESKTOP.md'))}]},
  ]));
  await window.loadURL(startupURL);
  window.show();
  status('Starting your workspace', 'Opening the local database and connecting your tools.');
  try {
    backend = startBackend({node: config.node, codeRoot, root: config.root, log, startEngine: true, ...(config.port === undefined ? {} : {port: config.port})});
    let ready;
    try {ready = await backend.ready;}
    catch (error) {
      if (!error.message.includes('EADDRINUSE') || closing) throw error;
      log('Preferred port is busy; asking the operating system for a free port.\n');
      backend = startBackend({node: config.node, codeRoot, root: config.root, log, port: 0, startEngine: true});
      ready = await backend.ready;
    }
    origin = ready.url;
    if (closing) {await backend.stop(); return;}
    backend.exited.then(async () => {
      if (closing || backend.stopped || window.isDestroyed()) return;
      await window.loadURL(startupURL);
      status('The local server stopped', 'Your workspace is still on disk. Open Workspace → Show Desktop Log for details, then quit and reopen HeloScrum.', true);
    });
    status('Workspace ready', 'Opening HeloScrum…');
    await window.loadURL(origin);
    log(`Desktop ready: ${origin}\n`);
  } catch (error) {
    if (closing) return;
    log(`Desktop startup failed: ${error.message}\n`);
    await window.loadURL(startupURL);
    status('Could not open your workspace', `${error.message}\n\nIf this workspace is already open in another server, close that server first or select another workspace. For setup repairs, rerun scripts/setup-desktop.sh.\n\nLog: ${logFile}`, true);
  }
}
