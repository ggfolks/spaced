import {customStyles, customTheme, family} from "tfw/ui/theme"

const componentViewHeaderCorner = [5, 5, 0, 0]

export const UIStyles = customStyles({
  colors: {},
  shadows: {},
  fonts: {
    componentViewHeader: {family, size: 16},
    addComponent: {family, size: 16},
  },
  paints: {},
  borders: {},
  backgrounds: {
    pageHeader: {fill: {type: "color", color: "#303030"}},
    componentViewHeader: {
      fill: {type: "color", color: "#303030"},
      cornerRadius: componentViewHeaderCorner,
    },
  },
})

export const UITheme = customTheme({
  pageHeader: {
    box: {background: "$pageHeader"},
  },
  componentView: {
    box: {margin: 5},
  },
  componentViewHeader: {
    box: {padding: 5, background: "$componentViewHeader"},
  },
  componentViewType: {
    label: {font: "$componentViewHeader"},
  },
  removeComponentButton: {
    label: {
      font: "$componentViewHeader",
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
