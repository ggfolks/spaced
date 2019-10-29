import {customStyles, customTheme, family} from "tfw/ui/theme"

const componentHeaderCorner = [5, 5, 0, 0]
const componentBodyCorner = [0, 0, 5, 5]

export const UIStyles = customStyles({
  colors: {},
  shadows: {},
  fonts: {
    componentHeader: {family, size: 16},
    componentBody: {family, size: 16},
    componentProperty: {family, size: 14},
    addComponent: {family, size: 16},
  },
  paints: {},
  borders: {},
  backgrounds: {
    pageHeader: {fill: {type: "color", color: "#303030"}},
    componentHeader: {
      fill: {type: "color", color: "#404040"},
      cornerRadius: componentHeaderCorner,
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
})
