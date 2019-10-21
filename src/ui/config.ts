import {Scale} from "tfw/core/ui"
import {windowSize} from "tfw/scene2/gl"
import {RootConfig} from "tfw/ui/element"
import {createMenuItemConfig} from "tfw/ui/menu"

export const UIConfig :RootConfig = {
  type: "root",
  scale: new Scale(window.devicePixelRatio),
  autoSize: true,
  minSize: windowSize(window),
  contents: {
    type: "column",
    offPolicy: "stretch",
    contents: [
      {
        type: "box",
        scopeId: "pageHeader",
        style: {halign: "stretch"},
        contents: {
          type: "row",
          scopeId: "default",
          offPolicy: "stretch",
          contents: [
            {
              type: "menubar",
              offPolicy: "stretch",
              element: {
                type: "menu",
                contents: {
                  type: "box",
                  contents: {type: "label", text: "title"},
                },
                // max category depth of two for the moment
                element: createMenuItemConfig(2),
                keys: "keys",
                data: "data",
                shortcutKeys: "shortcutKeys",
                shortcutData: "shortcutData",
              },
              keys: "menubarKeys",
              data: "menubarData",
            },
            {
              type: "spacer",
              width: 10,
              constraints: {stretch: true},
            },
          ],
        },
      },
    ],
  },
}
