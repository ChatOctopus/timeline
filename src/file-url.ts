import { pathToFileURL } from "node:url"

export function toFileUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("file://")) {
    return pathOrUrl
  }

  return pathToFileURL(pathOrUrl).toString()
}
