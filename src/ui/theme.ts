import {customStyles, customTheme} from "tfw/ui/theme"

export const UIStyles = customStyles({
  colors: {},
  shadows: {},
  fonts: {},
  paints: {},
  borders: {},
  backgrounds: {
    pageHeader: {fill: {type: "color", color: "#303030"}},
  },
})

export const UITheme = customTheme({
  pageHeader: {
    box: {background: "$pageHeader"},
  },
})
