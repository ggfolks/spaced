import {Value} from "tfw/core/react"
import {Noop} from "tfw/core/util"
import {DEFAULT_PAGE, GameEngine} from "tfw/engine/game"
import {Model, ModelKey, dataProvider} from "tfw/ui/model"

export function createUIModel (gameEngine :GameEngine) {
  return new Model({
    menubarKeys: Value.constant(["space"]),
    menubarData: dataProvider({
      space: {
        title: Value.constant("Space"),
        keys: Value.constant([]),
        data: dataProvider({}),
      },
    }),
    pageKeys: gameEngine.pages,
    pageData: {
      resolve: (key :ModelKey) => {
        if (key === DEFAULT_PAGE) {
          return new Model({
            id: Value.constant(DEFAULT_PAGE),
            title: Value.constant(DEFAULT_PAGE),
            removable: Value.constant(false),
            remove: Noop,
          })
        }
        const gameObject = gameEngine.gameObjects.get(key as string)
        if (!gameObject) throw new Error(`Missing game object for page "${key}"`)
        return new Model({
          id: Value.constant(key),
          title: gameObject.nameValue,
          removable: Value.constant(true),
          remove: () => gameObject.dispose(),
        })
      },
    },
    activePage: gameEngine.activePage,
    createPage: () => gameEngine.createPage(),
    updateOrder: (key :string, index :number) => {},
  })
}
