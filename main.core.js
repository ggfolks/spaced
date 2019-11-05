const {app, BrowserWindow} = require("electron")

exports.init = (url) => {
  app.on("ready", () => {
    const window = new BrowserWindow({
      width: 1024,
      height: 768,
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: true
      }
    })
    window.loadURL(url)
  })
}
