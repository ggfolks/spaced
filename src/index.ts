import {loadImage} from "tfw/core/assets"
import {Loop} from "tfw/core/clock"
import {Disposer} from "tfw/core/util"
import {windowSize} from "tfw/scene2/gl"
import {TypeScriptGameEngine} from "tfw/engine/typescript/game"
import {ThreeRenderEngine} from "tfw/engine/typescript/three/render"
import {CannonPhysicsEngine} from "tfw/engine/typescript/cannon/physics"
import {HTMLHost} from "tfw/ui/element"
import {UI} from "tfw/ui/ui"

import {UIConfig} from "./ui/config"
import {UIModel} from "./ui/model"
import {UIStyles, UITheme} from "./ui/theme"

const root = document.getElementById("root")
if (!root) throw new Error("No root?")

const disposer = new Disposer()
document.body.addEventListener("unload", () => disposer.dispose())

const gameEngine = new TypeScriptGameEngine(root)
disposer.add(gameEngine)
disposer.add(new ThreeRenderEngine(gameEngine))
disposer.add(new CannonPhysicsEngine(gameEngine))

const loop = new Loop()
disposer.add(loop.clock.onEmit(clock => gameEngine.update(clock)))
loop.start()
disposer.add(() => loop.stop())

const host = new HTMLHost(root)
disposer.add(host.bind(gameEngine.renderEngine.domElement))
disposer.add(loop.clock.onEmit(clock => host.update(clock)))

const ui = new UI(UITheme, UIStyles, {resolve: loadImage})
const uiRoot = ui.createRoot(UIConfig, UIModel)
disposer.add(uiRoot.bindOrigin(windowSize(window), "center", "center", "center", "center"))
host.addRoot(uiRoot)
