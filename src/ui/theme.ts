import {customStyles, customTheme, family} from "tfw/ui/theme"

const componentHeaderCorner = [5, 5, 0, 0]
const componentBodyCorner = [0, 0, 5, 5]
const componentActionButtonCorner = 5

export const UIStyles = customStyles({
  colors: {},
  shadows: {},
  fonts: {
    componentHeader: {family, size: 16},
    componentBody: {family, size: 16},
    componentProperty: {family, size: 14},
    addComponent: {family, size: 16},
    stats: {family, size: 16},
  },
  paints: {},
  borders: {
    leftColumn: {
      stroke: {type: "color", color: "#303030"},
      width: [1, 1, 0, 0],
    },
    rightColumn: {
      stroke: {type: "color", color: "#303030"},
      width: [1, 0, 0, 1],
    },
  },
  backgrounds: {
    pageHeader: {fill: {type: "color", color: "#303030"}},
    componentHeader: {
      fill: {type: "color", color: "#404040"},
      cornerRadius: componentHeaderCorner,
    },
    componentActionButton: {
      fill: {type: "color", color: "#303030"},
      cornerRadius: componentActionButtonCorner,
    },
    componentActionButtonHovered: {
      fill: {type: "color", color: "#282828"},
      cornerRadius: componentActionButtonCorner,
    },
    componentActionButtonPressed: {
      fill: {type: "color", color: "#202020"},
      cornerRadius: componentActionButtonCorner,
    },
    componentBody: {
      fill: {type: "color", color: "#606060"},
      cornerRadius: componentBodyCorner,
    },
  },
})

export const UITheme = customTheme({
  pageHeader: {
    box: {background: "$pageHeader"},
  },
  leftColumn: {
    box: {padding: 5, border: "$leftColumn"},
  },
  rightColumn: {
    box: {border: "$rightColumn"},
  },
  component: {
    box: {margin: 5},
  },
  componentHeader: {
    box: {padding: 5, background: "$componentHeader"},
  },
  componentBody: {
    box: {padding: 5, background: "$componentBody"},
    label: {font: "$componentBody"},
  },
  componentType: {
    label: {font: "$componentHeader"},
  },
  componentProperties: {
    label: {font: "$componentProperty", fill: "$lightGray"},
  },
  componentActionButton: {
    box: {
      padding: [3, 8, 3, 8],
      background: "$componentActionButton",
      hovered: {background: "$componentActionButtonHovered"},
      hoverFocused: {background: "$componentActionButtonHovered"},
      pressed: {background: "$componentActionButtonPressed"},
    },
    label: {font: "$componentProperty"},
  },
  removeComponentButton: {
    label: {
      font: "$componentHeader",
      fill: "$darkGray",
      hovered: {fill: "$mediumGray"},
      hoverFocused: {fill: "$mediumGray"},
      pressed: {fill: "$lightGray"},
    },
  },
  addComponentButton: {
    box: {
      padding: [5, 10, 5, 10],
      background: "$dropdown",
      hovered: {background: "$dropdownHovered"},
      hoverFocused: {background: "$dropdownHovered"},
      pressed: {background: "$dropdownPressed"},
    },
    label: {font: "$addComponent"},
  },
  addComponentItem: {
    box: {
      padding: [5, 5, 5, 15],
      background: "$dropdownItem",
      hovered: {background: "$dropdownItemHovered"},
      hoverFocused: {background: "$dropdownItemHovered"},
      pressed: {background: "$dropdownItemPressed"},
      separator: {background: undefined},
    },
    label: {font: "$addComponent"},
  },
  stats: {
    box: {padding: 10},
    label: {font: "$stats"},
  },
})
