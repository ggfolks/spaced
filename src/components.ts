import {Object3D} from "three"

import {Value} from "tfw/core/react"
import {Hover} from "tfw/engine/game"
import {TypeScriptComponent, registerConfigurableType} from "tfw/engine/typescript/game"
import {ThreeObjectComponent} from "tfw/engine/typescript/three/render"
import {Keyboard} from "tfw/input/keyboard"

import {selection} from "./ui/model"

class Selector extends TypeScriptComponent {

  awake () {
    this._disposer.add(
      Value
        .join2(
          this.gameObject
            .getProperty<ThreeObjectComponent|undefined>("hoverable")
            .switchMap(hoverable => {
              if (!hoverable) return Value.constant<[number, Object3D|undefined]>([0, undefined])
              return Value.join2(hoverable.hovers.sizeValue, hoverable.objectValue)
            }),
          selection.hasValue(this.gameObject.name),
        )
        .onValue(([[hovered, object], selected]) => {

        })
    )
  }

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
