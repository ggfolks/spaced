import {refEquals} from "tfw/core/data"
import {Bounds, dim2, mat4, quat, vec2, vec3} from "tfw/core/math"
import {Emitter, Mutable, Value} from "tfw/core/react"
import {MutableSet} from "tfw/core/rcollect"
import {Disposable, Disposer, Noop, PMap, getValue} from "tfw/core/util"
import {CategoryNode} from "tfw/graph/node"
import {
  ALL_HIDE_FLAGS_MASK, DEFAULT_PAGE, NO_HIDE_FLAGS_MASK,
  GameEngine, GameObject, GameObjectConfig, SpaceConfig, Tile,
} from "tfw/engine/game"
import {Model as RenderModel, FusedModels} from "tfw/engine/render"
import {WALKABLE_FLAG, FusedEncoder, JavaScript, decodeFused} from "tfw/engine/util"
import {MOUSE_ID} from "tfw/input/hand"
import {getCurrentEditNumber} from "tfw/ui/element"
import {
  Action, Command, Model, ModelData, ModelKey, ElementsModel, dataModel, makeModel, mapModel,
} from "tfw/ui/model"
import {Property} from "tfw/ui/property"
import {UI} from "tfw/ui/ui"

import {createPrefsConfig} from "./config"
import {CameraController, Selector, maybeGetSnapCenter} from "../components"
import {Preferences} from "../prefs"

export const OUTLINE_LAYER = 1
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
  children :CatalogNodeConfig[]
}

const catalogNodes = new Map<number, CatalogNode>()
const catalogSelection = MutableSet.local<number>()
const catalogChanged = new Emitter<void>()
const emitCatalogChanged = () => catalogChanged.emit()

let nextCatalogNodeId = 0

class CatalogNode implements Disposable {
  readonly id = nextCatalogNodeId++
  parentId = 0
  readonly name = Mutable.local("")
  readonly objects = Mutable.local<SpaceConfig>({})
  readonly childIds = Mutable.local<number[]>([])
  readonly expanded = Mutable.local(false)

  private _disposer = new Disposer()

  constructor () {
    catalogNodes.set(this.id, this)
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

  createElementsModel () :ElementsModel<number> {
    return {
      keys: this.childIds,
      resolve: childId => catalogNodes.get(childId)!.createModel(),
    }
  }

  createConfig () :CatalogNodeConfig {
    return {
      name: this.name.current,
      objects: this.objects.current,
      children: this.childIds.current.map(childId => catalogNodes.get(childId)!.createConfig()),
    }
  }

  addNewChild (objects :SpaceConfig) :number {
    const node = new CatalogNode()
    node.parentId = this.id
    node.name.update("entry")
    node.objects.update(objects)
    this.insertChild(node.id, this.childIds.current.length)
    return node.id
  }

  insertChild (id :number, index :number) {
    const childIds = this.childIds.current.slice()
    childIds.splice(index, 0, id)
    this.childIds.update(childIds)
  }

  deleteChild (id :number) {
    const childIds = this.childIds.current.slice()
    childIds.splice(childIds.indexOf(id), 1)
    this.childIds.update(childIds)
  }

  moveChild (id :number, index :number) {
    const oldIndex = this.childIds.current.indexOf(id)
    if (oldIndex === index) return
    const childIds = this.childIds.current.slice()
    childIds.splice(oldIndex, 1)
    childIds.splice(index < oldIndex ? index : index - 1, 0, id)
    this.childIds.update(childIds)
  }

  dispose () {
    for (const childId of this.childIds.current) catalogNodes.get(childId)!.dispose()
    catalogNodes.get(this.parentId)!.deleteChild(this.id)
    catalogSelection.delete(this.id)
    catalogNodes.delete(this.id)
    this._disposer.dispose()
  }
}

const catalogRoot = new CatalogNode()

function clearCatalog () {
  for (const node of catalogNodes.values()) {
    if (node !== catalogRoot) node.dispose()
  }
}

export function createUIModel (minSize :Value<dim2>, gameEngine :GameEngine, ui :UI) {
  const getOrder = (id :string) => {
    if (id === DEFAULT_PAGE) return 0
    return gameEngine.gameObjects.require(id).order
  }
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
  const createNewSpace = () => {
    path.update("")
    resetModel()
    gameEngine.createGameObjects(AutomaticObjects)
  }
  createNewSpace()
  const addSelectors = (config: SpaceConfig) => {
    for (const id in config) config[id].selector = {hideFlags: EDITOR_HIDE_FLAG}
    return config
  }
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
  const prefs = new Preferences(gameEngine)
  const showEditorObjects = prefs.general.getProperty("showEditorObjects") as Mutable<boolean>
  const showStats = prefs.general.getProperty("showStats") as Mutable<boolean>
  const showCoords = prefs.general.getProperty("showCoords") as Mutable<boolean>
  const activeTree = Mutable.local("objects")
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
            hasChildren: gameObject.transform.childIds.map(childIds => childIds.length > 0),
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
      addSubtreeToConfig(config, childId)
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
  const pasteConfig = (config :SpaceConfig, center :boolean, bounds? :Bounds) => {
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
    const newCenter = getPointerWorldPosition(vec3.create(), center)
    if (bounds) maybeGetSnapCenter(newCenter, bounds)
    for (const id in config) {
      const newId = newIds.get(id)!
      selection.add(newId)
      const newConfig = replaceIds(config[id])
      if (!(newConfig.transform && newConfig.transform.parentId)) {
        if (!newConfig.transform) newConfig.transform = {}
        if (newConfig.transform.localPosition) {
          newConfig.transform.localPosition =
            vec3.add(vec3.create(), newConfig.transform.localPosition, newCenter)
        } else {
          newConfig.transform.localPosition = vec3.clone(newCenter)
        }
        newConfig.transform.parentId = pageParentId
        newConfig.order = nextPageOrder++
      }
      add[newId] = newConfig
    }
    applyEdit({selection, add})
  }
  const pasteFromClipboard = () => pasteConfig(clipboard.current!, false, clipboardBounds)
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
  const statsModel = makeModel(
    gameEngine.renderEngine.stats,
    stat => ({stat: Value.constant(stat)}),
  )
  const coords = Mutable.local("")
  const coordPos = vec3.create()
  gameEngine.addUpdatable({
    update: () => {
      getPointerWorldPosition(coordPos)
      vec3.round(coordPos, coordPos)
      coords.update(`${coordPos[0]} ${coordPos[1]} ${coordPos[2]}`)
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
  let readFrom :(path :string, onLoad :(config :SpaceConfig) => void) => void = Noop
  const loadFrom = (path :string) => readFrom(path, loadConfig)
  let importConfig = (onLoad :(config :SpaceConfig) => void) => {
    const input = document.createElement("input")
    input.setAttribute("type", "file")
    input.setAttribute("accept", "application/javascript")
    input.addEventListener("change", event => {
      if (!input.files || input.files.length === 0) return
      const reader = new FileReader()
      reader.onload = () => {
        onLoad(JavaScript.parse(reader.result as string) as SpaceConfig)
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

  prefs.general.getProperty<string>("catalog").onValue(async url => {
    clearCatalog()
    if (!url) return
    const loadCatalogNode = (node :CatalogNode, config :CatalogNodeConfig) => {
      node.name.update(config.name)
      node.objects.update(config.objects)
      node.childIds.update(
        config.children.map(config => loadCatalogNode(new CatalogNode(), config).id),
      )
      return node
    }
    let rootConfig :CatalogNodeConfig|undefined
    try {
      rootConfig = await JavaScript.loadUncached(url) as CatalogNodeConfig
    } catch (error) {
      // ignore; assume we haven't saved the catalog yet
    }
    if (rootConfig) loadCatalogNode(catalogRoot, rootConfig)
  })

  let catalogTimeout :number|undefined
  const maybeSaveCatalog = (callback? :() => void) => {
    if (catalogTimeout !== undefined) {
      window.clearTimeout(catalogTimeout)
      catalogTimeout = undefined
      const url = prefs.general.catalog
      if (url) {
        writeTo(catalogRoot.createConfig(), prefs.general.normalizedRoot + url, callback)
        return
      }
    }
    if (callback) callback()
  }
  catalogChanged.onEmit(() => {
    if (catalogTimeout !== undefined) window.clearTimeout(catalogTimeout)
    catalogTimeout = window.setTimeout(maybeSaveCatalog, 5000)
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
        else onLoad(JavaScript.parse(data) as SpaceConfig)
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
    confirmRemoveFromCatalog = async () => {
      const result = await electron.dialog.showMessageBox(
        electron.getCurrentWindow(),
        {
          type: "question",
          buttons: ["Cancel", "Remove"],
          defaultId: 1,
          title: "Confirm Remove",
          message: "Are you sure you want to remove this entry from the catalog?",
        },
      )
      if (!result) return
      for (const id of catalogSelection) catalogNodes.get(id)!.dispose()
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
        if (activeTree.current !== "catalog" || catalogSelection.size === 0) removeSelected()
        else confirmRemoveFromCatalog()
      },
      Value
        .join3(haveSelection, catalogSelection.sizeValue, activeTree)
        .map(([haveSelection, catalogSelectionSize, activeTree]) => {
          return haveSelection || (catalogSelectionSize > 0 && activeTree === "catalog")
        }),
    ),
    selectAll: () => {
      const set = new Set<string>()
      for (const rootId of gameEngine.rootIds.current) addSubtreeToSet(set, rootId)
      setIdSet(selection, set)
    },
    raiseGrid: () => {
      const activeCamera = gameEngine.renderEngine.activeCameras[0]
      if (activeCamera) activeCamera.gameObject.cameraController.raise(1)
    },
    lowerGrid: () => {
      const activeCamera = gameEngine.renderEngine.activeCameras[0]
      if (activeCamera) activeCamera.gameObject.cameraController.raise(-1)
    },
  }

  const viewNames :PMap<string> = {
    showEditorObjects: "Editor Objects",
    showStats: "Stats",
    showCoords: "Coords",
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
          const model = gameObject.getComponent<RenderModel>("model")
          if (model) {
            const tile = gameObject.getComponent<Tile>("tile")
            let flags = 0
            if (tile) {
              if (tile.walkable) flags |= WALKABLE_FLAG
              vec3.copy(bounds.min, tile.min)
              vec3.copy(bounds.max, tile.max)
            } else {
              Bounds.copy(bounds, model.bounds)
              Bounds.transformMat4(bounds, bounds, transform.worldToLocalMatrix)
            }
            encoder.addTile(
              model.url,
              bounds,
              vec3.subtract(tmpp, transform.position, center),
              transform.rotation,
              transform.lossyScale,
              flags,
            )
          }
          const fusedModels = gameObject.getComponent<FusedModels>("fusedModels")
          if (fusedModels) {
            encoder.addFusedTiles(
              fusedModels.encoded,
              vec3.subtract(tmpp, transform.position, center),
              transform.rotation,
              transform.lossyScale,
            )
          }
        }
        const fusedId = getUnusedName("fused")
        applyEdit({selection: new Set([fusedId]), remove, add: {
          [fusedId]: {
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
                add[modelId] = {
                  order: order++,
                  transform: {
                    parentId,
                    localPosition: mat4.getTranslation(vec3.create(), matrix),
                    localRotation: mat4.getRotation(quat.create(), matrix),
                    localScale: mat4.getScaling(vec3.create(), matrix),
                  },
                  model: {url},
                  tile: {
                    min: vec3.clone(bounds.min),
                    max: vec3.clone(bounds.max),
                    walkable: Boolean(flags & WALKABLE_FLAG),
                  },
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
      action: () => importConfig(config => pasteConfig(addSelectors(config), true)),
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
        activeTree.update("catalog")
        const id = catalogRoot.addNewChild(getSelectedConfig(Bounds.create(), ALL_HIDE_FLAGS_MASK))
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
        model: dataModel(selectionData, prefs.general.getProperty("catalog").map(catalog => {
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
          model: {
            name: Value.constant("Model"),
            action: () => createObject("model", {model: {}, animation: {}}),
          },
          tile: {
            name: Value.constant("Tile"),
            action: () => createObject("tile", {model: {}, tile: {}}),
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
            showStats,
            statsModel,
            showCoords,
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
        updateParentOrder: (key :ModelKey, parent :ModelKey|undefined, index :number) => {
          const gameObject = gameEngine.gameObjects.require(key as string)
          const activePage = gameEngine.activePage.current
          let parentId :string|undefined
          let childIds :string[]
          let newExpanded = new Set(expanded)
          if (parent === undefined) {
            parentId = (activePage === DEFAULT_PAGE) ? undefined : activePage
            childIds = gameEngine.rootIds.current
          } else {
            parentId = parent as string
            childIds = gameEngine.gameObjects.require(parentId).transform.childIds.current
            newExpanded.add(parentId)
          }
          const edit :PMap<any> = {}
          if (parentId !== gameObject.transform.parentId) edit.transform = {parentId}
          childIds = filterGameObjectKeys(childIds)
          if (childIds.indexOf(key as string) !== index) {
            edit.order = getNewOrder(childIds, index, getOrder)
          }
          applyEdit({expanded: newExpanded, edit: {[key]: edit}})
        },
      },
      catalog: {
        name: Value.constant("Catalog"),
        key: Value.constant("catalog"),
        rootModel: catalogRoot.createElementsModel(),
        selectedKeys: catalogSelection,
        updateParentOrder: (key :ModelKey, parent :ModelKey|undefined, index :number) => {
          const node = catalogNodes.get(key as number)!
          const oldParent = catalogNodes.get(node.parentId)!
          const newParent = (parent === undefined)
            ? catalogRoot
            : catalogNodes.get(parent as number)!
          if (oldParent === newParent) {
            oldParent.moveChild(node.id, index)
          } else {
            oldParent.deleteChild(node.id)
            newParent.insertChild(node.id, index)
            node.parentId = newParent.id
            newParent.expanded.update(true)
          }
        },
      },
    }, prefs.general.getProperty<string>("catalog").map(catalog => {
      const keys = ["objects"]
      if (catalog) keys.push("catalog")
      return keys
    })),
    activeTree,
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
        vertexShaderGraphConfig: {},
        fragmentShaderGraphConfig: {},
      },
    },
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
  if (keys.length === 0) return 0
  switch (index) {
    case 0:
      return getOrder(keys[0]) - 1
    case keys.length:
      return getOrder(keys[keys.length - 1]) + 1
    default:
      return (getOrder(keys[index - 1]) + getOrder(keys[index])) / 2
  }
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
