const {app, BrowserWindow} = require("electron")

exports.init = (url) => {
  app.on("ready", () => {
    const window = new BrowserWindow({
      width: 1820,
      height: 1024,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true
      }
    })
    window.loadURL(url)
  })
}
