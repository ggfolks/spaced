import {GameEngine} from "tfw/engine/game"
import {TypeScriptConfigurable, registerConfigurableType} from "tfw/engine/typescript/game"

abstract class PrefsCategory extends TypeScriptConfigurable {
  abstract readonly title :string
}

class GeneralPrefs extends PrefsCategory {
  readonly title = "General"
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
