import {Mutable, Value} from "tfw/core/react"
import {Model, dataProvider} from "tfw/ui/model"

export const UIModel = new Model({
  menubarKeys: Value.constant(["space"]),
  menubarData: dataProvider({
    space: {
      title: Value.constant("Space"),
      keys: Value.constant([]),
      data: dataProvider({}),
    },
  }),
  pageKeys: Value.constant(["default"]),
  pageData: dataProvider({
    default: {
      id: Value.constant("default"),
      title: Value.constant("default"),
      removable: Value.constant(true),
      remove: () => console.log("remove"),
    },
  }),
  activePage: Mutable.local("default"),
  createPage: () => console.log("create"),
  updateOrder: (key :string, index :number) => {},
})
