import * as http from "http"
import * as fs from "fs"

import {log} from "tfw/core/util"

function mimeType (path :string) :string {
  const ldidx = path.lastIndexOf("."), suff = path.substring(ldidx+1).toLowerCase()
  switch (suff) {
  case "html": return "text/html; charset=utf-8"
  case "js": return "application/javascript; charset=utf-8"
  case "json": return "application/json; charset=utf-8"
  case "png": return "image/png"
  case "jpg": return "image/jpeg"
  case "gif": return "image/gif"
  default: return "text/plain; charset=utf-8"
  }
}

const httpPort = parseInt(process.env.HTTP_PORT || "8080")
const httpServer = http.createServer((req, rsp) => {
  const path = (!req.url || req.url === "/") ? "index.html" : req.url
  // log.info("HTTP request", "url", req.url, "path", path)
  fs.readFile(`dist/${path}`, (err, content) => {
    if (err) {
      if (err.code === "ENOENT") {
        rsp.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" })
        rsp.end(`Not found: ${path}`)
      } else {
        rsp.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" })
        rsp.end("Internal error: " + err.code)
      }
    } else {
      rsp.setHeader('Access-Control-Allow-Origin', '*')
      rsp.writeHead(200, { "Content-Type": mimeType(path) })
      rsp.end(content, "utf-8")
    }
  })
})
httpServer.listen(httpPort)
log.info("Listening for connections", "port", httpPort)
