const {sameOrigin} = require('./policy.cjs');

// The renderer can ask for one user-selected folder, not read arbitrary paths.
function createProjectFolderPicker({getWindow, getOrigin, dialog, isClosing = () => false}) {
  let pending = false;
  return async event => {
    const window = getWindow();
    const allowed = () => window && !window.isDestroyed() && !isClosing()
      && event.sender === window.webContents
      && event.senderFrame === window.webContents.mainFrame
      && sameOrigin(event.senderFrame?.url, getOrigin());
    if (!allowed()) throw Error('Folder selection is only available in the HeloScrum window.');
    if (pending) return null;
    pending = true;
    try {
      const result = await dialog.showOpenDialog(window, {
        title: 'Open Local Folder', buttonLabel: 'Choose Folder',
        properties: ['openDirectory', 'createDirectory'],
      });
      return allowed() && !result.canceled ? result.filePaths[0] || null : null;
    } finally {pending = false;}
  };
}
module.exports = {createProjectFolderPicker};
