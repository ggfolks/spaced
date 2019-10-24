import {customStyles, customTheme, family} from "tfw/ui/theme"

const componentViewHeaderCorner = [5, 5, 0, 0]

export const UIStyles = customStyles({
  colors: {},
  shadows: {},
  fonts: {
    componentViewHeader: {family, size: 16},
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
    box: {background: "$componentViewHeader"},
    label: {font: "$componentViewHeader"},
  },
})
