import {ResourceLoader} from "tfw/core/assets"
import {Mutable} from "tfw/core/react"
import {GameEngine} from "tfw/engine/game"
import {property} from "tfw/engine/meta"
import {PrefsCategory, registerConfigurableType} from "tfw/engine/typescript/game"
import {Property} from "tfw/ui/property"

const electron = window.require && window.require("electron").remote

class GeneralPrefs extends PrefsCategory {
  readonly title = "General"

  @property("directory") rootDirectory = ""
  @property("file") catalogFile = ""
  @property("boolean", {editable: false}) showStats = false
  @property("boolean", {editable: false}) showEditorObjects = false
  @property("boolean", {editable: false}) showCoords = true

  get normalizedRoot () :string {
    if (!this.rootDirectory) return ""
    const root = toForwardSlashes(this.rootDirectory)
    return root.endsWith("/") ? root : root + "/"
  }

  init () {
    super.init()

    // when we have a root directory, we store URLs relative to it
    this.getProperty<string>("rootDirectory").onValue(rootDirectory => {
      if (!rootDirectory) {
        this.gameEngine.loader.setBaseUrl(ResourceLoader.getDefaultBaseUrl())
        Property.setCustomUrlSelector(undefined)
        return
      }
      const normalizedRoot = this.normalizedRoot
      this.gameEngine.loader.setBaseUrl("file:" + normalizedRoot)
      let lastPath = ""
      Property.setCustomUrlSelector(async value => {
        const currentPath = value.current
        const result = await electron.dialog.showOpenDialog(
          electron.getCurrentWindow(),
          {
            defaultPath: currentPath
              ? (currentPath.startsWith("/") ? currentPath : normalizedRoot + currentPath)
              : lastPath
              ? lastPath
              : normalizedRoot,
            properties: ["openFile"],
          },
        )
        if (result.filePaths.length > 0) {
          const absPath = toForwardSlashes(result.filePaths[0])
          lastPath = absPath.substring(0, absPath.lastIndexOf("/") + 1)
          value.update(
            absPath.startsWith(normalizedRoot)
              ? absPath.substring(normalizedRoot.length)
              : "file:" + absPath,
          )
        }
      })
    })
  }
}
registerConfigurableType("prefsCategory", [], "general", GeneralPrefs)

function toForwardSlashes (path :string) :string {
  return path.replace(/\\/g, "/")
}

export class Preferences {
  readonly general :GeneralPrefs

  readonly [key :string] :PrefsCategory

  constructor (gameEngine :GameEngine) {
    this.general =
      gameEngine.reconfigureConfigurable("prefsCategory", null, "general", {}) as GeneralPrefs
  }
}

Property.setConfigCreator("directory", (model, editable) => {
  // hide the entire property line if we're not running in Electron
  if (!window.require) return {type: "spacer", width: 0, height: 0}
  const value = model.resolve<Mutable<string>>("value")
  return Property.createEllipsisConfig(model, editable, async () => {
    const result = await electron.dialog.showOpenDialog(
      electron.getCurrentWindow(),
      {defaultPath: value.current, properties: ["openDirectory"]},
    )
    if (result.filePaths.length > 0) value.update(result.filePaths[0])
  })
})

Property.setConfigCreator("file", (model, editable) => {
  if (!window.require) return {type: "spacer", width: 0, height: 0}
  const value = model.resolve<Mutable<string>>("value")
  return Property.createEllipsisConfig(model, editable, async () => {
    const result = await electron.dialog.showSaveDialog(
      electron.getCurrentWindow(),
      {
        defaultPath: value.current || "untitled.catalog.js",
        filters: [
          {name: "Catalogs", extensions: ["catalog.js"]},
          {name: "All Files", extensions: ["*"]},
        ],
      },
    )
    if (result.filePath) value.update(result.filePath)
  })
})
