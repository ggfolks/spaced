import {Color} from "tfw/core/color"
import {refEquals} from "tfw/core/data"
import {Bounds, dim2, mat4, quat, quatIdentity, vec2, vec3} from "tfw/core/math"
import {Emitter, Mutable, Value} from "tfw/core/react"
import {MutableMap, MutableSet, RMap} from "tfw/core/rcollect"
import {Disposable, Disposer, Noop, PMap, getValue} from "tfw/core/util"
import {CategoryNode} from "tfw/graph/node"
import {
  ALL_HIDE_FLAGS_MASK, DEFAULT_PAGE, EDITOR_LAYER_FLAG, NO_HIDE_FLAGS_MASK,
  DefaultTileBounds, GameEngine, GameObject, GameObjectConfig, SpaceConfig, Tile,
} from "tfw/engine/game"
import {Model as RenderModel, FusedModels} from "tfw/engine/render"
import {NON_TILE_FLAG, WALKABLE_FLAG, FusedEncoder, JavaScript, decodeFused} from "tfw/engine/util"
import {MOUSE_ID} from "tfw/input/hand"
import {getCurrentEditNumber} from "tfw/input/interact"
import {
  Action, Command, Model, ModelData, ModelKey, ElementsModel, dataModel, makeModel, mapModel,
} from "tfw/ui/model"
import {Property} from "tfw/ui/property"
import {UI} from "tfw/ui/ui"

import {createPrefsConfig} from "./config"
import {CameraController, Selector, maybeGetSnapCenter} from "../components"
import {Preferences} from "../prefs"

export const NONINTERACTIVE_LAYER_FLAG = (1 << 2)
export const CAMERA_LAYER_FLAG = (1 << 3)

export const EDITOR_HIDE_FLAG = (1 << 1)

export interface SpaceEditConfig {
  [id :string] :PMap<any>
}

export interface GameObjectEdit {
  editNumber? :number
  version? :number
  activePage? :string
  selection? :Set<string>
  expanded? :Set<string>
  add? :SpaceConfig
  edit? :SpaceEditConfig
  remove? :Set<string>
}

interface FullGameObjectEdit extends GameObjectEdit {
  version :number
  activePage :string
  selection :Set<string>
  expanded :Set<string>
  add :SpaceConfig
  edit :SpaceEditConfig
  remove :Set<string>
}

const electron = window.require && window.require("electron").remote

export const selection = MutableSet.local<string>()

export let applyEdit :(edit :GameObjectEdit) => void = Noop

interface CatalogNodeConfig {
  name :string
  objects :SpaceConfig
  children :PMap<CatalogNodeConfig>
}

export const catalogNodes = MutableMap.local<string, CatalogNode>()
export const catalogSelection = MutableSet.local<string>()
const catalogChanged = new Emitter<void>()
const emitCatalogChanged = () => catalogChanged.emit()

class CatalogNode implements Disposable {
  readonly name :Mutable<string>
  readonly objects = Mutable.local<SpaceConfig>({})
  readonly childIds = Mutable.local<string[]>([])
  readonly expanded = Mutable.local(false)

  private _disposer = new Disposer()

  constructor (readonly id :string, public parentId :string) {
    this.name = Mutable.local(id)
    catalogNodes.set(id, this)
    this._disposer.add(this.name.onChange(emitCatalogChanged))
    this._disposer.add(this.objects.onChange(emitCatalogChanged))
    this._disposer.add(this.childIds.onChange(emitCatalogChanged))
  }

  createModel () {
    return new Model({
      id: Value.constant(this.id),
      name: this.name,
      hasChildren: this.childIds.map(childIds => childIds.length > 0),
      childModel: this.createElementsModel(),
      expanded: this.expanded,
      toggleExpanded: () => this.expanded.update(!this.expanded.current),
    })
  }

  createElementsModel () :ElementsModel<string> {
    return {
      keys: this.childIds,
      resolve: childId => catalogNodes.require(childId).createModel(),
    }
  }

  createConfig () :CatalogNodeConfig {
    const children :PMap<CatalogNodeConfig> = {}
    for (const childId of this.childIds.current) {
      children[childId] = catalogNodes.require(childId).createConfig()
    }
    return {
      name: this.name.current,
      objects: this.objects.current,
      children,
    }
  }

  addNewChild (objects :SpaceConfig) :string {
    const baseId = "entry"
    let id = baseId
    for (let ii = 2; catalogNodes.has(id); ii++) id = baseId + ii
    const node = new CatalogNode(id, this.id)
    node.objects.update(objects)
    this.insertChild(id, this.childIds.current.length)
    return id
  }

  insertChild (id :string, index :number) {
    const childIds = this.childIds.current.slice()
    childIds.splice(index, 0, id)
    this.childIds.update(childIds)
  }

  deleteChild (id :string) {
    const childIds = this.childIds.current.slice()
    childIds.splice(childIds.indexOf(id), 1)
    this.childIds.update(childIds)
  }

  moveChild (id :string, index :number) :number {
    const oldIndex = this.childIds.current.indexOf(id)
    if (oldIndex === index) return index + 1
    const childIds = this.childIds.current.slice()
    childIds.splice(oldIndex, 1)
    const adjustedIndex = index < oldIndex ? index : index - 1
    childIds.splice(adjustedIndex, 0, id)
    this.childIds.update(childIds)
    return adjustedIndex + 1
  }

  dispose () {
    for (const childId of this.childIds.current) catalogNodes.require(childId).dispose()
    catalogNodes.require(this.parentId).deleteChild(this.id)
    catalogSelection.delete(this.id)
    catalogNodes.delete(this.id)
    this._disposer.dispose()
  }
}

const catalogRoot = new CatalogNode("root", "")

function clearCatalog () {
  for (const node of catalogNodes.values()) {
    if (node !== catalogRoot) node.dispose()
  }
}

export let pasteFromCatalog :(position :vec3, rotation :quat) => void = Noop

export const activeTree = Mutable.local<"objects"|"catalog">("objects")

export function createUIModel (
  minSize :Value<dim2>,
  gameEngine :GameEngine,
  prefs :Preferences,
  ui :UI,
) {
  const getOrder = (id :string) => {
    if (id === DEFAULT_PAGE) return 0
    return gameEngine.gameObjects.require(id).order
  }
  const loader = gameEngine.loader
  const models = new Map<ModelKey, Model>()
  const pageEditor = createGameObjectEditor(gameEngine, models)
  const path = Mutable.local("")
  const activeVersion = Mutable.local(0)
  const savedVersion = Mutable.local(0)
  const changed = Value
    .join(activeVersion, savedVersion)
    .map(([active, saved]) => active !== saved)
  const getPathName = () => (path.current === "") ? "untitled.space.js" : path.current
  Value.join2(path, changed).onValue(([path, changed]) => {
    document.title = `${changed ? "*" : ""}${getPathName()} — Spaced`
  })
  const haveSelection = selection.sizeValue.map(Boolean)
  const haveCatalogSelection = catalogSelection.sizeValue.map(Boolean)
  const selectionArray = selection.fold<string[]>([], (value, set) => Array.from(set))
  const clipboard = Mutable.local<SpaceConfig|undefined>(undefined)
  const expanded = MutableSet.local<string>()
  const canUndo = Mutable.local(false)
  const canRedo = Mutable.local(false)
  const undoStack :FullGameObjectEdit[] = []
  const redoStack :FullGameObjectEdit[] = []
  let currentVersion = 0
  const resetModel = () => {
    activeVersion.update(currentVersion)
    savedVersion.update(currentVersion)
    expanded.clear()
    selection.clear()
    undoStack.length = 0
    redoStack.length = 0
    gameEngine.disposeGameObjects()
    gameEngine.createGameObjects(EditorObjects)
  }
  const addSelectors = (config: SpaceConfig) => {
    for (const id in config) config[id].selector = {hideFlags: EDITOR_HIDE_FLAG}
    return config
  }
  const createNewSpace = () => {
    path.update("")
    resetModel()
    gameEngine.createGameObjects(addSelectors(AutomaticObjects))
  }
  createNewSpace()
  const loadConfig = (config :SpaceConfig) => {
    resetModel()
    gameEngine.createGameObjects(addSelectors(config), true)
  }
  gameEngine.activePage.onChange(() => selection.clear())
  applyEdit = (edit :GameObjectEdit) => {
    const oldActivePage = gameEngine.activePage.current
    const oldSelection = new Set(selection)
    const oldExpanded = new Set(expanded)
    const reverseEdit = pageEditor(edit)
    if (edit.activePage) gameEngine.activePage.update(edit.activePage)
    if (edit.selection) setIdSet(selection, edit.selection)
    if (edit.expanded) setIdSet(expanded, edit.expanded)
    const lastEdit = undoStack[undoStack.length - 1]
    const currentEditNumber = getCurrentEditNumber()
    if (lastEdit && lastEdit.editNumber === currentEditNumber) {
      // merge into last edit
      for (const id in reverseEdit.add) {
        const gameObjectConfig = reverseEdit.add[id]
        const editConfig = lastEdit.edit[id]
        if (editConfig) {
          delete lastEdit.edit[id]
          mergeEdits(gameObjectConfig, editConfig)

        } else if (lastEdit.remove.has(id)) {
          lastEdit.remove.delete(id)
          continue
        }
        lastEdit.add[id] = gameObjectConfig
      }
      for (const id in reverseEdit.edit) {
        const gameObjectConfig = reverseEdit.edit[id]
        const editConfig = lastEdit.edit[id]
        if (editConfig) {
          mergeEdits(gameObjectConfig, editConfig)
        } else if (lastEdit.remove.has(id)) {
          continue
        }
        lastEdit.edit[id] = gameObjectConfig
      }
      for (const id of reverseEdit.remove) {
        const addConfig = lastEdit.add[id]
        if (addConfig) {
          delete lastEdit.add[id]
          lastEdit.edit[id] = addConfig
        } else {
          lastEdit.remove.add(id)
        }
      }
    } else {
      reverseEdit.editNumber = currentEditNumber
      reverseEdit.version = activeVersion.current
      reverseEdit.activePage = oldActivePage
      reverseEdit.selection = oldSelection
      reverseEdit.expanded = oldExpanded
      undoStack.push(reverseEdit)
    }
    redoStack.length = 0
    canUndo.update(true)
    canRedo.update(false)
    activeVersion.update(++currentVersion)
  }
  const applyToSelection = (perObjectEdit :PMap<any>) => {
    const edit :SpaceEditConfig = {}
    for (const id of selection) edit[id] = perObjectEdit
    applyEdit({edit})
  }
  const showEditorObjects = prefs.general.getProperty("showEditorObjects") as Mutable<boolean>
  const filterGameObjectKeys = (keys :string[]) => {
    if (showEditorObjects.current) return keys
    return keys.filter(key => !(gameEngine.gameObjects.require(key).hideFlags & EDITOR_HIDE_FLAG))
  }
  const filterComponentTypes = (gameObject :GameObject) => {
    const types = gameObject.componentTypes.current
    if (showEditorObjects.current) return types
    return types.filter(type => !(gameObject.requireComponent(type).hideFlags & EDITOR_HIDE_FLAG))
  }
  function gameObjectModel (keys :Value<string[]>) :ElementsModel<string> {
    return {
      keys: Value.join2(keys, showEditorObjects).map(([keys]) => filterGameObjectKeys(keys)),
      resolve: (key :ModelKey) => {
        let model = models.get(key)
        if (!model) {
          const gameObject = gameEngine.gameObjects.require(key as string)
          const createPropertyValue = createPropertyValueCreator(gameObject, applyEdit)
          models.set(key, model = new Model({
            id: Value.constant(key),
            name: createPropertyValue("name"),
            hasChildren: Value.join2(gameObject.transform.childIds, showEditorObjects).map(
              ([childIds, showEditorObjects]) => {
                if (showEditorObjects) return childIds.length > 0
                for (const childId of childIds) {
                  if (!(gameEngine.gameObjects.require(childId).hideFlags & EDITOR_HIDE_FLAG)) {
                    return true
                  }
                }
                return false
              },
            ),
            childModel: gameObjectModel(gameObject.transform.childIds),
            expanded: expanded.hasValue(key as string),
            toggleExpanded: () => {
              if (expanded.has(key as string)) expanded.delete(key as string)
              else expanded.add(key as string)
            },
          }))
        }
        return model
      },
    }
  }
  const NUMERIC_SUFFIX = /\d+$/
  const getUnusedName = (base :string, adding? :SpaceConfig) => {
    // strip off any existing numeric suffix
    base = base.replace(NUMERIC_SUFFIX, "")
    let name = base
    for (
      let ii = 2;
      gameEngine.gameObjects.has(name) || (adding && adding[name]);
      ii++
    ) name = base + ii
    return name
  }
  const getPageParentId = () => {
    const activePage = gameEngine.activePage.current
    return (activePage === DEFAULT_PAGE) ? undefined : activePage
  }
  const getNextPageOrder = () => {
    const rootIds = gameEngine.rootIds.current
    return (rootIds.length === 0) ? 0 : getOrder(rootIds[rootIds.length - 1]) + 1
  }
  const vec2half = vec2.fromValues(0.5, 0.5)
  const getPointerWorldPosition = (out :vec3, center :boolean = false) => {
    // @ts-ignore zero missing from type def
    vec3.zero(out)
    const camera = gameEngine.renderEngine.activeCameras[0]
    if (camera) {
      const cameraController = camera.getComponent<CameraController>("cameraController")
      if (cameraController) {
        const pointer = gameEngine.ctx.hand!.pointers.get(MOUSE_ID)
        const ray = pointer && !center
          ? camera.screenPointToRay(pointer.position)
          : camera.viewportPointToRay(vec2half)
        cameraController.getRayXZPlaneIntersection(ray, out)
      }
    }
    return out
  }
  const createObject = (type :string, config :GameObjectConfig) => {
    const name = getUnusedName(type)
    const parentId = getPageParentId()
    if (!config.transform) config.transform = {}
    config.transform.parentId = parentId
    if (!config.transform.localPosition) {
      config.transform.localPosition = getPointerWorldPosition(vec3.create(), true)
    }
    config.order = getNextPageOrder()
    config.selector = {hideFlags: EDITOR_HIDE_FLAG}
    applyEdit({selection: new Set([name]), add: {[name]: config}})
    return name
  }
  const addSubtreeToConfig = (config :SpaceConfig, rootId :string, mask = NO_HIDE_FLAGS_MASK) => {
    if (config[rootId]) return
    const gameObject = gameEngine.gameObjects.require(rootId)
    config[rootId] = gameObject.createConfig(mask)
    for (const childId of gameObject.transform.childIds.current) {
      addSubtreeToConfig(config, childId, mask)
    }
  }
  const clipboardBounds = Bounds.create()
  const getSelectedConfig = (bounds :Bounds, mask = NO_HIDE_FLAGS_MASK) => {
    const config :SpaceConfig = {}
    const firstId = selection.values().next().value
    const selector = gameEngine.gameObjects.require(firstId).requireComponent<Selector>("selector")
    selector.getGroupBounds(bounds)
    const center = Bounds.getCenter(vec3.create(), bounds)
    for (const id of selection) {
      addSubtreeToConfig(config, id, mask)
      const transform = gameEngine.gameObjects.require(id).transform
      if (!(transform.parentId && selection.has(transform.parentId))) {
        const transformConfig = config[id].transform
        transformConfig.parentId = undefined
        transformConfig.localPosition = vec3.subtract(vec3.create(), transform.position, center)
      }
    }
    return config
  }
  const copySelected = () => clipboard.update(getSelectedConfig(clipboardBounds))
  const addSubtreeToSet = (set :Set<string>, rootId :string) => {
    set.add(rootId)
    for (const childId of gameEngine.gameObjects.require(rootId).transform.childIds.current) {
      addSubtreeToSet(set, childId)
    }
  }
  const removeSelected = () => {
    const remove = new Set<string>()
    for (const id of selection) addSubtreeToSet(remove, id)
    applyEdit({selection: new Set(), remove})
  }
  const pasteConfig = (config :SpaceConfig, position :vec3, rotation :quat, select = true) => {
    const add :SpaceConfig = {}
    const newIds = new Map<string, string>()
    for (const id in config) {
      const newId = getUnusedName(id, add)
      newIds.set(id, newId)
      add[newId] = {}
    }
    const replaceIds = (config :PMap<any>) => {
      const newConfig :PMap<any> = {}
      for (const key in config) {
        const value = config[key]
        if (typeof value === "string" && key.endsWith("Id")) {
          const newId = newIds.get(value)
          if (newId) newConfig[key] = newId

        } else if (
          typeof value === "object" &&
          value !== null &&
          Object.getPrototypeOf(value) === Object.prototype
        ) {
          newConfig[key] = replaceIds(value)

        } else {
          newConfig[key] = value
        }
      }
      return newConfig
    }
    const selection = new Set<string>()
    const pageParentId = getPageParentId()
    let nextPageOrder = getNextPageOrder()
    for (const id in config) {
      const newId = newIds.get(id)!
      if (select) selection.add(newId)
      const newConfig = replaceIds(config[id])
      if (!(newConfig.transform && newConfig.transform.parentId)) {
        if (!newConfig.transform) newConfig.transform = {}
        const localPosition = newConfig.transform.localPosition
        if (localPosition) {
          const offset = vec3.transformQuat(vec3.create(), localPosition, rotation)
          newConfig.transform.localPosition = vec3.add(offset, offset, position)
        } else {
          newConfig.transform.localPosition = vec3.clone(position)
        }
        const localRotation = newConfig.transform.localRotation
        if (localRotation) {
          newConfig.transform.localRotation = quat.multiply(quat.create(), rotation, localRotation)
        } else {
          newConfig.transform.localRotation = quat.clone(rotation)
        }
        newConfig.transform.parentId = pageParentId
        newConfig.order = nextPageOrder++
      }
      add[newId] = newConfig
    }
    applyEdit({selection, add})
  }
  pasteFromCatalog = (position, rotation) => {
    for (const id of catalogSelection) {
      const config = JavaScript.clone(catalogNodes.require(id).objects.current)
      pasteConfig(addSelectors(config), position, rotation, false)
    }
  }
  const pasteFromClipboard = () => {
    const position = getPointerWorldPosition(vec3.create())
    maybeGetSnapCenter(position, clipboardBounds)
    pasteConfig(clipboard.current!, position, quatIdentity)
  }
  function getCategoryModel (category :CategoryNode) :ElementsModel<string> {
    return mapModel(category.children.keysValue, category.children, (value, key) => {
      if (value.current instanceof CategoryNode) return {
        name: Value.constant(key),
        submenu: Value.constant(true),
        model: getCategoryModel(value.current),
      }
      return {
        name: Value.constant(key),
        enabled: haveSelection,
        action: () => {
          const gameObject = gameEngine.gameObjects.require(selectionArray.current[0])
          const componentTypes = gameObject.componentTypes.current
          const last = gameObject.requireComponent(componentTypes[componentTypes.length - 1])
          const order = last.order + 1
          applyToSelection({[key]: {order}})
        },
      } as ModelData
    })
  }
  const componentTypesModel = getCategoryModel(gameEngine.getConfigurableTypeRoot("component"))
  const coords = Mutable.local("")
  const coordPos = vec3.create()
  const formatCoord = (value :number) => {
    const base = String(Math.round(value * 100) / 100)
    let idx = base.indexOf(".")
    return (idx === -1)
      ? base + ".00"
      : idx === base.length - 2
      ? base + "0"
      : base
  }
  gameEngine.addUpdatable({
    update: () => {
      getPointerWorldPosition(coordPos)
      coords.update(
        formatCoord(coordPos[0]) + " " +
        formatCoord(coordPos[1]) + " " +
        formatCoord(coordPos[2])
      )
    },
  })

  let electronActions :PMap<Command> = {}
  let openModel :ModelData = {}
  let saveModel :ModelData = {}
  let quitModel :ModelData = {}
  const filters = [
    {name: "Spaces", extensions: ["space.js"]},
    {name: "All Files", extensions: ["*"]},
  ]
  let writeTo :(value :any, path :string, callback? :() => void) => void = Noop
  const saveTo = (path :string) => writeTo(gameEngine.createConfig(), path)
  let readFrom :(path :string, onLoad :(value :any) => void) => void = Noop
  const loadFrom = (path :string) => readFrom(path, loadConfig)
  let importConfig = (onLoad :(config :SpaceConfig) => void) => {
    const input = document.createElement("input")
    input.setAttribute("type", "file")
    input.setAttribute("accept", "application/javascript")
    input.addEventListener("change", event => {
      if (!input.files || input.files.length === 0) return
      const reader = new FileReader()
      reader.onload = () => {
        onLoad(loader.eval(reader.result as string) as SpaceConfig)
      }
      reader.readAsText(input.files[0])
    })
    input.click()
  }
  let exportConfig = (config :SpaceConfig) => {
    const file = new File(
      [JavaScript.stringify(config)],
      "untitled.space.js",
      {type: "application/octet-stream"},
    )
    open(URL.createObjectURL(file), "_self")
    // TODO: call revokeObjectURL when finished with download
  }
  const jsonify = (value :any) => {
    if (typeof value !== "object" || value === null) return value
    switch (value.constructor) {
      case Float32Array:
      case Uint16Array:
      case Uint32Array:
      case Array:
      case Color:
        const array :any[] = []
        for (let ii = 0; ii < value.length; ii++) array.push(jsonify(value[ii]))
        return array

      case Uint8Array:
        const tiles :any[] = []
        const addTiles = (source :Uint8Array, parentMatrix :mat4) => {
          decodeFused(source, {
            visitTile: (url, bounds, position, rotation, scale, flags) => {
              const matrix = mat4.create()
              mat4.fromRotationTranslationScale(matrix, rotation, position, scale)
              mat4.multiply(matrix, parentMatrix, matrix)
              tiles.push(jsonify({
                url,
                bounds,
                position: mat4.getTranslation(vec3.create(), matrix),
                rotation: mat4.getRotation(quat.create(), matrix),
                scale: mat4.getScaling(vec3.create(), matrix),
                flags,
              }))
            },
            visitFusedTiles: (source, position, rotation, scale) => {
              const matrix = mat4.create()
              mat4.fromRotationTranslationScale(matrix, rotation, position, scale)
              mat4.multiply(matrix, parentMatrix, matrix)
              addTiles(source, matrix)
            },
          })
        }
        addTiles(value, mat4.create())
        return tiles

      default:
        const json :PMap<any> = {}
        for (const key in value) json[key] = jsonify(value[key])
        return json
    }
  }
  let exportConfigAsJson = (config :SpaceConfig) => {
    const file = new File(
      [JSON.stringify(jsonify(config))],
      "untitled.space.json",
      {type: "application/json"},
    )
    open(URL.createObjectURL(file), "_self")
    // TODO: call revokeObjectURL when finished with download
  }

  activeTree.onChange(activeTree => {
    if (activeTree === "objects") catalogSelection.clear()
    else selection.clear()
  })

  let confirmRemoveFromCatalog = Noop

  if (window.require) {
    const fs = window.require("fs")
    writeTo = (value, path, callback) => {
      fs.writeFile(path, JavaScript.stringify(value), (error? :Error) => {
        if (error) console.warn(error)
        if (callback) callback()
      })
    }
    readFrom = (path, onLoad) => {
      fs.readFile(path, "utf8", (error :Error|undefined, data :string) => {
        if (error) console.warn(error)
        else onLoad(loader.eval(data))
      })
    }
    let lastPath = ""
    importConfig = async onLoad => {
      const result = await electron.dialog.showOpenDialog(
        electron.getCurrentWindow(),
        {
          title: "Import",
          defaultPath: lastPath || prefs.general.normalizedRoot,
          buttonLabel: "Import",
          properties: ["openFile"],
          filters,
        },
      )
      if (result.filePaths.length > 0) readFrom(lastPath = result.filePaths[0], onLoad)
    }
    exportConfig = async config => {
      const result = await electron.dialog.showSaveDialog(
        electron.getCurrentWindow(),
        {
          title: "Export",
          defaultPath: lastPath || prefs.general.normalizedRoot + "export.space.js",
          buttonLabel: "Export",
          properties: ["openFile", "promptToCreate"],
          filters,
        },
      )
      if (result.filePath) writeTo(config, lastPath = result.filePath)
    }
    exportConfigAsJson = async config => {
      const result = await electron.dialog.showSaveDialog(
        electron.getCurrentWindow(),
        {
          title: "Export as JSON",
          defaultPath: prefs.general.normalizedRoot + "export.space.json",
          buttonLabel: "Export",
          properties: ["openFile", "promptToCreate"],
          filters: [
            {name: "JSON Spaces", extensions: ["space.json"]},
            {name: "All Files", extensions: ["*"]},
          ],
        },
      )
      if (result.filePath) {
        fs.writeFile(result.filePath, JSON.stringify(jsonify(config)), (error? :Error) => {
          if (error) console.warn(error)
        })
      }
    }
    const save = () => {
      saveTo(path.current)
      savedVersion.update(activeVersion.current)
      maybeSaveCatalog()
    }
    const saveAs = async () => {
      const result = await electron.dialog.showSaveDialog(
        electron.getCurrentWindow(),
        {
          title: "Save As",
          defaultPath: path.current || lastPath || prefs.general.normalizedRoot + getPathName(),
          buttonLabel: "Save",
          properties: ["openFile", "promptToCreate"],
          filters,
        },
      )
      if (result.filePath) {
        path.update(lastPath = result.filePath)
        save()
      }
    }
    electronActions = {
      open: new Command(async () => {
        const result = await electron.dialog.showOpenDialog(
          electron.getCurrentWindow(),
          {
            title: "Open Space",
            defaultPath: lastPath || prefs.general.normalizedRoot,
            buttonLabel: "Open",
            properties: ["openFile"],
            filters,
          },
        )
        if (result.filePaths.length > 0) {
          path.update(lastPath = result.filePaths[0])
          loadFrom(path.current)
        }
      }),
      save: new Command(() => {
        if (path.current) save()
        else saveAs()
      }),
      saveAs: new Command(saveAs),
      revert: new Command(
        () => loadFrom(path.current),
        Value.join2(path, changed).map(([path, changed]) => !!path && changed),
      ),
      quit: new Command(async () => {
        if (changed.current) {
          const result = await electron.dialog.showMessageBox(
            electron.getCurrentWindow(),
            {
              type: "question",
              buttons: ["Cancel", "Quit"],
              defaultId: 1,
              title: "Confirm Quit",
              message: "Are you sure you want to quit without saving?",
            },
          )
          if (!result) return
        }
        maybeSaveCatalog(() => electron.process.exit())
      }),
    }

    prefs.general.getProperty<string>("catalogFile").onValue(file => {
      clearCatalog()
      if (!file) return
      const loadCatalogNode = (node :CatalogNode, config :CatalogNodeConfig) => {
        node.name.update(config.name)
        node.objects.update(config.objects)
        const childIds :string[] = []
        for (const id in config.children) {
          loadCatalogNode(new CatalogNode(id, node.id), config.children[id])
          childIds.push(id)
        }
        node.childIds.update(childIds)
      }
      readFrom(file, rootConfig => loadCatalogNode(catalogRoot, rootConfig))
    })

    let catalogTimeout :number|undefined
    const maybeSaveCatalog = (callback? :() => void) => {
      if (catalogTimeout !== undefined) {
        window.clearTimeout(catalogTimeout)
        catalogTimeout = undefined
        const file = prefs.general.catalogFile
        if (file) {
          writeTo(catalogRoot.createConfig(), file, callback)
          return
        }
      }
      if (callback) callback()
    }
    catalogChanged.onEmit(() => {
      if (catalogTimeout !== undefined) window.clearTimeout(catalogTimeout)
      catalogTimeout = window.setTimeout(maybeSaveCatalog, 5000)
    })

    confirmRemoveFromCatalog = async () => {
      const result = await electron.dialog.showMessageBox(
        electron.getCurrentWindow(),
        {
          type: "question",
          buttons: ["Cancel", "Remove"],
          defaultId: 1,
          title: "Confirm Remove",
          message: "Are you sure you want to remove this entry/these entries from the catalog?",
        },
      )
      if (!result) return
      for (const id of catalogSelection) catalogNodes.require(id).dispose()
    }
    openModel = {
      open: {
        name: Value.constant("Open Space..."),
        action: electronActions.open,
        shortcut: Value.constant("open"),
      },
    }
    saveModel = {
      save: {
        name: Value.constant("Save"),
        action: electronActions.save,
        shortcut: Value.constant("save"),
      },
      saveAs: {
        name: Value.constant("Save As..."),
        action: electronActions.saveAs,
        shortcut: Value.constant("saveAs"),
      },
      revert: {
        name: Value.constant("Revert"),
        action: electronActions.revert,
        shortcut: Value.constant("revert"),
      },
      separator2: {},
    }
    quitModel = {
      separator3: {},
      quit: {
        name: Value.constant("Quit"),
        action: electronActions.quit,
        shortcut: Value.constant("quit"),
      },
    }
  }

  const menuActions = {
    new: new Command(createNewSpace),
    ...electronActions,
    undo: new Command(() => {
      const oldActivePage = gameEngine.activePage.current
      const oldSelection = new Set(selection)
      const oldExpanded = new Set(expanded)
      const edit = undoStack.pop()!
      const reverseEdit = pageEditor(edit)
      gameEngine.activePage.update(edit.activePage)
      setIdSet(selection, edit.selection)
      setIdSet(expanded, edit.expanded)
      reverseEdit.version = activeVersion.current
      reverseEdit.activePage = oldActivePage
      reverseEdit.selection = oldSelection
      reverseEdit.expanded = oldExpanded
      redoStack.push(reverseEdit)
      canRedo.update(true)
      canUndo.update(undoStack.length > 0)
      activeVersion.update(edit.version)
    }, canUndo),
    redo: new Command(() => {
      const oldActivePage = gameEngine.activePage.current
      const oldSelection = new Set(selection)
      const oldExpanded = new Set(expanded)
      const edit = redoStack.pop()!
      const reverseEdit = pageEditor(edit)
      gameEngine.activePage.update(edit.activePage)
      setIdSet(selection, edit.selection)
      setIdSet(expanded, edit.expanded)
      reverseEdit.version = activeVersion.current
      reverseEdit.activePage = oldActivePage
      reverseEdit.selection = oldSelection
      reverseEdit.expanded = oldExpanded
      undoStack.push(reverseEdit)
      canUndo.update(true)
      canRedo.update(redoStack.length > 0)
      activeVersion.update(edit.version)
    }, canRedo),
    cut: new Command(() => {
      copySelected()
      removeSelected()
    }, haveSelection),
    copy: new Command(copySelected, haveSelection),
    paste: new Command(pasteFromClipboard, clipboard.map(Boolean)),
    delete: new Command(
      () => {
        if (haveCatalogSelection.current) confirmRemoveFromCatalog()
        else removeSelected()
      },
      Value
        .join2(haveSelection, haveCatalogSelection)
        .map(([haveSelection, haveCatalogSelection]) => haveSelection || haveCatalogSelection),
    ),
    selectAll: () => {
      const set = new Set<string>()
      for (const rootId of filterGameObjectKeys(gameEngine.rootIds.current)) {
        addSubtreeToSet(set, rootId)
      }
      setIdSet(selection, set)
    },
    raiseGrid: () => {
      const activeCamera = gameEngine.renderEngine.activeCameras[0]
      if (activeCamera) activeCamera.gameObject.cameraController.target[1] += 1
    },
    lowerGrid: () => {
      const activeCamera = gameEngine.renderEngine.activeCameras[0]
      if (activeCamera) activeCamera.gameObject.cameraController.target[1] -= 1
    },
  }

  const viewNames :PMap<string> = {
    showEditorObjects: "Editor Objects",
    showStats: "Stats",
    showCoords: "Coords",
    enableShadows: "Shadows",
    showWalkableAreas: "Walkable Areas",
  }
  const viewData :ModelData = {
    raiseGrid: {
      name: Value.constant("Raise Grid"),
      action: menuActions.raiseGrid,
      shortcut: Value.constant("raiseGrid"),
    },
    lowerGrid: {
      name: Value.constant("Lower Grid"),
      action: menuActions.lowerGrid,
      shortcut: Value.constant("lowerGrid"),
    },
    resetCamera: {
      name: Value.constant("Reset Camera"),
      action: () => {
        const activeCamera = gameEngine.renderEngine.activeCameras[0]
        if (activeCamera) activeCamera.gameObject.cameraController.reset()
      },
    },
    separator: {},
  }
  for (const name in viewNames) {
    const checked = prefs.general.getProperty(name) as Mutable<boolean>
    viewData[name] = {
      name: Value.constant(viewNames[name]),
      checkable: Value.constant(true),
      checked,
      action: () => checked.update(!checked.current),
    }
  }
  const selectionData :ModelData = {
    fuse: {
      name: Value.constant("Fuse"),
      enabled: haveSelection,
      action: () => {
        // get the combined bounds of all components
        const firstId = selection.values().next().value
        const firstObject = gameEngine.gameObjects.require(firstId)
        const selector = firstObject.requireComponent<Selector>("selector")
        const bounds = selector.getGroupBounds()

        // merge the selection and all children
        const remove = new Set<string>()
        for (const id of selection) addSubtreeToSet(remove, id)

        // use the bounds center as the fused model position
        const center = Bounds.getCenter(vec3.create(), bounds)
        const encoder = new FusedEncoder()
        const tmpp = vec3.create()
        for (const id of remove) {
          const gameObject = gameEngine.gameObjects.require(id)
          const transform = gameObject.transform
          const fusedModels = gameObject.getComponent<FusedModels>("fusedModels")
          if (fusedModels) {
            encoder.addFusedTiles(
              fusedModels.encoded,
              vec3.subtract(tmpp, transform.position, center),
              transform.rotation,
              transform.lossyScale,
            )
          } else {
            const model = gameObject.getComponent<RenderModel>("model")
            if (model) {
              let flags = model.flags
              const tile = gameObject.getComponent<Tile>("tile")
              if (tile) {
                if (tile.walkable) flags |= WALKABLE_FLAG
                vec3.copy(bounds.min, tile.min)
                vec3.copy(bounds.max, tile.max)
              } else {
                flags |= NON_TILE_FLAG
                Bounds.copy(bounds, DefaultTileBounds)
              }
              vec3.subtract(tmpp, transform.position, center)
              for (const url of model.urls) {
                encoder.addTile(url, bounds, tmpp, transform.rotation, transform.lossyScale, flags)
              }
            }
          }
        }
        const fusedId = getUnusedName("fused")
        applyEdit({selection: new Set([fusedId]), remove, add: {
          [fusedId]: {
            isStatic: true,
            order: getNextPageOrder(),
            transform: {parentId: getPageParentId(), localPosition: center},
            fusedModels: {encoded: encoder.finish()},
            selector: {hideFlags: EDITOR_HIDE_FLAG},
          },
        }})
      },
    },
    explode: {
      name: Value.constant("Explode"),
      enabled: haveSelection,
      action: () => {
        const oldSelection = new Set(selection)
        const matrix = mat4.create()
        const add :SpaceConfig = {}
        const remove = new Set<string>()
        const newSelection = new Set<string>()
        const parentId = getPageParentId()
        let order = getNextPageOrder()
        for (const id of oldSelection) {
          addSubtreeToSet(remove, id)
          const gameObject = gameEngine.gameObjects.require(id)
          const transform = gameObject.transform
          const fusedModels = gameObject.getComponent<FusedModels>("fusedModels")
          if (fusedModels) {
            decodeFused(fusedModels.encoded, {
              visitTile: (url, bounds, position, rotation, scale, flags) => {
                mat4.fromRotationTranslationScale(matrix, rotation, position, scale)
                mat4.multiply(matrix, transform.localToWorldMatrix, matrix)
                const modelId = getUnusedName("tile", add)
                newSelection.add(modelId)
                const tileConfig :GameObjectConfig = {}
                if (!(flags & NON_TILE_FLAG)) {
                  tileConfig.tile = {
                    min: vec3.clone(bounds.min),
                    max: vec3.clone(bounds.max),
                    walkable: Boolean(flags & WALKABLE_FLAG),
                  }
                }
                add[modelId] = {
                  order: order++,
                  isStatic: true,
                  transform: {
                    parentId,
                    localPosition: mat4.getTranslation(vec3.create(), matrix),
                    localRotation: mat4.getRotation(quat.create(), matrix),
                    localScale: mat4.getScaling(vec3.create(), matrix),
                  },
                  model: {url, flags},
                  ...tileConfig,
                  selector: {hideFlags: EDITOR_HIDE_FLAG},
                }
              },
              visitFusedTiles: (source, position, rotation, scale) => {
                mat4.fromRotationTranslationScale(matrix, rotation, position, scale)
                mat4.multiply(matrix, transform.localToWorldMatrix, matrix)
                const fusedId = getUnusedName("fused", add)
                newSelection.add(fusedId)
                add[fusedId] = {
                  order: order++,
                  isStatic: true,
                  transform: {
                    parentId,
                    localPosition: mat4.getTranslation(vec3.create(), matrix),
                    localRotation: mat4.getRotation(quat.create(), matrix),
                    localScale: mat4.getScaling(vec3.create(), matrix),
                  },
                  fusedModels: {encoded: source},
                  selector: {hideFlags: EDITOR_HIDE_FLAG},
                }
              },
            })
          }
        }
        applyEdit({selection: newSelection, add, remove})
      },
    },
    separator: {},
    import: {
      name: Value.constant("Import..."),
      action: () => importConfig(config => {
        const position = getPointerWorldPosition(vec3.create(), true)
        pasteConfig(addSelectors(config), position, quatIdentity)
      }),
    },
    export: {
      name: Value.constant("Export..."),
      enabled: haveSelection,
      action: () => exportConfig(getSelectedConfig(Bounds.create(), ALL_HIDE_FLAGS_MASK)),
    },
    separator2: {},
    saveToCatalog: {
      name: Value.constant("Save to Catalog"),
      enabled: haveSelection,
      action: () => {
        const id = catalogRoot.addNewChild(getSelectedConfig(Bounds.create(), ALL_HIDE_FLAGS_MASK))
        activeTree.update("catalog")
        catalogSelection.clear()
        catalogSelection.add(id)
      },
    },
  }

  return new Model({
    menuBarModel: dataModel({
      space: {
        name: Value.constant("Space"),
        model: dataModel({
          new: {
            name: Value.constant("New Space"),
            action: menuActions.new,
            shortcut: Value.constant("new"),
          },
          ...openModel,
          separator1: {},
          ...saveModel,
          import: {
            name: Value.constant("Import..."),
            action: () => importConfig(loadConfig),
          },
          export: {
            name: Value.constant("Export..."),
            action: () => exportConfig(gameEngine.createConfig()),
          },
          exportAsJson: {
            name: Value.constant("Export as JSON..."),
            action: () => exportConfigAsJson(gameEngine.createConfig()),
          },
          ...quitModel,
        }),
      },
      edit: {
        name: Value.constant("Edit"),
        model: dataModel({
          undo: {
            name: Value.constant("Undo"),
            action: menuActions.undo,
            shortcut: Value.constant("undo"),
          },
          redo: {
            name: Value.constant("Redo"),
            action: menuActions.redo,
            shortcut: Value.constant("redo"),
          },
          separator1: {},
          cut: {
            name: Value.constant("Cut"),
            action: menuActions.cut,
            shortcut: Value.constant("cut"),
          },
          copy: {
            name: Value.constant("Copy"),
            action: menuActions.copy,
            shortcut: Value.constant("copy"),
          },
          paste: {
            name: Value.constant("Paste"),
            action: menuActions.paste,
            shortcut: Value.constant("paste"),
          },
          delete: {
            name: Value.constant("Delete"),
            action: menuActions.delete,
            shortcut: Value.constant("delete"),
          },
          separator2: {},
          selectAll: {
            name: Value.constant("Select All"),
            action: menuActions.selectAll,
            shortcut: Value.constant("selectAll"),
          },
          separator3: {},
          preferences: {
            name: Value.constant("Preferences..."),
            action: () => {
              const prefsRoot = ui.createRoot(
                createPrefsConfig(minSize),
                createPrefsModel(prefs, () => gameEngine.ctx.host.removeRoot(prefsRoot)),
              )
              gameEngine.ctx.host.addRoot(prefsRoot)
            },
          },
        }),
      },
      view: {
        name: Value.constant("View"),
        model: dataModel(viewData),
      },
      selection: {
        name: Value.constant("Selection"),
        model: dataModel(selectionData, prefs.general.getProperty("catalogFile").map(catalog => {
          let keys = Object.keys(selectionData)
          if (!catalog) keys = keys.filter(key => key.toLowerCase().indexOf("catalog") === -1)
          return keys
        })),
      },
      object: {
        name: Value.constant("Object"),
        model: dataModel({
          group: {
            name: Value.constant("Group"),
            action: () => createObject("group", {}),
          },
          light: {
            name: Value.constant("Light"),
            action: () => createObject("light", {light: {}}),
          },
          spawnPoint: {
            name: Value.constant("Spawn Point"),
            action: () => createObject("spawnPoint", {
              layerFlags: EDITOR_LAYER_FLAG,
              spawnPoint: {},
              meshFilter: {
                meshConfig: {type: "indicator"},
              },
              meshRenderer: {
                materialConfig: {type: "basic", color: Color.fromRGB(1, 0, 1)},
              },
              tile: {
                min: vec3.fromValues(-0.25, 0, -0.25),
                max: vec3.fromValues(0.25, 1, 0.25),
                walkable: true,
              },
            }),
          },
          model: {
            name: Value.constant("Model"),
            action: () => createObject("model", {model: {}, animation: {}}),
          },
          tile: {
            name: Value.constant("Tile"),
            action: () => createObject("tile", {isStatic: true, model: {}, tile: {}}),
          },
        }),
      },
      component: {
        name: Value.constant("Component"),
        model: componentTypesModel,
      },
    }),
    pagesModel: {
      keys: gameEngine.pages,
      resolve: (key :ModelKey) => {
        let model = models.get(key)
        if (!model) {
          const commonModelData :ModelData = {
            showStats: prefs.general.getProperty("showStats"),
            statsModel: makeModel(
              gameEngine.renderEngine.stats,
              stat => ({stat: Value.constant(stat)}),
            ),
            showCoords: prefs.general.getProperty("showCoords"),
            coords,
          }
          if (key === DEFAULT_PAGE) {
            models.set(key, model = new Model({
              id: Value.constant(DEFAULT_PAGE),
              name: Value.constant(DEFAULT_PAGE),
              removable: Value.constant(false),
              remove: Noop,
              ...commonModelData,
            }))
          } else {
            const gameObject = gameEngine.gameObjects.require(key as string)
            const createPropertyValue = createPropertyValueCreator(gameObject, applyEdit)
            models.set(key, model = new Model({
              id: Value.constant(key),
              name: createPropertyValue("name"),
              removable: Value.constant(true),
              remove: () => {
                const remove = new Set<string>()
                addSubtreeToSet(remove, key as string)
                applyEdit({remove})
              },
              ...commonModelData,
            }))
          }
        }
        return model
      },
    },
    activePage: gameEngine.activePage,
    createPage: () => {
      // find an unused id for a name, starting with "page2"
      let name = ""
      for (let ii = 2;; ii++) {
        const id = "page" + ii
        if (!gameEngine.gameObjects.has(id)) {
          name = id
          break
        }
      }
      const pages = gameEngine.pages.current
      const add :SpaceConfig = {
        [name]: {order: getOrder(pages[pages.length - 1]) + 1, page: {}},
      }
      const addPageObjects = (space :SpaceConfig) => {
        for (const key in space) {
          const objectConfig = JavaScript.clone(space[key])
          if (!objectConfig.transform) objectConfig.transform = {}
          objectConfig.transform.parentId = name
          add[getUnusedName(key, add)] = objectConfig
        }
      }
      addPageObjects(EditorObjects)
      addPageObjects(AutomaticObjects)
      applyEdit({activePage: name, add})
    },
    updateOrder: (key :string, index :number) => {
      const currentPageKeys = gameEngine.pages.current
      if (currentPageKeys.indexOf(key) === index) return
      const edit = {edit: {} as any}
      if (key === DEFAULT_PAGE) {
        // to reorder the default page, we adjust the order of everything around it
        let order = -1
        for (let ii = index - 1; ii >= 0; ii--) {
          const key = currentPageKeys[ii]
          if (key !== DEFAULT_PAGE) edit.edit[key] = {order: order--}
        }
        order = 1
        for (let ii = index; ii < currentPageKeys.length; ii++) {
          const key = currentPageKeys[ii]
          if (key !== DEFAULT_PAGE) edit.edit[key] = {order: order++}
        }
      } else {
        // to reorder an ordinary page, we change its order
        edit.edit[key] = {order: getNewOrder(currentPageKeys, index, getOrder)}
      }
      applyEdit(edit)
    },
    treeModel: dataModel({
      objects: {
        name: Value.constant("Objects"),
        key: Value.constant("objects"),
        rootModel: gameObjectModel(gameEngine.rootIds),
        selectedKeys: selection,
        updateParentOrder: (keys :ModelKey[], parent :ModelKey|undefined, index :number) => {
          const newExpanded = new Set(expanded)
          const edit :SpaceEditConfig = {}
          let parentId :string|undefined
          let childIds :string[]
          if (parent === undefined) {
            const activePage = gameEngine.activePage.current
            parentId = (activePage === DEFAULT_PAGE) ? undefined : activePage
            childIds = gameEngine.rootIds.current
          } else {
            parentId = parent as string
            childIds = gameEngine.gameObjects.require(parentId).transform.childIds.current
            newExpanded.add(parentId)
          }
          const orders = getNewOrders(filterGameObjectKeys(childIds), index, getOrder, keys.length)
          for (let ii = 0; ii < keys.length; ii++) {
            const id = keys[ii] as string
            const objectEdit :PMap<any> = edit[id] = {order: orders[ii]}
            const gameObject = gameEngine.gameObjects.require(id)
            if (gameObject.transform.parentId !== parentId) objectEdit.transform = {parentId}
          }
          applyEdit({expanded: newExpanded, edit})
        },
      },
      catalog: {
        name: Value.constant("Catalog"),
        key: Value.constant("catalog"),
        rootModel: catalogRoot.createElementsModel(),
        selectedKeys: catalogSelection,
        updateParentOrder: (keys :ModelKey[], parent :ModelKey|undefined, index :number) => {
          const newParent = (parent === undefined)
            ? catalogRoot
            : catalogNodes.require(parent as string)
          for (const key of keys) {
            const node = catalogNodes.require(key as string)
            const oldParent = catalogNodes.require(node.parentId)
            if (oldParent === newParent) {
              index = oldParent.moveChild(node.id, index)
            } else {
              oldParent.deleteChild(node.id)
              newParent.insertChild(node.id, index++)
              node.parentId = newParent.id
              newParent.expanded.update(true)
            }
          }
        },
      },
    }, prefs.general.getProperty<string>("catalogFile").map(catalog => {
      const keys = ["objects"]
      if (catalog) keys.push("catalog")
      return keys
    })),
    activeTree,
    gameObjectPropertiesModel: Property.makeModel(
      RMap.fromValue(selectionArray, selection => {
        if (selection.length === 0) return RMap.empty()
        return gameEngine.gameObjects.require(selection[0]).propertiesMeta
      }),
      (propertyName, metaValue) => {
        const property = selectionArray.switchMap(selection => {
          if (selection.length === 0) return Value.constant<unknown>(undefined)
          return gameEngine.gameObjects.require(selection[0]).getProperty(propertyName)
        })
        if (metaValue.current.constraints.readonly) return property
        return Mutable.deriveMutable(
          dispatch => property.onChange(dispatch),
          () => property.current,
          value => applyToSelection({[propertyName]: value}),
          refEquals,
        )
      }
    ),
    componentsModel: {
      keys: selectionArray.switchMap(selection => {
        if (selection.length === 0) return Value.constant<string[]>([])
        const getComponentTypes = (id :string) => {
          const gameObject = gameEngine.gameObjects.require(id)
          return Value
            .join2(showEditorObjects, gameObject.componentTypes)
            .map(() => filterComponentTypes(gameObject))
        }
        if (selection.length === 1) return getComponentTypes(selection[0])
        const values :Value<string[]>[] = []
        for (const id of selection) values.push(getComponentTypes(id))
        return Value.join(...values).map(componentTypes => {
          const merged :string[] = []
          typeLoop: for (const type of componentTypes[0]) {
            for (let ii = 1; ii < componentTypes.length; ii++) {
              if (componentTypes[ii].indexOf(type) === -1) continue typeLoop
            }
            merged.push(type)
          }
          return merged
        })
      }),
      resolve: (key :ModelKey) => {
        const componentType = key as string
        const id = selection.values().next().value
        const component = gameEngine.gameObjects.require(id).requireComponent(componentType)
        return new Model({
          type: Value.constant(key),
          removable: Value.constant(component.removable),
          remove: () => applyToSelection({[key]: undefined}),
          actionsModel: dataModel(key === "transform" ? {
            reset: {
              name: Value.constant("Reset"),
              action: () => applyToSelection({
                transform: {
                  localPosition: vec3.create(),
                  localRotation: quat.create(),
                  localScale: vec3.fromValues(1, 1, 1),
                },
              }),
            },
          } : {}),
          propertiesModel: Property.makeModel(
            component.propertiesMeta,
            (propertyName, metaValue) => {
              const property = component.getProperty(propertyName)
              if (metaValue.current.constraints.readonly) return property
              return Mutable.deriveMutable(
                dispatch => property.onChange(dispatch),
                () => property.current,
                value => applyToSelection({[componentType]: {[propertyName]: value}}),
                refEquals,
              )
            }
          ),
        })
      },
    },
    updateComponentOrder: (key :string, index :number) => {
      const gameObject = gameEngine.gameObjects.require(selectionArray.current[0])
      const types = filterComponentTypes(gameObject)
      if (types.indexOf(key) === index) return
      applyToSelection({
        [key]: {
          order: getNewOrder(types, index, type => gameObject.requireComponent(type).order),
        },
      })
    },
    haveSelection,
    componentTypeLabel: Value.constant("Add Component"),
    componentTypesModel,
    ...menuActions,
  })
}

const GRID_VERTEX_SHADER = `
  varying vec4 worldPosition;
  void main(void) {
    worldPosition = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const GRID_FRAGMENT_SHADER = `
  varying vec4 worldPosition;
  void main(void) {
    vec4 modPosition = mod(worldPosition.xzxz - vec4(0.5), vec4(vec2(1.0), vec2(0.25)));
    vec4 lowerSteps = step(vec4(vec2(0.02), vec2(0.005)), modPosition);
    vec4 upperSteps = vec4(1.0) - step(vec4(vec2(0.98), vec2(0.245)), modPosition);
    float outside = lowerSteps.x * lowerSteps.y * lowerSteps.z * lowerSteps.w *
      upperSteps.x * upperSteps.y * upperSteps.z * upperSteps.w;
    if (outside > 0.5) discard;
    float scale = 0.25 * exp(-0.1 * distance(worldPosition.xz, cameraPosition.xz));
    gl_FragColor = vec4(scale, scale, scale, 1.0);
  }
`

const AXIS_DIVISIONS = 8
const AXIS_VERTICES_LENGTH = 3 * AXIS_DIVISIONS * 2 * 3
const AxesMeshConfig = {
  type: "explicitGeometry",
  vertices: new Float32Array(AXIS_VERTICES_LENGTH),
  colors: new Float32Array(AXIS_VERTICES_LENGTH),
  triangles: new Uint16Array(AXIS_VERTICES_LENGTH + 3 * 2 * (AXIS_DIVISIONS - 2) * 3),
}
{
  let vidx = 0, tidx = 0, vertexCount = 0
  const vertex = vec3.create()
  for (let ii = 0; ii < 3; ii++) {
    const color = new Float32Array(3)
    color[ii] = 1
    const axisStart = vertexCount
    for (let jj = 0; jj < AXIS_DIVISIONS; jj++) {
      const angle = jj * Math.PI * 2 / AXIS_DIVISIONS

      vertex[ii] = 0
      vertex[(ii + 1) % 3] = 0.02 * Math.cos(angle)
      vertex[(ii + 2) % 3] = -0.02 * Math.sin(angle)

      AxesMeshConfig.colors.set(color, vidx)
      AxesMeshConfig.vertices.set(vertex, vidx)
      vidx += 3

      vertex[ii] = 0.5

      AxesMeshConfig.colors.set(color, vidx)
      AxesMeshConfig.vertices.set(vertex, vidx)
      vidx += 3

      const nextIdx = (jj === AXIS_DIVISIONS - 1) ? axisStart : vertexCount + 2

      AxesMeshConfig.triangles[tidx++] = vertexCount
      AxesMeshConfig.triangles[tidx++] = vertexCount + 1
      AxesMeshConfig.triangles[tidx++] = nextIdx + 1

      AxesMeshConfig.triangles[tidx++] = vertexCount
      AxesMeshConfig.triangles[tidx++] = nextIdx + 1
      AxesMeshConfig.triangles[tidx++] = nextIdx

      vertexCount += 2
    }

    for (let kk = 1; kk < AXIS_DIVISIONS - 1; kk++) {
      AxesMeshConfig.triangles[tidx++] = axisStart
      AxesMeshConfig.triangles[tidx++] = axisStart + kk * 2
      AxesMeshConfig.triangles[tidx++] = axisStart + (kk + 1) * 2
    }

    for (let kk = 1; kk < AXIS_DIVISIONS - 1; kk++) {
      AxesMeshConfig.triangles[tidx++] = axisStart + 1
      AxesMeshConfig.triangles[tidx++] = axisStart + 1 + (kk + 1) * 2
      AxesMeshConfig.triangles[tidx++] = axisStart + 1 + kk * 2
    }
  }
}

const EditorObjects :SpaceConfig = {
  editorCamera: {
    layerFlags: CAMERA_LAYER_FLAG,
    hideFlags: EDITOR_HIDE_FLAG,
    transform: {
      localPosition: vec3.fromValues(0, 5, 5),
      localRotation: quat.fromEuler(quat.create(), -45, 0, 0),
    },
    camera: {},
    cameraController: {},
  },
  editorGrid: {
    tag: "editorGrid",
    order: 1,
    layerFlags: NONINTERACTIVE_LAYER_FLAG,
    hideFlags: EDITOR_HIDE_FLAG,
    transform: {
      localRotation: quat.fromEuler(quat.create(), -90, 0, 0),
      localScale: vec3.fromValues(1000, 1000, 1000),
    },
    meshFilter: {
      meshConfig: {type: "quad"},
    },
    meshRenderer: {
      materialConfig: {
        type: "shader",
        side: "both",
        vertexShader: GRID_VERTEX_SHADER,
        fragmentShader: GRID_FRAGMENT_SHADER,
      },
    },
  },
  editorWalkableAreas: {
    tag: "walkableAreas",
    order: 2,
    layerFlags: NONINTERACTIVE_LAYER_FLAG,
    hideFlags: EDITOR_HIDE_FLAG,
    meshFilter: {
      meshConfig: {type: "explicitGeometry"},
    },
    meshRenderer: {
      materialConfig: {
        type: "basic",
        side: "double",
        transparent: true,
        opacity: 0.5,
        vertexColors: true,
      },
    },
    walkableAreas: {},
  },
  editorAxes: {
    tag: "axes",
    order: 3,
    layerFlags: NONINTERACTIVE_LAYER_FLAG,
    hideFlags: EDITOR_HIDE_FLAG,
    meshFilter: {meshConfig: AxesMeshConfig},
    meshRenderer: {
      materialConfig: {type: "basic", vertexColors: true},
    },
    axes: {},
  },
}

const AutomaticObjects :SpaceConfig = {
  ambient: {
    order: 2,
    light: {intensity: 2},
  },
  directional: {
    order: 3,
    light: {lightType: "directional", intensity: 2},
    transform: {localPosition: vec3.fromValues(1, 1, 1)},
  },
}

function getNewOrder (keys :string[], index :number, getOrder :(key :string) => number) :number {
  return getNewOrders(keys, index, getOrder, 1)[0]
}

function getNewOrders (
  keys :string[],
  index :number,
  getOrder :(key :string) => number,
  count :number,
) :number[] {
  if (keys.length === 0) return createOrderRange(0, count)
  switch (index) {
    case 0: return createOrderRange(getOrder(keys[0]) - count, count)
    case keys.length: return createOrderRange(getOrder(keys[keys.length - 1]) + 1, count)
    default:
      const after = getOrder(keys[index - 1])
      const before = getOrder(keys[index])
      const step = (before - after) / (count + 1)
      return createOrderRange(after + step, count, step)
  }
}

function createOrderRange (start :number, count :number, step = 1) :number[] {
  const orders :number[] = []
  for (let ii = 0; ii < count; ii++) orders.push(start + ii * step)
  return orders
}

function setIdSet (set :MutableSet<string>, newSet :ReadonlySet<string>) {
  // remove anything not in the new set
  for (const id of set) {
    if (!newSet.has(id)) set.delete(id)
  }
  // add anything not in the old set
  for (const id of newSet) set.add(id)
}

function mergeEdits (first :PMap<any>, second :PMap<any>) {
  for (const key in second) {
    first[key] = second[key]
  }
}

function createGameObjectEditor (gameEngine :GameEngine, models :Map<ModelKey, Model>) {
  return (edit :GameObjectEdit) => {
    const reverseAdd :SpaceConfig = {}
    const reverseEdit :SpaceEditConfig = {}
    const reverseRemove = new Set<string>()
    if (edit.remove) {
      for (const id of edit.remove) {
        selection.delete(id)
        const gameObject = gameEngine.gameObjects.require(id)
        reverseAdd[id] = gameObject.createConfig(NO_HIDE_FLAGS_MASK)
        gameObject.dispose()
        models.delete(id)
      }
    }
    if (edit.add) {
      // first create, then configure (in case properties depend on other objects)
      for (const id in edit.add) {
        const addConfig = edit.add[id]
        const config :GameObjectConfig = {}
        for (const key in addConfig) {
          const value = addConfig[key]
          config[key] = (typeof value === "object") ? {} : value
        }
        gameEngine.createGameObject(id, config, true)
        reverseRemove.add(id)
      }
      for (const id in edit.add) {
        const gameObject = gameEngine.gameObjects.require(id)
        const addConfig = edit.add[id]
        for (const key in addConfig) {
          const component = gameObject.getComponent(key)
          if (component) {
            const componentAddConfig = addConfig[key]
            for (const key in componentAddConfig) {
              const property = component.getProperty(key) as Mutable<any>
              property.update(componentAddConfig[key])
            }
          }
        }
      }
    }
    if (edit.edit) {
      for (const id in edit.edit) {
        const gameObject = gameEngine.gameObjects.require(id)
        const editConfig = edit.edit[id]
        const reverseConfig :PMap<any> = {}
        for (const key in editConfig) {
          const component = gameObject.getComponent(key)
          if (component) {
            const componentEditConfig = editConfig[key]
            if (componentEditConfig) {
              const reverseComponentConfig :PMap<any> = {}
              reverseConfig[key] = reverseComponentConfig
              for (const key in componentEditConfig) {
                const property = component.getProperty(key) as Mutable<any>
                const currentValue = property.current
                reverseComponentConfig[key] = JavaScript.clone(currentValue)
                const newValue = componentEditConfig[key]
                property.update(newValue)
              }
            } else {
              reverseConfig[key] = component.createConfig()
              component.dispose()
            }
          } else {
            const value = gameObject[key]
            if (value === undefined) {
              reverseConfig[key] = undefined
              gameObject.addComponent(key, editConfig[key])
            } else {
              const property = gameObject.getProperty(key) as Mutable<any>
              const currentValue = property.current
              reverseConfig[key] = JavaScript.clone(currentValue)
              const newValue = editConfig[key]
              property.update(newValue)
            }
          }
        }
        reverseEdit[id] = reverseConfig
      }
    }
    return {add: reverseAdd, edit: reverseEdit, remove: reverseRemove} as FullGameObjectEdit
  }
}

function createPropertyValueCreator (
  gameObject :GameObject,
  applyEdit :(edit :GameObjectEdit) => void,
) {
  return (key :ModelKey, defaultValue? :Value<any>) => {
    const property = gameObject.getProperty(key as string)
    return Mutable.deriveMutable(
      dispatch => property.onChange(dispatch),
      () => getValue(property.current, defaultValue && defaultValue.current),
      input => {
        applyEdit({
          edit: {
            [gameObject.id]: {[key]: input},
          },
        })
      },
      refEquals,
    )
  }
}

function createPrefsModel (prefs :Preferences, close :Action) {
  const activeCategory = Mutable.local("general")
  return new Model({
    title: Value.constant("Preferences"),
    close,
    activeCategory,
    prefsCategoryModel: makeModel(Value.constant(Object.keys(prefs)), key => {
      const category = prefs[key]
      return {
        key: Value.constant(key),
        name: Value.constant(category.title),
        propertiesModel: Property.makeModel(
          category.propertiesMeta,
          propertyName => category.getProperty(propertyName),
        ),
      }
    })
  })
}
