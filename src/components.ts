import {
  Mesh, Object3D, PlaneBufferGeometry, Scene, ShaderMaterial, Vector2, WebGLRenderTarget,
} from "three"

import {Value} from "tfw/core/react"
import {Noop, NoopRemover} from "tfw/core/util"
import {Hover} from "tfw/engine/game"
import {TypeScriptComponent, registerConfigurableType} from "tfw/engine/typescript/game"
import {ThreeObjectComponent, ThreeRenderEngine} from "tfw/engine/typescript/three/render"
import {Keyboard} from "tfw/input/keyboard"

import {selection} from "./ui/model"

let outlineCount = 0
let outlineRemover = NoopRemover

const DEFAULT_LAYER = 0
const OUTLINE_LAYER = 1

class Selector extends TypeScriptComponent {

  private _outlineObject? :Object3D

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
          if (object && (hovered || selected)) this._setOutline(object, selected)
          else this._clearOutline()
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

  private _setOutline (object :Object3D, selected :boolean) {
    this._clearOutline()
    this._outlineObject = object
    object.traverse(node => {
      if (!(node instanceof Mesh)) return
      node.layers.enable(OUTLINE_LAYER)
      let previousOpacity = 0
      node.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
        previousOpacity = material.opacity
        material.opacity = selected ? 0.5 : 0.25
      }
      node.onAfterRender = (renderer, scene, camera, geometry, material, group) => {
        material.opacity = previousOpacity
      }
    })
    if (++outlineCount === 1) {
      const threeRenderEngine = this.gameEngine.renderEngine as ThreeRenderEngine
      const renderer = threeRenderEngine.renderer
      const size = renderer.getDrawingBufferSize(new Vector2())
      const renderTarget = new WebGLRenderTarget(size.x, size.y)
      const postScene = new Scene()
      postScene.autoUpdate = false
      const postMaterial = new ShaderMaterial({
        vertexShader: `
          varying vec2 v_UV;
          void main(void) {
            v_UV = uv;
            gl_Position = vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform sampler2D texture;
          uniform vec2 pixelSize;
          varying vec2 v_UV;
          void main(void) {
            // we use a half-pixel offset so that we can take advantage of linear interpolation
            // to sample four pixels at once
            vec2 offset = pixelSize * 1.5;
            vec4 left = vec4(
              texture2D(texture, v_UV + vec2(-offset.x, -offset.y)).a,
              texture2D(texture, v_UV + vec2(-offset.x, 0.0)).a,
              texture2D(texture, v_UV + vec2(-offset.x, offset.y)).a,
              texture2D(texture, v_UV + vec2(0.0, -offset.y)).a
            );
            vec4 right = vec4(
              texture2D(texture, v_UV + vec2(0.0, offset.y)).a,
              texture2D(texture, v_UV + vec2(offset.x, -offset.y)).a,
              texture2D(texture, v_UV + vec2(offset.x, 0.0)).a,
              texture2D(texture, v_UV + vec2(offset.x, offset.y)).a
            );
            vec4 leftSigns = sign(left);
            vec4 rightSigns = sign(right);
            float sum = dot(left, vec4(1.0)) + dot(right, vec4(1.0));
            float count = dot(leftSigns, vec4(1.0)) + dot(rightSigns, vec4(1.0));
            float base = texture2D(texture, v_UV).a;
            gl_FragColor = vec4(vec3(sum / count), sign(count) * (1.0 - sign(base)));
          }
        `,
        transparent: true,
        uniforms: {
          texture: {value: renderTarget.texture},
          pixelSize: {value: new Vector2()},
        },
      })
      postScene.add(new Mesh(new PlaneBufferGeometry(2, 2), postMaterial))
      threeRenderEngine.onAfterRender = (scene, camera) => {
        renderer.getDrawingBufferSize(size)
        renderTarget.setSize(size.x, size.y)
        renderer.setRenderTarget(renderTarget)
        renderer.clear()
        camera.layers.set(OUTLINE_LAYER)
        renderer.render(scene, camera)
        camera.layers.set(DEFAULT_LAYER)

        renderer.setRenderTarget(null)
        postMaterial.uniforms.pixelSize.value.set(2 / size.x, 2 / size.y)
        renderer.render(postScene, camera)
      }
      outlineRemover = () => {
        threeRenderEngine.onAfterRender = undefined
        renderTarget.dispose()
      }
    }
  }

  private _clearOutline () {
    if (!this._outlineObject) return
    this._outlineObject.traverse(node => {
      if (!(node instanceof Mesh)) return
      node.onBeforeRender = node.onAfterRender = Noop
      node.layers.disable(OUTLINE_LAYER)
    })
    this._outlineObject = undefined
    if (--outlineCount === 0) outlineRemover()
  }
}
registerConfigurableType("component", undefined, "selector", Selector)
