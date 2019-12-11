import {dim2} from "tfw/core/math"
import {Value} from "tfw/core/react"
import {Scale} from "tfw/core/ui"
import {Root} from "tfw/ui/element"
import {CtrlMask, MetaMask, ShiftMask} from "tfw/ui/keymap"
import {Dropdown} from "tfw/ui/dropdown"

const MenuBarConfig = {
  type: "menuBar",
  offPolicy: "stretch",
  element: {
    type: "menu",
    contents: {
      type: "box",
      contents: {type: "label", text: "name"},
    },
    element: Dropdown.createItemConfig("menuItem"),
    model: "model",
  },
  model: "menuBarModel",
}

const ScrollBarConfig = {
  type: "scrollBar",
  contents: {
    type: "box",
    contents: {type: "spacer"},
  },
  handle: {
    type: "box",
    scopeId: "scrollHandle",
    contents: {type: "spacer"},
  },
}

const TreeTabsConfig = {
  type: "tabbedPane",
  tabElement: {
    type: "box",
    contents: {type: "label", text: "name"},
  },
  contentElement: {
    type: "box",
    scopeId: "leftColumn",
    contents: {
      type: "scroller",
      orient: "vert",
      stretchContents: true,
      bar: ScrollBarConfig,
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
    },
    style: {halign: "stretch", valign: "stretch", preferredWidth: 200},
  },
  model: "treeModel",
  key: "key",
  activeKey: "activeTree",
}

const PageTabsConfig = {
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
    tags: new Set(["canvas"]),
    constraints: {stretch: true},
    contents: {
      type: "absLayout",
      contents: [
        {
          type: "box",
          scopeId: "stats",
          constraints: {stretchX: true, stretchY: true},
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
        {
          type: "box",
          scopeId: "stats",
          constraints: {stretchX: true, stretchY: true},
          contents: {type: "label", visible: "showCoords", text: "coords"},
          style: {halign: "right", valign: "bottom"},
        },
      ],
    },
    style: {halign: "stretch", valign: "stretch"},
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

export function createUIConfig (minSize :Value<dim2>) :Root.Config {
  return {
    type: "root",
    scale: new Scale(window.devicePixelRatio),
    autoSize: true,
    hintSize: minSize,
    minSize,
    keymap: {
      // TODO: use something that abstracts over the fact that on Mac we use Meta for many things
      // versus Ctrl on Linux & Windows
      KeyN: {[CtrlMask]: "new", [MetaMask]: "new"},
      KeyO: {[CtrlMask]: "open", [MetaMask]: "open"},
      KeyS: {
        [CtrlMask]: "save",
        [MetaMask]: "save",
        [CtrlMask|ShiftMask]: "saveAs",
        [MetaMask|ShiftMask]: "saveAs",
      },
      KeyQ: {[CtrlMask]: "quit", [MetaMask]: "quit"},

      KeyX: {[CtrlMask]: "cut", [MetaMask]: "cut"},
      KeyC: {[CtrlMask]: "copy", [MetaMask]: "copy"},
      KeyV: {
        [CtrlMask]: "paste",
        [MetaMask]: "paste",
        [CtrlMask|ShiftMask]: "paste",
        [MetaMask|ShiftMask]: "paste",
      },
      KeyA: {[CtrlMask]: "selectAll", [MetaMask]: "selectAll"},

      Delete: {0: "delete"},
      NumpadDecimal: {0: "delete"},

      KeyZ: {[CtrlMask]: "undo", [CtrlMask|ShiftMask]: "redo"},
      KeyY: {[CtrlMask]: "redo"},

      PageUp: {0: "raiseGrid"},
      Numpad9: {0: "raiseGrid"},

      PageDown: {0: "lowerGrid"},
      Numpad3: {0: "lowerGrid"},
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
            TreeTabsConfig,
            PageTabsConfig,
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
                      type: "scroller",
                      orient: "vert",
                      stretchContents: true,
                      bar: ScrollBarConfig,
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
                              element: Dropdown.createItemConfig(
                                "dropdownItem",
                                true,
                                "addComponentItem",
                              ),
                              model: "componentTypesModel",
                            },
                          },
                        ],
                      },
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

export function createPrefsConfig (minSize :Value<dim2>) :Root.Config {
  return {
    type: "root",
    scale: new Scale(window.devicePixelRatio),
    autoSize: true,
    minSize,
    contents: {
      type: "box",
      scopeId: "modalShade",
      contents: {
        type: "column",
        offPolicy: "equalize",
        contents: [
          {
            type: "box",
            scopeId: "dialogHeader",
            contents: {
              type: "row",
              contents: [
                {
                  type: "label",
                  text: "title",
                  constraints: {stretch: true},
                },
                {
                  type: "button",
                  contents: {
                    type: "box",
                    scopeId: "closeDialogButton",
                    contents: {type: "label", text: Value.constant("×")},
                  },
                  onClick: "close",
                },
              ],
            },
            style: {halign: "stretch"},
          },
          {
            type: "box",
            scopeId: "dialogBody",
            contents: {
              type: "tabbedPane",
              tabElement: {
                type: "box",
                contents: {type: "label", scopeId: "tab", text: "name"},
              },
              contentElement: {
                type: "box",
                scopeId: "prefsContainer",
                contents: {
                  type: "propertyView",
                  gap: 5,
                  scopeId: "prefsProperties",
                  editable: Value.constant(true),
                  offPolicy: "stretch",
                  model: "propertiesModel",
                },
                style: {halign: "stretch", valign: "stretch"},
              },
              model: "prefsCategoryModel",
              key: "key",
              activeKey: "activeCategory",
            },
            style: {halign: "stretch", valign: "stretch"},
          }
        ],
      },
    },
  }
}
