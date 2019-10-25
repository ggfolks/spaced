import {refEquals} from "tfw/core/data"
import {Mutable, Value} from "tfw/core/react"
import {MutableSet} from "tfw/core/rcollect"
import {Noop, PMap, getValue} from "tfw/core/util"
import {CategoryNode} from "tfw/graph/node"
import {DEFAULT_PAGE, GameEngine, GameObject, GameObjectConfig, SpaceConfig} from "tfw/engine/game"
import {getCurrentEditNumber} from "tfw/ui/element"
import {Model, ModelData, ModelKey, ModelProvider, dataProvider, mapProvider} from "tfw/ui/model"

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

export function createUIModel (gameEngine :GameEngine) {
  const getOrder = (id :string) => {
    if (id === DEFAULT_PAGE) return 0
    return gameEngine.gameObjects.require(id).order
  }
  const models = new Map<ModelKey, Model>()
  const pageEditor = createGameObjectEditor(gameEngine, models)
  const selection = MutableSet.local<string>()
  const haveSelection = selection.fold(false, (value, set) => set.size > 0)
  const selectionArray = selection.fold<string[]>([], (value, set) => Array.from(set))
  const clipboard = Mutable.local<SpaceConfig|undefined>(undefined)
  const expanded = MutableSet.local<string>()
  const canUndo = Mutable.local(false)
  const canRedo = Mutable.local(false)
  const undoStack :FullGameObjectEdit[] = []
  const redoStack :FullGameObjectEdit[] = []
  const applyEdit = (edit :GameObjectEdit) => {
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
  }
  const applyToSelection = (perObjectEdit :PMap<any>) => {
    const edit :SpaceEditConfig = {}
    for (const id of selection) edit[id] = perObjectEdit
    applyEdit({edit})
  }
  const modelData = {
    resolve: (key :ModelKey) => {
      let model = models.get(key)
      if (!model) {
        const gameObject = gameEngine.gameObjects.require(key as string)
        const createPropertyValue = createPropertyValueCreator(gameObject, applyEdit)
        models.set(key, model = new Model({
          id: Value.constant(key),
          name: createPropertyValue("name"),
          childKeys: gameObject.transform.childIds,
          childData: modelData,
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
  const getUnusedName = (base :string) => {
    let name = base
    for (let ii = 2; gameEngine.gameObjects.has(name); ii++) name = base + ii
    return name
  }
  const createObject = (type :string, config :GameObjectConfig) => {
    const name = getUnusedName(type)
    const activePage = gameEngine.activePage.current
    if (activePage !== DEFAULT_PAGE) config.transform = {parentId: activePage}
    const rootIds = gameEngine.rootIds.current
    config.order = rootIds.length === 0 ? 0 : getOrder(rootIds[rootIds.length - 1]) + 1
    applyEdit({selection: new Set([name]), add: {[name]: config}})
  }
  const addSubtreeToConfig = (config :SpaceConfig, rootId :string) => {
    const gameObject = gameEngine.gameObjects.require(rootId)
    config[rootId] = gameObject.getConfig()
    for (const childId of gameObject.transform.childIds.current) {
      addSubtreeToConfig(config, childId)
    }
  }
  const copySelected = () => {
    const config :SpaceConfig = {}
    for (const id of selection) addSubtreeToConfig(config, id)
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
  function getCategoryKeys (category :CategoryNode) :Value<string[]> {
    return category.children.keysValue.map<string[]>(Array.from)
  }
  function getCategoryData (category :CategoryNode) :ModelProvider {
    return mapProvider(category.children, (value, key) => {
      if (value.current instanceof CategoryNode) return {
        name: Value.constant(key),
        submenu: Value.constant(true),
        keys: getCategoryKeys(value.current),
        data: getCategoryData(value.current),
      }
      return {
        name: Value.constant(key),
        enabled: haveSelection,
        action: () => {
          const gameObject = gameEngine.gameObjects.require(selectionArray.current[0])
          const componentTypes = gameObject.componentTypes.current
          const last = gameObject.requireComponent(componentTypes[componentTypes.length - 1])
          const order = last.order + 1
          const edit :SpaceEditConfig = {}
          for (const id of selection) {
            edit[id] = {[key]: {order}}
          }
          applyEdit({edit})
        },
      } as ModelData
    })
  }
  const componentTypeKeys = getCategoryKeys(gameEngine.componentTypeRoot)
  const componentTypeData = getCategoryData(gameEngine.componentTypeRoot)
  return new Model({
    menuBarKeys: Value.constant(["space", "edit", "object", "component"]),
    menuBarData: dataProvider({
      space: {
        name: Value.constant("Space"),
        keys: Value.constant(["clearAll"]),
        data: dataProvider({
          clearAll: {
            name: Value.constant("Clear All"),
            action: () => {
              applyEdit({selection: new Set(), remove: new Set(gameEngine.gameObjects.keys())})
            },
          },
        }),
      },
      edit: {
        name: Value.constant("Edit"),
        keys: Value.constant(
          ["undo", "redo", "sep1", "cut", "copy", "paste", "delete", "sep2", "selectAll"],
        ),
        data: dataProvider({
          undo: {
            name: Value.constant("Undo"),
            shortcut: Value.constant("undo"),
          },
          redo: {
            name: Value.constant("Redo"),
            shortcut: Value.constant("redo"),
          },
          sep1: {separator: Value.constant(true)},
          cut: {
            name: Value.constant("Cut"),
            shortcut: Value.constant("cut"),
          },
          copy: {
            name: Value.constant("Copy"),
            shortcut: Value.constant("copy"),
          },
          paste: {
            name: Value.constant("Paste"),
            shortcut: Value.constant("paste"),
          },
          delete: {
            name: Value.constant("Delete"),
            shortcut: Value.constant("delete"),
          },
          sep2: {separator: Value.constant(true)},
          selectAll: {
            name: Value.constant("Select All"),
            action: () => {
              const set = new Set<string>()
              for (const rootId of gameEngine.rootIds.current) addSubtreeToSet(set, rootId)
              setIdSet(selection, set)
            },
          },
        }),
        shortcutKeys: Value.constant(["undo", "redo", "cut", "copy", "paste", "delete"]),
        shortcutData: dataProvider({
          undo: {
            enabled: canUndo,
            action: () => {
              const oldSelection = new Set(selection)
              const edit = undoStack.pop()!
              gameEngine.activePage.update(edit.activePage)
              const reverseEdit = pageEditor(edit)
              setIdSet(selection, edit.selection)
              setIdSet(expanded, edit.expanded)
              reverseEdit.activePage = edit.activePage
              reverseEdit.selection = oldSelection
              redoStack.push(reverseEdit)
              canRedo.update(true)
              canUndo.update(undoStack.length > 0)
            },
          },
          redo: {
            enabled: canRedo,
            action: () => {
              const oldSelection = new Set(selection)
              const edit = redoStack.pop()!
              gameEngine.activePage.update(edit.activePage)
              const reverseEdit = pageEditor(edit)
              setIdSet(selection, edit.selection)
              setIdSet(expanded, edit.expanded)
              reverseEdit.activePage = edit.activePage
              reverseEdit.selection = oldSelection
              undoStack.push(reverseEdit)
              canUndo.update(true)
              canRedo.update(redoStack.length > 0)
            },
          },
          cut: {
            enabled: haveSelection,
            action: () => {
              copySelected()
              removeSelected()
            },
          },
          copy: {
            enabled: haveSelection,
            action: copySelected,
          },
          paste: {
            enabled: clipboard.map(Boolean),
            action: () => {

            },
          },
          delete: {
            enabled: haveSelection,
            action: removeSelected,
          },
        }),
      },
      object: {
        name: Value.constant("Object"),
        keys: Value.constant(["group", "camera", "light", "model", "primitive"]),
        data: dataProvider({
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
            keys: Value.constant(["sphere", "cylinder", "cube", "quad"]),
            data: dataProvider({
              sphere: {
                name: Value.constant("Sphere"),
                action: () => createObject("sphere", {meshFilter: {}, meshRenderer: {}}),
              },
              cylinder: {
                name: Value.constant("Cylinder"),
                action: () => createObject("cylinder", {meshFilter: {}, meshRenderer: {}}),
              },
              cube: {
                name: Value.constant("Cube"),
                action: () => createObject("cube", {meshFilter: {}, meshRenderer: {}}),
              },
              quad: {
                name: Value.constant("Quad"),
                action: () => createObject("quad", {meshFilter: {}, meshRenderer: {}}),
              },
            }),
          },
        }),
      },
      component: {
        name: Value.constant("Component"),
        keys: componentTypeKeys,
        data: componentTypeData,
      },
    }),
    pageKeys: gameEngine.pages,
    pageData: {
      resolve: (key :ModelKey) => {
        let model = models.get(key)
        if (!model) {
          if (key === DEFAULT_PAGE) {
            models.set(key, model = new Model({
              id: Value.constant(DEFAULT_PAGE),
              name: Value.constant(DEFAULT_PAGE),
              removable: Value.constant(false),
              remove: Noop,
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
      applyEdit({
        activePage: name,
        add: {[name]: {order: getOrder(pages[pages.length - 1]) + 1, page: {}}},
      })
    },
    updateOrder: (key :string, index :number) => {
      const currentPageKeys = gameEngine.pages.current
      const currentIndex = currentPageKeys.indexOf(key)
      if (currentIndex === index) return
      const edit = {edit: {}}
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
        let newOrder :number
        switch (index) {
          case 0:
            newOrder = getOrder(currentPageKeys[0]) - 1
            break
          case currentPageKeys.length:
            newOrder = getOrder(currentPageKeys[currentPageKeys.length - 1]) + 1
            break
          default:
            newOrder = (getOrder(currentPageKeys[index]) + getOrder(currentPageKeys[index - 1])) / 2
            break
        }
        edit.edit[key] = {order: newOrder}
      }
      applyEdit(edit)
    },
    rootKeys: gameEngine.rootIds,
    rootData: modelData,
    selectedKeys: selection,
    updateParentOrder: (key :ModelKey, parent :ModelKey|undefined, index :number) => {
    },
    componentKeys: selectionArray.switchMap(selection => {
      if (selection.length === 0) return Value.constant<string[]>([])
      if (selection.length === 1) return gameEngine.gameObjects.require(selection[0]).componentTypes
      const values :Value<string[]>[] = []
      for (const id of selection) values.push(gameEngine.gameObjects.require(id).componentTypes)
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
    componentData: {
      resolve: (key :ModelKey) => {
        return new Model({
          type: Value.constant(key),
        })
      },
    },
    updateComponentOrder: (key :string, index :number) => {
      const gameObject = gameEngine.gameObjects.require(selectionArray.current[0])
      const types = gameObject.componentTypes.current

      // to reorder an ordinary page, we change its order
      let newOrder :number
      switch (index) {
        case 0:
          newOrder = gameObject.requireComponent(types[0]).order - 1
          break
        case types.length:
          newOrder = gameObject.requireComponent(types[types.length - 1]).order + 1
          break
        default:
          newOrder = (
            gameObject.requireComponent(types[index]).order +
            gameObject.requireComponent(types[index - 1]).order
          ) / 2
          break
      }
      applyToSelection({[key]: {order: newOrder}})
    },
    haveSelection,
    componentTypeLabel: Value.constant("Add Component"),
    componentTypeKeys,
    componentTypeData,
  })
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
        const gameObject = gameEngine.gameObjects.require(id)
        reverseAdd[id] = gameObject.getConfig()
        gameObject.dispose()
        models.delete(id)
      }
    }
    if (edit.add) {
      for (const id in edit.add) {
        gameEngine.createGameObject(id, edit.add[id])
        reverseRemove.add(id)
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
                property.update(componentEditConfig[key])
              }
            } else {
              reverseConfig[key] = component.getConfig()
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
              property.update(editConfig[key])
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
