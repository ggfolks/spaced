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
    tags: new Set(["canvas"]),
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
                type: "column",
                offPolicy: "stretch",
                contents: [
                  {
                    type: "box",
                    contents: {type: "spacer", height: 41},
                  },
                  {
                    type: "box",
                    scopeId: "leftColumn",
                    constraints: {stretch: true},
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
                        style: {halign: "left"},
                      },
                      keys: "rootKeys",
                      data: "rootData",
                      key: "id",
                      selectedKeys: "selectedKeys",
                      updateParentOrder: "updateParentOrder",
                    },
                    style: {halign: "stretch", valign: "stretch"},
                  },
                ],
              },
              style: {halign: "stretch", valign: "stretch", preferredWidth: 200},
            },
            TabbedPaneConfig,
            {
              type: "box",
              contents: {
                type: "column",
                offPolicy: "stretch",
                contents: [
                  {
                    type: "box",
                    contents: {type: "spacer", height: 41},
                  },
                  {
                    type: "box",
                    scopeId: "rightColumn",
                    constraints: {stretch: true},
                    contents: {
                      type: "column",
                      gap: 5,
                      offPolicy: "stretch",
                      contents: [
                        {
                          type: "dragVList",
                          element: {
                            type: "box",
                            scopeId: "component",
                            overrideParentState: "normal",
                            contents: {
                              type: "column",
                              offPolicy: "stretch",
                              contents: [
                                {
                                  type: "box",
                                  scopeId: "componentHeader",
                                  contents: {
                                    type: "absLayout",
                                    contents: [
                                      {
                                        type: "box",
                                        scopeId: "componentType",
                                        contents: {type: "label", text: "type"},
                                        constraints: {stretchX: true, stretchY: true},
                                      },
                                      {
                                        type: "box",
                                        visible: "removable",
                                        scopeId: "default",
                                        contents: {
                                          type: "button",
                                          contents: {
                                            type: "box",
                                            scopeId: "removeComponentButton",
                                            contents: {type: "label", text: Value.constant("×")},
                                          },
                                          onClick: "remove",
                                        },
                                        constraints: {stretchX: true, stretchY: true},
                                        style: {halign: "right"},
                                      },
                                    ],
                                  },
                                  style: {halign: "stretch", valign: "stretch"},
                                },
                                {
                                  type: "box",
                                  scopeId: "componentBody",
                                  contents: {
                                    type: "propertyView",
                                    gap: 5,
                                    scopeId: "componentProperties",
                                    editable: Value.constant(true),
                                    offPolicy: "stretch",
                                    keys: "propertyKeys",
                                    data: "propertyData",
                                  },
                                  style: {halign: "stretch", valign: "stretch"},
                                },
                              ],
                            },
                            style: {halign: "stretch", valign: "top"},
                          },
                          keys: "componentKeys",
                          data: "componentData",
                          key: "type",
                          updateOrder: "updateComponentOrder",
                        },
                        {
                          type: "box",
                          scopeId: "default",
                          visible: "haveSelection",
                          contents: {
                            type: "dropdown",
                            dropLeft: true,
                            contents: {
                              type: "box",
                              scopeId: "addComponentButton",
                              contents: {type: "label", text: "componentTypeLabel"},
                            },
                            element: createDropdownItemConfig(
                              2,
                              "dropdownItem",
                              true,
                              "addComponentItem",
                            ),
                            keys: "componentTypeKeys",
                            data: "componentTypeData",
                          },
                        },
                      ],
                    },
                    style: {halign: "stretch", valign: "stretch"},
                  },
                ],
              },
              style: {halign: "stretch", valign: "stretch", preferredWidth: 300},
            },
          ],
        },
      ],
    },
  }
}
