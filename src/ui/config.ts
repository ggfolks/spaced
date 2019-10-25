import {dim2} from "tfw/core/math"
import {Value} from "tfw/core/react"
import {Scale} from "tfw/core/ui"
import {RootConfig} from "tfw/ui/element"
import {createDropdownItemConfig} from "tfw/ui/dropdown"

const MenuBarConfig = {
  type: "menuBar",
  offPolicy: "stretch",
  element: {
    type: "menu",
    contents: {
      type: "box",
      contents: {type: "label", text: "name"},
    },
    // max category depth of two for the moment
    element: createDropdownItemConfig(2, "menuItem"),
    keys: "keys",
    data: "data",
    shortcutKeys: "shortcutKeys",
    shortcutData: "shortcutData",
  },
  keys: "menuBarKeys",
  data: "menuBarData",
}

const TabbedPaneConfig = {
  type: "tabbedPane",
  tabElement: {
    type: "box",
    contents: {
      type: "row",
      contents: [
        {
          type: "editableLabel",
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

export function createUIConfig (minSize :Value<dim2>) :RootConfig {
  return {
    type: "root",
    scale: new Scale(window.devicePixelRatio),
    autoSize: true,
    minSize,
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
              contents: {
                type: "treeView",
                element: {
                  type: "box",
                  contents: {
                    type: "editableLabel",
                    text: "name",
                    contents: {
                      type: "box",
                      contents: {
                        type: "label",
                        overrideParentState: "normal",
                        scopeId: "treeViewNode",
                      },
                    },
                  },
                  style: {halign: "stretch"},
                },
                keys: "rootKeys",
                data: "rootData",
                key: "id",
                selectedKeys: "selectedKeys",
                updateParentOrder: "updateParentOrder",
              },
              style: {halign: "stretch", valign: "stretch", minWidth: 200},
            },
            TabbedPaneConfig,
            {
              type: "box",
              contents: {
                type: "column",
                offPolicy: "stretch",
                contents: [
                  {
                    type: "dragVList",
                    element: {
                      type: "box",
                      scopeId: "componentView",
                      overrideParentState: "normal",
                      contents: {
                        type: "column",
                        offPolicy: "stretch",
                        contents: [
                          {
                            type: "box",
                            scopeId: "componentViewHeader",
                            contents: {type: "label", text: "type"},
                          }
                        ],
                      },
                      style: {halign: "stretch"},
                    },
                    keys: "componentKeys",
                    data: "componentData",
                    key: "type",
                    updateOrder: "updateComponentOrder",
                  },
                  {
                    type: "box",
                    contents: {
                      type: "dropdown",
                      dropLeft: true,
                      contents: {
                        type: "box",
                        contents: {type: "label", text: "componentTypeLabel"},
                      },
                      element: createDropdownItemConfig(2, "dropdownItem", true),
                      keys: "componentTypeKeys",
                      data: "componentTypeData",
                    },
                  },
                ],
              },
              style: {halign: "stretch", valign: "stretch", minWidth: 200},
            },
          ],
        },
      ],
    },
  }
}
