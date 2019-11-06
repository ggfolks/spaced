import {GameEngine} from "tfw/engine/game"
import {property} from "tfw/engine/meta"
import {TypeScriptConfigurable, registerConfigurableType} from "tfw/engine/typescript/game"
import {createEllipsisConfig, setPropertyConfigCreator} from "tfw/ui/property"

abstract class PrefsCategory extends TypeScriptConfigurable {
  abstract readonly title :string
}

class GeneralPrefs extends PrefsCategory {
  readonly title = "General"

  @property("directory") test = ""
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
  return createEllipsisConfig(model, editable, () => {
    if (window.require) {
      const electron = window.require("electron").remote
      electron.dialog.showOpenDialog({properties: ["openDirectory"]})
    }
  })
})
