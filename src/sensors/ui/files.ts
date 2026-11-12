import type { FileBlob } from '../store'

/**
 * How the page hands files to the user and takes them back. The browser default saves through a
 * download link and opens a file picker; the desktop app passes its own (native dialogs).
 */
export type FileHost = {
  save(file: FileBlob): Promise<void> | void
  /** Files the user picked (empty when they cancel). */
  open(opts: { accept: string; multiple?: boolean }): Promise<File[]>
}

export const browserFiles: FileHost = {
  save({ blob, filename }) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
  open({ accept, multiple }) {
    return new Promise((resolve) => {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = accept
      input.multiple = !!multiple
      input.style.display = 'none'
      input.onchange = () => {
        resolve(input.files ? [...input.files] : [])
        input.remove()
      }
      input.oncancel = () => {
        resolve([])
        input.remove()
      }
      document.body.appendChild(input)
      input.click()
    })
  },
}

export const DEFINITION_ACCEPT = '.yaml,.yml,.json,application/json,text/yaml'
