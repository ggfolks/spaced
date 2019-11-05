import {dim2} from "tfw/core/math"
import {Value} from "tfw/core/react"
import {Scale} from "tfw/core/ui"
import {RootConfig} from "tfw/ui/element"
import {CtrlMask, MetaMask, ShiftMask} from "tfw/ui/keymap"
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
    model: "model",
  },
  model: "menuBarModel",
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
    type: "box",
    scopeId: "stats",
    tags: new Set(["canvas"]),
    constraints: {stretch: true},
    contents: {
      type: "vlist",
      gap: 5,
      visible: "showStats",
      offPolicy: "stretch",
      model: "statsModel",
      element: {type: "label", text: "stat"},
    },
    style: {halign: "left", valign: "top"},
  },
  addTabElement: {
    type: "button",
    contents: {
      type: "box",
      scopeId: "addTabButton",
      contents: {type: "label", text: Value.constant("+")},
    },
    onClick: "createPage",
  },
  model: "pagesModel",
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
    keymap: {
      // TODO: use something that abstracts over the fact that on Mac we use Meta for many things
      // versus Ctrl on Linux & Windows
      KeyX: {[CtrlMask]: "cut", [MetaMask]: "cut"},
      KeyC: {[CtrlMask]: "copy", [MetaMask]: "copy"},
      KeyV: {[CtrlMask]: "paste", [MetaMask]: "paste"},
      KeyA: {[CtrlMask]: "selectAll", [MetaMask]: "selectAll"},

      Delete: {0: "delete"},
      NumpadDecimal: {0: "delete"},

      KeyZ: {[CtrlMask]: "undo", [CtrlMask|ShiftMask]: "redo"},
      KeyY: {[CtrlMask]: "redo"},
    },
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
                      model: "rootModel",
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
                                    type: "row",
                                    contents: [
                                      {
                                        type: "box",
                                        scopeId: "componentType",
                                        contents: {type: "label", text: "type"},
                                        constraints: {stretch: true},
                                        style: {halign: "left"},
                                      },
                                      {
                                        type: "hlist",
                                        model: "actionsModel",
                                        element: {
                                          type: "button",
                                          contents: {
                                            type: "box",
                                            scopeId: "componentActionButton",
                                            contents: {type: "label", text: "name"},
                                          },
                                          onClick: "action",
                                        },
                                      },
                                      {
                                        type: "button",
                                        visible: "removable",
                                        contents: {
                                          type: "box",
                                          scopeId: "removeComponentButton",
                                          contents: {type: "label", text: Value.constant("×")},
                                        },
                                        onClick: "remove",
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
                                    model: "propertiesModel",
                                  },
                                  style: {halign: "stretch", valign: "stretch"},
                                },
                              ],
                            },
                            style: {halign: "stretch", valign: "top"},
                          },
                          model: "componentsModel",
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
                            model: "componentTypesModel",
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
