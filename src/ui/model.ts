import {refEquals} from "tfw/core/data"
import {Bounds, dim2, quat, vec2, vec3} from "tfw/core/math"
import {Mutable, Value} from "tfw/core/react"
import {MutableSet} from "tfw/core/rcollect"
import {Noop, PMap, getValue} from "tfw/core/util"
import {CategoryNode} from "tfw/graph/node"
import {
  DEFAULT_PAGE, GameEngine, GameObject, GameObjectConfig, PrimitiveTypes, SpaceConfig,
} from "tfw/engine/game"
import {JavaScript} from "tfw/engine/util"
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
  activePage? :string
  selection? :Set<string>
  expanded? :Set<string>
  add? :SpaceConfig
  edit? :SpaceEditConfig
  remove? :Set<string>
}

interface FullGameObjectEdit extends GameObjectEdit {
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
  const haveSelection = selection.fold(false, (value, set) => set.size > 0)
  const selectionArray = selection.fold<string[]>([], (value, set) => Array.from(set))
  const clipboard = Mutable.local<SpaceConfig|undefined>(undefined)
  const expanded = MutableSet.local<string>()
  const canUndo = Mutable.local(false)
  const canRedo = Mutable.local(false)
  const undoStack :FullGameObjectEdit[] = []
  const redoStack :FullGameObjectEdit[] = []
  const automaticObjects = createAutomaticObjects(gameEngine)
  let currentVersion = 0
  const resetModel = () => {
    activeVersion.update(currentVersion)
    savedVersion.update(currentVersion)
    expanded.clear()
    selection.clear()
    undoStack.length = 0
    redoStack.length = 0
    gameEngine.disposeGameObjects()
    gameEngine.createGameObjects(automaticObjects)
  }
  resetModel()
  const loadConfig = (config :SpaceConfig) => {
    resetModel()
    for (const id in config) config[id].selector = {hideFlags: EDITOR_HIDE_FLAG}
    gameEngine.createGameObjects(config, true)
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
        if (!lastEdit.add[id]) {
          lastEdit.remove.add(id)
        }
      }
    } else {
      reverseEdit.editNumber = currentEditNumber
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
  function gameObjectModel (keys :Value<string[]>) :ElementsModel<string> {
    return {
      keys: Value.join2(keys, showEditorObjects).map(([keys, showEditorObjects]) => {
        if (showEditorObjects) return keys
        return keys.filter(
          key => !(gameEngine.gameObjects.require(key).hideFlags & EDITOR_HIDE_FLAG),
        )
      }),
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
  const getUnusedName = (base :string) => {
    let name = base
    for (let ii = 2; gameEngine.gameObjects.has(name); ii++) name = base + ii
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
  const createObject = (type :string, config :GameObjectConfig) => {
    const name = getUnusedName(type)
    const parentId = getPageParentId()
    if (parentId !== undefined) config.transform = {parentId}
    config.order = getNextPageOrder()
    config.selector = {hideFlags: EDITOR_HIDE_FLAG}
    applyEdit({selection: new Set([name]), add: {[name]: config}})
  }
  const addSubtreeToConfig = (config :SpaceConfig, rootId :string) => {
    if (config[rootId]) return
    const gameObject = gameEngine.gameObjects.require(rootId)
    config[rootId] = gameObject.createConfig()
    for (const childId of gameObject.transform.childIds.current) {
      addSubtreeToConfig(config, childId)
    }
  }
  const clipboardOffsets = new Map<string, vec3>()
  const clipboardBounds = Bounds.create()
  const copySelected = () => {
    clipboardOffsets.clear()
    const config :SpaceConfig = {}
    const firstId = selection.values().next().value
    const selector = gameEngine.gameObjects.require(firstId).requireComponent<Selector>("selector")
    selector.getGroupBounds(clipboardBounds)
    const center = Bounds.getCenter(vec3.create(), clipboardBounds)
    center[1] = 0
    for (const id of selection) {
      addSubtreeToConfig(config, id)
      const transform = gameEngine.gameObjects.require(id).transform
      if (!(transform.parentId && selection.has(transform.parentId))) {
        clipboardOffsets.set(id, vec3.subtract(vec3.create(), transform.position, center))
      }
    }
    clipboard.update(config)
  }
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
  const pasteFromClipboard = () => {
    const add :SpaceConfig = {}
    const configs = clipboard.current
    const newIds = new Map<string, string>()
    for (const id in configs) newIds.set(id, getUnusedName(id))
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
    const newCenter = vec3.create()
    const camera = gameEngine.renderEngine.activeCameras[0]
    if (camera) {
      const cameraController = camera.getComponent<CameraController>("cameraController")
      if (cameraController) {
        const pointer = gameEngine.ctx.hand!.pointers.get(MOUSE_ID)
        const ray = pointer
          ? camera.screenPointToRay(pointer.position)
          : camera.viewportPointToRay(vec2.fromValues(0.5, 0.5))
        cameraController.getRayXZPlaneIntersection(ray, newCenter)
      }
    }
    maybeGetSnapCenter(newCenter, clipboardBounds)
    for (const id in configs) {
      const newId = newIds.get(id)!
      selection.add(newId)
      const newConfig = replaceIds(configs[id])
      if (!(newConfig.transform && newConfig.transform.parentId)) {
        if (!newConfig.transform) newConfig.transform = {}
        newConfig.transform.position = vec3.add(vec3.create(), newCenter, clipboardOffsets.get(id)!)
        newConfig.transform.parentId = pageParentId
        newConfig.order = nextPageOrder++
      }
      newConfig.selector = {hideFlags: EDITOR_HIDE_FLAG}
      add[newId] = newConfig
    }
    applyEdit({selection, add})
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
  const statsModel = makeModel(
    gameEngine.renderEngine.stats,
    stat => ({stat: Value.constant(stat)}),
  )

  let electronActions :PMap<Command> = {}
  let openModel :ModelData = {}
  let saveModel :ModelData = {}
  let quitModel :ModelData = {}
  const filters = [
    {name: "Spaces", extensions: ["space.js"]},
    {name: "All Files", extensions: ["*"]},
  ]
  let saveTo :(path :string) => void = Noop
  const createSpaceConfigString = () => JavaScript.stringify(gameEngine.createConfig())
  let loadFrom :(path :string) => void = Noop
  if (window.require) {
    const fs = window.require("fs")
    saveTo = path => {
      fs.writeFile(path, createSpaceConfigString(), (error? :Error) => {
        if (error) console.warn(error)
      })
    }
    loadFrom = path => {
      fs.readFile(path, "utf8", (error :Error|undefined, data :string) => {
        if (error) console.warn(error)
        else loadConfig(JavaScript.parse(data))
      })
    }
    const save = () => {
      saveTo(path.current)
      savedVersion.update(activeVersion.current)
    }
    const saveAs = async () => {
      const result = await electron.dialog.showSaveDialog(
        electron.getCurrentWindow(),
        {
          title: "Save As",
          defaultPath: path.current || prefs.general.normalizedRoot + getPathName(),
          buttonLabel: "Save",
          properties: ["openFile", "promptToCreate"],
          filters,
        },
      )
      if (result.filePath) {
        path.update(result.filePath)
        save()
      }
    }
    electronActions = {
      open: new Command(async () => {
        const result = await electron.dialog.showOpenDialog(
          electron.getCurrentWindow(),
          {
            title: "Open Space",
            defaultPath: path.current || prefs.general.rootDirectory,
            buttonLabel: "Open",
            properties: ["openFile"],
            filters,
          },
        )
        if (result.filePaths.length > 0) {
          path.update(result.filePaths[0])
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
        electron.process.exit()
      }),
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
    new: new Command(() => {
      path.update("")
      resetModel()
    }),
    ...electronActions,
    undo: new Command(() => {
      const oldSelection = new Set(selection)
      const oldExpanded = new Set(expanded)
      const edit = undoStack.pop()!
      gameEngine.activePage.update(edit.activePage)
      const reverseEdit = pageEditor(edit)
      setIdSet(selection, edit.selection)
      setIdSet(expanded, edit.expanded)
      reverseEdit.activePage = edit.activePage
      reverseEdit.selection = oldSelection
      reverseEdit.expanded = oldExpanded
      redoStack.push(reverseEdit)
      canRedo.update(true)
      canUndo.update(undoStack.length > 0)
      activeVersion.update(activeVersion.current - 1)
    }, canUndo),
    redo: new Command(() => {
      const oldSelection = new Set(selection)
      const oldExpanded = new Set(expanded)
      const edit = redoStack.pop()!
      gameEngine.activePage.update(edit.activePage)
      const reverseEdit = pageEditor(edit)
      setIdSet(selection, edit.selection)
      setIdSet(expanded, edit.expanded)
      reverseEdit.activePage = edit.activePage
      reverseEdit.selection = oldSelection
      reverseEdit.expanded = oldExpanded
      undoStack.push(reverseEdit)
      canUndo.update(true)
      canRedo.update(redoStack.length > 0)
      activeVersion.update(activeVersion.current + 1)
    }, canRedo),
    cut: new Command(() => {
      copySelected()
      removeSelected()
    }, haveSelection),
    copy: new Command(copySelected, haveSelection),
    paste: new Command(pasteFromClipboard, clipboard.map(Boolean)),
    delete: new Command(removeSelected, haveSelection),
    selectAll: () => {
      const set = new Set<string>()
      for (const rootId of gameEngine.rootIds.current) addSubtreeToSet(set, rootId)
      setIdSet(selection, set)
    },
  }

  const viewNames :PMap<string> = {
    showEditorObjects: "Editor Objects",
    showStats: "Stats",
  }
  const viewData :ModelData = {
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
            action: electron ? async () => {
              const result = await electron.dialog.showOpenDialog(
                electron.getCurrentWindow(),
                {
                  title: "Import",
                  defaultPath: path.current,
                  buttonLabel: "Import",
                  properties: ["openFile"],
                  filters,
                },
              )
              if (result.filePaths.length > 0) loadFrom(result.filePaths[0])
            } : () => {
              const input = document.createElement("input")
              input.setAttribute("type", "file")
              input.setAttribute("accept", "application/javascript")
              input.addEventListener("change", event => {
                if (!input.files || input.files.length === 0) return
                const reader = new FileReader()
                reader.onload = () => {
                  loadConfig(JavaScript.parse(reader.result as string))
                }
                reader.readAsText(input.files[0])
              })
              input.click()
            },
          },
          export: {
            name: Value.constant("Export..."),
            action: electron ? async () => {
              const result = await electron.dialog.showSaveDialog(
                electron.getCurrentWindow(),
                {
                  title: "Export",
                  defaultPath: path.current,
                  buttonLabel: "Export",
                  properties: ["openFile", "promptToCreate"],
                  filters,
                },
              )
              if (result.filePath) saveTo(result.filePath)
            } : () => {
              const file = new File(
                [createSpaceConfigString()],
                "untitled.space.js",
                {type: "application/octet-stream"},
              )
              open(URL.createObjectURL(file), "_self")
              // TODO: call revokeObjectURL when finished with download
            },
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
      object: {
        name: Value.constant("Object"),
        model: dataModel({
          group: {
            name: Value.constant("Group"),
            action: () => createObject("group", {}),
          },
          camera: {
            name: Value.constant("Camera"),
            action: () => createObject("camera", {camera: {}}),
          },
          light: {
            name: Value.constant("Light"),
            action: () => createObject("light", {light: {}}),
          },
          model: {
            name: Value.constant("Model"),
            action: () => createObject("model", {model: {}}),
          },
          primitive: {
            name: Value.constant("Primitive"),
            submenu: Value.constant(true),
            model: makeModel(
              Value.constant(PrimitiveTypes),
              type => ({
                name: Value.constant(type),
                action: () => createObject(
                  type,
                  {
                    meshFilter: {meshConfig: {type}},
                    meshRenderer: {materialConfig: {type: "standard"}},
                  },
                ),
              }),
            ),
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
          if (key === DEFAULT_PAGE) {
            models.set(key, model = new Model({
              id: Value.constant(DEFAULT_PAGE),
              name: Value.constant(DEFAULT_PAGE),
              removable: Value.constant(false),
              remove: Noop,
              showStats,
              statsModel,
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
              showStats,
              statsModel,
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
      const pageAutomaticObjects :SpaceConfig = {}
      for (const key in automaticObjects) {
        const objectConfig = JavaScript.clone(automaticObjects[key])
        if (!objectConfig.transform) objectConfig.transform = {}
        objectConfig.transform.parentId = name
        pageAutomaticObjects[getUnusedName(key)] = objectConfig
      }
      applyEdit({
        activePage: name,
        add: {
          [name]: {order: getOrder(pages[pages.length - 1]) + 1, page: {}},
          ...pageAutomaticObjects,
        },
      })
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
    rootModel: gameObjectModel(gameEngine.rootIds),
    selectedKeys: selection,
    updateParentOrder: (key :ModelKey, parent :ModelKey|undefined, index :number) => {
      const gameObject = gameEngine.gameObjects.require(key as string)
      const activePage = gameEngine.activePage.current
      let parentId :string|null
      let childIds :string[]
      let newExpanded = new Set(expanded)
      if (parent === undefined) {
        parentId = (activePage === DEFAULT_PAGE) ? null : activePage
        childIds = gameEngine.rootIds.current
      } else {
        parentId = parent as string
        childIds = gameEngine.gameObjects.require(parentId).transform.childIds.current
        newExpanded.add(parentId)
      }
      const edit :PMap<any> = {}
      // null is equivalent to undefined in this case, hence != rather than !==
      if (parentId != gameObject.transform.parentId) edit.transform = {parentId}
      if (childIds.indexOf(key as string) !== index) {
        edit.order = getNewOrder(childIds, index, getOrder)
      }
      applyEdit({expanded: newExpanded, edit: {[key]: edit}})
    },
    componentsModel: {
      keys: selectionArray.switchMap(selection => {
        if (selection.length === 0) return Value.constant<string[]>([])
        const getComponentTypes = (id :string) => {
          const gameObject = gameEngine.gameObjects.require(id)
          return Value.join2(showEditorObjects, gameObject.componentTypes).map(([show, types]) => {
            if (show) return types
            return types.filter(
              type => !(gameObject.requireComponent(type).hideFlags & EDITOR_HIDE_FLAG),
            )
          })
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
          remove: () => applyToSelection({[key]: null}),
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
      const types = gameObject.componentTypes.current
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

function createAutomaticObjects (gameEngine :GameEngine) :SpaceConfig {
  return {
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
    ambient: {
      light: {},
    },
    directional: {
      light: {lightType: "directional"},
      transform: {localPosition: vec3.fromValues(1, 1, 1)},
    },
  }
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
        reverseAdd[id] = gameObject.createConfig()
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
                reverseComponentConfig[key] = currentValue === undefined ? null : currentValue
                const newValue = componentEditConfig[key]
                property.update(newValue === null ? undefined : newValue)
              }
            } else {
              reverseConfig[key] = component.createConfig()
              component.dispose()
            }
          } else {
            const value = gameObject[key]
            if (value === undefined) {
              reverseConfig[key] = null
              gameObject.addComponent(key, editConfig[key])
            } else {
              const property = gameObject.getProperty(key) as Mutable<any>
              const currentValue = property.current
              reverseConfig[key] = currentValue === undefined ? null : currentValue
              const newValue = editConfig[key]
              property.update(newValue === null ? undefined : newValue)
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
