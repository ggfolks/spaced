import {Hover} from "tfw/engine/game"
import {TypeScriptComponent, registerConfigurableType} from "tfw/engine/typescript/game"
import {Keyboard} from "tfw/input/keyboard"

import {selection} from "./ui/model"

class Selector extends TypeScriptComponent {

  onPointerDown (identifier :number, hover :Hover) {
    if (Keyboard.instance.getKeyState(17).current) { // control
      if (selection.has(this.gameObject.name)) selection.delete(this.gameObject.name)
      else selection.add(this.gameObject.name)
    } else {
      selection.clear()
      selection.add(this.gameObject.name)
    }
  }
}
registerConfigurableType("component", undefined, "selector", Selector)
