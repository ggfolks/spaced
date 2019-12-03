import {
  Mesh, Object3D, PlaneBufferGeometry, Scene, ShaderMaterial, Vector2, WebGLRenderTarget,
} from "three"

import {Color} from "tfw/core/color"
import {Bounds, Plane, Ray, clamp, quat, toDegree, vec3, vec3unitZ} from "tfw/core/math"
import {Mutable, Value} from "tfw/core/react"
import {Noop, NoopRemover, PMap} from "tfw/core/util"
import {DEFAULT_LAYER_FLAG, GameObject, Hover, Tile, Transform} from "tfw/engine/game"
import {property} from "tfw/engine/meta"
import {Camera, MeshRenderer, Model} from "tfw/engine/render"
import {TypeScriptComponent, registerConfigurableType} from "tfw/engine/typescript/game"
import {ThreeObjectComponent, ThreeRenderEngine} from "tfw/engine/typescript/three/render"
import {Keyboard} from "tfw/input/keyboard"

import {
  CAMERA_LAYER_FLAG, EDITOR_HIDE_FLAG, NONINTERACTIVE_LAYER_FLAG, OUTLINE_LAYER,
  SpaceEditConfig, applyEdit, selection,
} from "./ui/model"

let outlineCount = 0
let outlineRemover = NoopRemover

let renderTarget :WebGLRenderTarget|undefined

const postScene = new Scene()
postScene.autoUpdate = false

let postMaterial :ShaderMaterial|undefined

// get these before we need them so that the Keyboard instance is created and listening
const controlKeyState = Keyboard.instance.getKeyState(17)
const shiftKeyState = Keyboard.instance.getKeyState(16)

export class Selector extends TypeScriptComponent {
  readonly groupHovered = Mutable.local(false)

  private _outlineObject? :Object3D
  private _intersectionToCenter? :vec3

  awake () {
    this._disposer.add(
      Value
        .join3(
          this.gameObject
            .getProperty<ThreeObjectComponent|undefined>("hoverable")
            .switchMap(hoverable => {
              if (!hoverable) return Value.constant<[number, Object3D|undefined]>([0, undefined])
              return Value.join2(hoverable.hovers.sizeValue, hoverable.objectValue)
            }),
          this.groupHovered,
          selection.hasValue(this.gameObject.id),
        )
        .onValue(([[hovered, object], groupHovered, selected]) => {
          if (object && (hovered || groupHovered || selected)) this._setOutline(object, selected)
          else this._clearOutline()
        })
    )
  }

  getGroupBounds (result = Bounds.create()) :Bounds {
    Bounds.empty(result)
    const tileBounds = Bounds.create()
    this._applyToGroupIds(id => {
      const gameObject = this.gameEngine.gameObjects.require(id)
      const tile = gameObject.getComponent<Tile>("tile")
      if (tile) {
        vec3.copy(tileBounds.min, tile.min)
        vec3.copy(tileBounds.max, tile.max)
        Bounds.transformMat4(tileBounds, tileBounds, gameObject.transform.localToWorldMatrix)
        Bounds.union(result, result, tileBounds)

      } else {
        const model = gameObject.getComponent<Model>("model")
        if (model) Bounds.union(result, result, model.bounds)
        const meshRenderer = gameObject.getComponent<MeshRenderer>("meshRenderer")
        if (meshRenderer) Bounds.union(result, result, meshRenderer.bounds)
      }
    })
    return result
  }

  onPointerDown (identifier :number, hover :Hover) {
    if (controlKeyState.current) {
      if (selection.has(this.gameObject.id)) selection.delete(this.gameObject.id)
      else selection.add(this.gameObject.id)

    } else if (!selection.has(this.gameObject.id)) {
      selection.clear()
      selection.add(this.gameObject.id)
    }
    const intersection = vec3.create()
    if (this._getHoverXZPlaneIntersection(hover, intersection)) {
      const bounds = this.getGroupBounds()
      const center = Bounds.getCenter(vec3.create(), bounds)
      this._intersectionToCenter = vec3.subtract(intersection, center, intersection)
    } else {
      this._intersectionToCenter = undefined
    }
  }

  onPointerDrag (identifier :number, hover :Hover) {
    if (!this._intersectionToCenter) return
    const intersection = vec3.create()
    if (!this._getHoverXZPlaneIntersection(hover, intersection)) return
    const bounds = this.getGroupBounds()
    const oldCenter = Bounds.getCenter(vec3.create(), bounds)
    const newCenter = vec3.add(intersection, intersection, this._intersectionToCenter)
    maybeGetSnapCenter(newCenter, bounds)
    this._createAndApplyEdit(id => {
      const gameObject = this.gameEngine.gameObjects.require(id)
      const offset = vec3.subtract(vec3.create(), gameObject.transform.position, oldCenter)
      return {
        transform: {position: vec3.add(offset, offset, newCenter)},
      }
    })
  }

  onWheel (identifier :number, hover :Hover, delta :vec3) {
    const bounds = this.getGroupBounds()
    const oldCenter = Bounds.getCenter(vec3.create(), bounds)
    const newCenter = vec3.clone(oldCenter)
    const rotation = quat.create()
    if (shiftKeyState.current) {
      quat.fromEuler(rotation, 0, Math.sign(delta[1]), 0)

    } else {
      // snap to nearest 90 degree angle
      const direction = vec3.transformQuat(vec3.create(), vec3unitZ, this.transform.rotation)
      const oldAngle = toDegree(Math.atan2(direction[0], direction[2]))
      const newAngle = 90 * (Math.round(oldAngle / 90) + Math.sign(delta[1]))
      const newRotation = quat.fromEuler(quat.create(), 0, newAngle, 0)
      const inverse = quat.invert(quat.create(), this.transform.rotation)
      quat.multiply(rotation, newRotation, inverse)

      // use rotated bounds to find new, snapped center
      const newBounds = Bounds.create()
      vec3.copy(newBounds.min, bounds.min)
      const size = Bounds.getSize(vec3.create(), bounds)
      vec3.set(newBounds.max, bounds.min[0] + size[2], bounds.max[1], bounds.min[2] + size[0])
      Bounds.getCenter(newCenter, newBounds)
      getSnapCenter(newCenter, newBounds)
    }
    this._createAndApplyEdit(id => {
      const gameObject = this.gameEngine.gameObjects.require(id)
      const offset = vec3.subtract(vec3.create(), gameObject.transform.position, oldCenter)
      vec3.transformQuat(offset, offset, rotation)
      return {
        transform: {
          position: vec3.add(offset, offset, newCenter),
          rotation: quat.multiply(quat.create(), rotation, gameObject.transform.rotation),
        },
      }
    })
  }

  private _createAndApplyEdit (createForId :(id :string) => PMap<any>) {
    const edit :SpaceEditConfig = {}
    this._applyToGroupIds(id => edit[id] = createForId(id))
    applyEdit({edit})
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
        material.opacity = selected ? 0.8 : 0.4
      }
      node.onAfterRender = (renderer, scene, camera, geometry, material, group) => {
        material.opacity = previousOpacity
      }
    })
    if (++outlineCount === 1) {
      const threeRenderEngine = this.gameEngine.renderEngine as ThreeRenderEngine
      const renderer = threeRenderEngine.renderer
      const size = renderer.getDrawingBufferSize(new Vector2())
      if (!renderTarget) {
        renderTarget = new WebGLRenderTarget(size.x, size.y)
        postMaterial = new ShaderMaterial({
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
        const postMesh = new Mesh(new PlaneBufferGeometry(2, 2), postMaterial)
        postMesh.frustumCulled = false
        postScene.add(postMesh)
      }
      threeRenderEngine.onAfterRender = (scene, camera) => {
        renderer.getDrawingBufferSize(size)
        renderTarget!.setSize(size.x, size.y)
        renderer.setRenderTarget(renderTarget!)
        renderer.clear()
        const previousLayerMask = camera.layers.mask
        camera.layers.set(OUTLINE_LAYER)
        renderer.render(scene, camera)
        camera.layers.mask = previousLayerMask

        renderer.setRenderTarget(null)
        postMaterial!.uniforms.pixelSize.value.set(2 / size.x, 2 / size.y)
        renderer.render(postScene, camera)
      }
      outlineRemover = () => {
        threeRenderEngine.onAfterRender = undefined
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

  private _getHoverXZPlaneIntersection (hover :Hover, result :vec3) :boolean {
    const activeCamera = this.gameEngine.renderEngine.activeCameras[0]
    if (!activeCamera) return false
    const controller = activeCamera.requireComponent<CameraController>("cameraController")
    return controller.getHoverXZPlaneIntersection(hover, result)
  }

  private _applyToGroupIds (op :(id :string) => void) {
    if (selection.has(this.gameObject.id)) {
      for (const id of selection) op(id)
    } else {
      op(this.gameObject.id)
    }
  }
}
registerConfigurableType("component", undefined, "selector", Selector)

export function maybeGetSnapCenter (inOut :vec3, bounds :Bounds) :vec3 {
  return shiftKeyState.current ? inOut : getSnapCenter(inOut, bounds)
}

function getSnapCenter (inOut :vec3, bounds :Bounds) :vec3 {
  const size = Bounds.getSize(vec3.create(), bounds)
  const refScale = vec3.fromValues(getSnapScale(size[0]), 1, getSnapScale(size[2]))
  roundToMultiple(size, refScale)
  const refCenter = vec3.fromValues(size[0] / 2 - 0.5, inOut[1], size[2] / 2 - 0.5)
  vec3.subtract(inOut, inOut, refCenter)
  roundToMultiple(inOut, refScale)
  return vec3.add(inOut, inOut, refCenter)
}

function getSnapScale (size :number) :number {
  // use closet power of two if less than one, down to 0.25
  return (size === 0) ? 1 : 2 ** clamp(Math.round(Math.log(size) / Math.log(2)), -2, 0)
}

function roundToMultiple (inOut :vec3, scale :vec3) :vec3 {
  vec3.divide(inOut, inOut, scale)
  vec3.round(inOut, inOut)
  return vec3.multiply(inOut, inOut, scale)
}

const tmpq = quat.create()
const tmpr = Ray.create()
const tmpv = vec3.create()
const tmpb = Bounds.create()

const xzPlane = Plane.fromValues(0, 1, 0, 0)

const transforms :Transform[] = []
let selectors = new Set<Selector>()
let lastSelectors = new Set<Selector>()

// a scale that's very small, but nonzero (to avoid noninvertible matrices)
const SMALL_SCALE = 0.000001

export class CameraController extends TypeScriptComponent {
  @property("vec3") target = vec3.create()
  @property("number") azimuth = 0
  @property("number") elevation = -45
  @property("number") distance = 10

  private _selectRegion? :GameObject
  private _selectStartPosition = vec3.create()

  getHoverXZPlaneIntersection (hover :Hover, result :vec3) :boolean {
    vec3.copy(tmpr.origin, this.transform.position)
    vec3.subtract(tmpr.direction, hover.worldPosition, tmpr.origin)
    vec3.normalize(tmpr.direction, tmpr.direction)
    return this.getRayXZPlaneIntersection(tmpr, result)
  }

  getRayXZPlaneIntersection (ray :Ray, result :vec3) :boolean {
    const distance = Plane.intersectRay(xzPlane, ray.origin, ray.direction)
    if (!(distance > 0)) return false // could be NaN
    Ray.getPoint(result, ray, distance)
    return true
  }

  reset () {
    // @ts-ignore zero does exist
    vec3.zero(this.target)
    this.azimuth = 0
    this.elevation = -45
    this.distance = 10
  }

  awake () {
    const offset = vec3.create()
    this._disposer.add(
      Value
        .join2(
          this.getProperty<vec3>("target"),
          Value.join(
            this.getProperty<number>("azimuth"),
            this.getProperty<number>("elevation"),
            this.getProperty<number>("distance"),
          ),
        )
        .onValue(([target, [azimuth, elevation, distance]]) => {
          quat.fromEuler(this.transform.rotation, elevation, azimuth, 0)
          vec3.transformQuat(offset, vec3.set(offset, 0, 0, distance), this.transform.rotation)
          vec3.add(this.transform.position, target, offset)
        }),
    )
    this._disposer.add(
      Value.join(controlKeyState, shiftKeyState).onValue(([control, shift]) => {
        this.requireComponent<Camera>("camera").eventMask =
          CAMERA_LAYER_FLAG | (control && shift ? 0 : DEFAULT_LAYER_FLAG)
      }),
    )
  }

  onPointerDown (identifier :number, hover :Hover) {
    const mouse = this.gameEngine.ctx.hand!.mouse
    if (mouse.getButtonState(0).current && shiftKeyState.current) {
      selection.clear()
      if (!this.getHoverXZPlaneIntersection(hover, this._selectStartPosition)) return
      this._selectRegion = this.gameEngine.createGameObject("select", {
        layerFlags: NONINTERACTIVE_LAYER_FLAG,
        hideFlags: EDITOR_HIDE_FLAG,
        transform: {
          position: this._selectStartPosition,
          localScale: vec3.fromValues(SMALL_SCALE, 1, SMALL_SCALE),
        },
        meshFilter: {
          meshConfig: {type: "cube"},
        },
        meshRenderer: {
          materialConfig: {
            type: "basic",
            color: Color.fromRGB(0.4, 0.4, 0.4),
            transparent: true,
            opacity: 0.125,
          },
        },
      })
    }
  }

  onPointerDrag (identifier :number, hover :Hover) {
    if (this._selectRegion) {
      if (!this.getHoverXZPlaneIntersection(hover, tmpv)) return
      const transform = this._selectRegion.transform
      vec3.add(transform.position, this._selectStartPosition, tmpv)
      vec3.scale(transform.position, transform.localPosition, 0.5)
      vec3.set(
        transform.localScale,
        Math.max(SMALL_SCALE, Math.abs(tmpv[0] - this._selectStartPosition[0])),
        1,
        Math.max(SMALL_SCALE, Math.abs(tmpv[2] - this._selectStartPosition[2])),
      )
      vec3.min(tmpb.min, this._selectStartPosition, tmpv)
      vec3.max(tmpb.max, this._selectStartPosition, tmpv)
      tmpb.min[1] -= 0.5
      tmpb.max[1] += 0.5
      this.gameEngine.renderEngine.overlapBounds(tmpb, ~NONINTERACTIVE_LAYER_FLAG, transforms)
      for (const transform of transforms) {
        const selector = transform.requireComponent<Selector>("selector")
        selector.groupHovered.update(true)
        selectors.add(selector)
      }
      transforms.length = 0
      for (const selector of lastSelectors) {
        if (!selectors.has(selector)) selector.groupHovered.update(false)
      }
      lastSelectors.clear();
      [selectors, lastSelectors] = [lastSelectors, selectors]
      return
    }
    const mouse = this.gameEngine.ctx.hand!.mouse
    if (mouse.getButtonState(0).current) {
      this.azimuth += hover.viewMovement[0] * -180
      this.elevation = clamp(this.elevation + hover.viewMovement[1] * 180, -90, 90)

    } else if (mouse.getButtonState(1).current) {
      this._addToDistance(hover.viewMovement[1] * -20)

    } else {
      vec3.transformQuat(
        tmpv,
        vec3.set(tmpv, -hover.viewMovement[0], 0, hover.viewMovement[1]),
        quat.fromEuler(tmpq, 0, this.azimuth, 0),
      )
      this.target = vec3.scaleAndAdd(tmpv, this.target, tmpv, this.distance)
    }
  }

  onPointerUp (identifier :number) {
    if (this._selectRegion) {
      this._selectRegion.dispose()
      this._selectRegion = undefined

      if (lastSelectors.size > 0) {
        for (const selector of lastSelectors) {
          selector.groupHovered.update(false)
          selection.add(selector.gameObject.id)
        }
        lastSelectors.clear()
      }
    }
  }

  onWheel (identifier :number, hover :Hover, delta :vec3) {
    this._addToDistance(0.5 * Math.sign(delta[1]))
  }

  private _addToDistance (amount :number) {
    this.distance = Math.max(0.5, this.distance + amount)
  }
}
registerConfigurableType("component", undefined, "cameraController", CameraController)
