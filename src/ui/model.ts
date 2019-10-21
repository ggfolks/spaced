import {Value} from "tfw/core/react"
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
})
