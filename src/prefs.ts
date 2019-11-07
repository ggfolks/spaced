import {setBaseUrl} from "tfw/core/assets"
import {Mutable} from "tfw/core/react"
import {GameEngine} from "tfw/engine/game"
import {property} from "tfw/engine/meta"
import {JavaScript} from "tfw/engine/util"
import {TypeScriptConfigurable, registerConfigurableType} from "tfw/engine/typescript/game"
import {createEllipsisConfig, setCustomUrlSelector, setPropertyConfigCreator} from "tfw/ui/property"

abstract class PrefsCategory extends TypeScriptConfigurable {
  abstract readonly title :string

  init () {
    super.init()
    // read the initial values from local storage, update on change
    for (const [property, meta] of this.propertiesMeta) {
      if (meta.constraints.readonly || meta.constraints.transient) continue
      const storageKey = this.type + "/" + property
      const value = localStorage.getItem(storageKey)
      if (value !== null) this[property] = JavaScript.parse(value)
      this.getProperty(property).onChange(
        value => localStorage.setItem(storageKey, JavaScript.stringify(value)),
      )
    }
  }
}

class GeneralPrefs extends PrefsCategory {
  readonly title = "General"

  @property("directory") rootDirectory = ""

  init () {
    super.init()

    // when we have a root directory, we store URLs relative to it
    this.getProperty<string>("rootDirectory").onValue(rootDirectory => {
      if (!rootDirectory) {
        setBaseUrl(location.origin + location.pathname)
        setCustomUrlSelector(undefined)
        return
      }
      let normalizedRoot = rootDirectory.replace(/\\/g, "/")
      if (!normalizedRoot.endsWith("/")) normalizedRoot = normalizedRoot + "/"
      setBaseUrl("file:" + normalizedRoot)
      setCustomUrlSelector(async value => {
        const electron = window.require("electron").remote
        const currentPath = value.current
        const result = await electron.dialog.showOpenDialog(
          electron.getCurrentWindow(),
          {
            defaultPath: currentPath.startsWith("/") ? currentPath : normalizedRoot + currentPath,
            properties: ["openFile"],
          },
        )
        if (result.filePaths.length > 0) {
          const absPath = result.filePaths[0]
          value.update(
            absPath.startsWith(normalizedRoot)
              ? absPath.substring(normalizedRoot.length)
              : absPath,
          )
        }
      })
    })
  }
}
registerConfigurableType("prefsCategory", [], "general", GeneralPrefs)

export class Preferences {
  readonly general :GeneralPrefs

  readonly [key :string] :PrefsCategory

  constructor (gameEngine :GameEngine) {
    this.general =
      gameEngine.reconfigureConfigurable("prefsCategory", null, "general", {}) as GeneralPrefs
  }
}

setPropertyConfigCreator("directory", (model, editable) => {
  // hide the entire property line if we're not running in Electron
  if (!window.require) return {type: "spacer", width: 0, height: 0}
  const value = model.resolve<Mutable<string>>("value")
  return createEllipsisConfig(model, editable, async () => {
    const electron = window.require("electron").remote
    const result = await electron.dialog.showOpenDialog(
      electron.getCurrentWindow(),
      {defaultPath: value.current, properties: ["openDirectory"]},
    )
    if (result.filePaths.length > 0) value.update(result.filePaths[0])
  })
})
