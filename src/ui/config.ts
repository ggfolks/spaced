import {Value} from "tfw/core/react"
import {Scale} from "tfw/core/ui"
import {windowSize} from "tfw/scene2/gl"
import {RootConfig} from "tfw/ui/element"
import {createMenuItemConfig} from "tfw/ui/menu"

const MenuBarConfig = {
  type: "menubar",
  offPolicy: "stretch",
  element: {
    type: "menu",
    contents: {
      type: "box",
      contents: {type: "label", text: "name"},
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
}

const TabbedPaneConfig = {
  type: "tabbedpane",
  tabElement: {
    type: "box",
    contents: {
      type: "row",
      contents: [
        {
          type: "editablelabel",
          text: "name",
          contents: {
            type: "box",
            contents: {type: "label", overrideParentState: "normal", scopeId: "tab"},
          },
        },
        {
          type: "button",
          visible: "removable",
          contents: {
            type: "box",
            scopeId: "removeTabButton",
            contents: {type: "label", text: Value.constant("×")},
          },
          onClick: "remove",
        },
      ],
    }
  },
  contentElement: {
    type: "spacer",
    constraints: {stretch: true},
  },
  addTabElement: {
    type: "button",
    contents: {
      type: "box",
      scopeId: "addTabButton",
      contents: {type: "label", text: Value.constant("🞣")},
    },
    onClick: "createPage",
  },
  keys: "pageKeys",
  data: "pageData",
  key: "id",
  activeKey: "activePage",
  updateOrder: "updateOrder",
  constraints: {stretch: true},
}

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
            MenuBarConfig,
            {
              type: "spacer",
              width: 10,
              constraints: {stretch: true},
            },
          ],
        },
      },
      {
        type: "row",
        offPolicy: "stretch",
        constraints: {stretch: true},
        contents: [
          {
            type: "box",
            scopeId: "pageHeader",
            contents: {
              type: "treeview",
              element: {
                type: "editablelabel",
                text: "name",
                contents: {
                  type: "box",
                  contents: {type: "label", overrideParentState: "normal", scopeId: "treeviewnode"},
                },
              },
              keys: "rootKeys",
              data: "rootData",
              selectedKeys: "selectedKeys",
              updateParentOrder: "updateParentOrder",
            },
          },
          TabbedPaneConfig,
          {
            type: "box",
            scopeId: "pageHeader",
            contents: {
              type: "spacer",
              width: 100,
            },
          },
        ],
      },
    ],
  },
}
