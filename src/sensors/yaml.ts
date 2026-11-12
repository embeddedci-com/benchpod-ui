// A YAML reader for sensor definitions and stimuli: the subset the files use (block and flow
// collections, quoted and plain scalars, `|` and `>` blocks, anchors and aliases, comments), read
// with the YAML 1.2 core rules. Only true/false are booleans, so a key such as `on:` stays the
// string "on" (YAML 1.1 readers turn it into a boolean). A port of the reader in
// benchpod-sensors tools/yaml2json.py, so the browser, the desktop app and that tool agree.
//
// Besides the value it returns where each node starts (`locs`: a path such as
// `registers[3].s16be` to its 1-based line), so an engine error can point at its line.

export class YamlError extends Error {
  override name = 'YamlError'
  readonly line: number
  constructor(line: number, message: string) {
    super(`line ${line}: ${message}`)
    this.line = line
  }
}

export type YamlValue = null | boolean | number | string | YamlValue[] | { [k: string]: YamlValue }

export type YamlResult = { value: YamlValue; locs: Map<string, number> }

const INT_RE = /^[-+]?(0x[0-9a-fA-F_]+|0o[0-7_]+|0b[01_]+|[0-9][0-9_]*)$/
const FLOAT_RE = /^[-+]?(\.[0-9]+|[0-9][0-9_]*(\.[0-9]*)?)([eE][-+]?[0-9]+)?$/

/** YAML 1.2 core schema for a plain (unquoted) scalar. */
export function plainScalar(s: string): YamlValue {
  if (s === '' || s === '~' || s === 'null' || s === 'Null' || s === 'NULL') return null
  if (s === 'true' || s === 'True' || s === 'TRUE') return true
  if (s === 'false' || s === 'False' || s === 'FALSE') return false
  if (INT_RE.test(s)) {
    let t = s.replace(/_/g, '')
    const sign = t.startsWith('-') ? -1 : 1
    t = t.replace(/^[+-]/, '')
    if (/^0[xX]/.test(t)) return sign * parseInt(t.slice(2), 16)
    if (t.startsWith('0o')) return sign * parseInt(t.slice(2), 8)
    if (t.startsWith('0b')) return sign * parseInt(t.slice(2), 2)
    return sign * parseInt(t, 10)
  }
  if (FLOAT_RE.test(s)) return parseFloat(s.replace(/_/g, ''))
  if (s === '.inf' || s === '+.inf') return Infinity
  if (s === '-.inf') return -Infinity
  return s
}

type Line = { indent: number; text: string; n: number } | null

const isSeqItem = (t: string) => t.startsWith('- ') || t === '-'

function stripComment(line: string): string {
  let out = ''
  let q: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (q) {
      out += c
      if (q === '"' && c === '\\' && i + 1 < line.length) {
        out += line[i + 1]
        i++
      } else if (c === q) {
        if (q === "'" && line[i + 1] === "'") {
          out += "'"
          i++
        } else q = null
      }
    } else if ((c === '"' || c === "'") && (i === 0 || ' \t[{,:-'.includes(line[i - 1]))) {
      q = c
      out += c
    } else if (c === '#' && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
      break
    } else out += c
  }
  return out
}

function jsonString(text: string, n: number): string {
  try {
    return JSON.parse(text) as string
  } catch {
    throw new YamlError(n + 1, 'bad double-quoted string')
  }
}

class Reader {
  lines: Line[] = []
  raw: string[]
  anchors = new Map<string, YamlValue>()
  locs = new Map<string, number>()
  pos = 0

  constructor(text: string) {
    this.raw = text.replace(/\r\n?/g, '\n').split('\n')
    this.raw.forEach((line, n) => {
      const stripped = stripComment(line).replace(/\s+$/, '')
      const t = stripped.trim()
      if (t === '' || t === '---' || t === '...') {
        this.lines.push(null)
        return
      }
      const indent = stripped.length - stripped.replace(/^ +/, '').length
      if (stripped.slice(0, indent + 1).includes('\t')) throw new YamlError(n + 1, 'tabs are not allowed for indentation')
      this.lines.push({ indent, text: stripped.slice(indent), n })
    })
  }

  note(path: string, n: number) {
    if (!this.locs.has(path)) this.locs.set(path, n + 1)
  }

  skipBlank() {
    while (this.pos < this.lines.length && this.lines[this.pos] === null) this.pos++
  }

  cur(): { indent: number; text: string; n: number } {
    return this.lines[this.pos] as { indent: number; text: string; n: number }
  }

  parse(): YamlValue {
    this.skipBlank()
    if (this.pos >= this.lines.length) return null
    const v = this.block(this.cur().indent, '')
    this.skipBlank()
    if (this.pos < this.lines.length) throw new YamlError(this.cur().n + 1, 'unexpected indentation')
    return v
  }

  block(indent: number, path: string): YamlValue {
    this.skipBlank()
    const { indent: ind, text } = this.cur()
    void indent
    return isSeqItem(text) ? this.seq(ind, path) : this.map(ind, path)
  }

  seq(indent: number, path: string): YamlValue[] {
    const out: YamlValue[] = []
    for (;;) {
      this.skipBlank()
      if (this.pos >= this.lines.length) break
      const { indent: ind, text, n } = this.cur()
      if (ind < indent) break
      if (ind > indent) throw new YamlError(n + 1, 'bad indentation')
      if (!isSeqItem(text)) break
      const p = `${path}[${out.length}]`
      this.note(p, n)
      const rest = text.slice(1).replace(/^ +/, '')
      if (rest === '') {
        this.pos++
        this.skipBlank()
        if (this.pos >= this.lines.length || this.cur().indent <= indent) out.push(null)
        else out.push(this.block(indent + 1, p))
        continue
      }
      // "- key: value" starts a mapping whose keys sit at the item's column.
      const col = indent + (text.length - rest.length)
      if (splitKey(rest) !== null) {
        this.lines[this.pos] = { indent: col, text: rest, n }
        out.push(this.map(col, p))
      } else {
        this.pos++
        out.push(this.valueInline(rest, n, p))
      }
    }
    return out
  }

  map(indent: number, path: string): { [k: string]: YamlValue } {
    const out: { [k: string]: YamlValue } = {}
    for (;;) {
      this.skipBlank()
      if (this.pos >= this.lines.length) break
      const { indent: ind, text, n } = this.cur()
      if (ind < indent) break
      if (ind > indent) throw new YamlError(n + 1, 'bad indentation')
      if (text.startsWith('- ')) break
      const kv = splitKey(text)
      if (kv === null) throw new YamlError(n + 1, "expected 'key: value'")
      let [key, rest] = kv
      if (key in out) throw new YamlError(n + 1, `duplicate key '${key}'`)
      const p = path ? `${path}.${key}` : key
      this.note(p, n)
      this.pos++
      let anchor: string | null = null
      const m = /^&([A-Za-z0-9_-]+)\s*(.*)$/.exec(rest)
      if (m) {
        anchor = m[1]
        rest = m[2]
      }
      let val: YamlValue
      if (rest === '') {
        this.skipBlank()
        if (
          this.pos < this.lines.length &&
          (this.cur().indent > ind || (this.cur().indent === ind && this.cur().text.startsWith('- ')))
        ) {
          val = this.block(this.cur().indent, p)
        } else val = null
      } else if (['|', '|-', '|+', '>', '>-', '>+'].includes(rest)) {
        val = this.blockScalar(rest, ind)
      } else {
        val = this.valueInline(rest, n, p)
      }
      if (anchor) this.anchors.set(anchor, val)
      out[key] = val
    }
    return out
  }

  blockScalar(style: string, parentIndent: number): string {
    const lines: string[] = []
    let blockIndent: number | null = null
    while (this.pos < this.lines.length) {
      const l = this.lines[this.pos]
      if (l === null) {
        lines.push('')
        this.pos++
        continue
      }
      const rawLine = this.raw[l.n]
      const ind = rawLine.length - rawLine.replace(/^ +/, '').length
      if (ind <= parentIndent) break
      if (blockIndent === null) blockIndent = ind
      lines.push(rawLine.slice(blockIndent).replace(/\s+$/, ''))
      this.pos++
    }
    while (lines.length && lines[lines.length - 1] === '') lines.pop()
    let text = style.startsWith('>') ? lines.join(' ') : lines.join('\n')
    if (!style.endsWith('-')) text += '\n'
    return text
  }

  valueInline(text: string, n: number, path: string): YamlValue {
    let anchor: string | null = null
    const m = /^&([A-Za-z0-9_-]+)\s+(.*)$/.exec(text)
    if (m) {
      anchor = m[1]
      text = m[2]
    }
    let val: YamlValue
    if (text[0] === '[' || text[0] === '{') {
      // A flow collection may continue on the following, more indented lines.
      while (!balanced(text)) {
        this.skipBlank()
        if (this.pos >= this.lines.length) throw new YamlError(n + 1, 'unterminated flow collection')
        text += ' ' + this.cur().text
        this.pos++
      }
      const [v, end] = this.flow(text, 0, n, path)
      if (text.slice(end).trim()) throw new YamlError(n + 1, 'text after a flow collection')
      val = v
    } else {
      val = this.scalarText(text, n)
    }
    if (anchor) this.anchors.set(anchor, val)
    return val
  }

  scalarText(text: string, n: number): YamlValue {
    text = text.trim()
    if (text.startsWith('*')) {
      const name = text.slice(1)
      if (!this.anchors.has(name)) throw new YamlError(n + 1, `unknown alias '${name}'`)
      return this.anchors.get(name) as YamlValue
    }
    if (text.startsWith('"')) {
      if (!text.endsWith('"') || text.length < 2) throw new YamlError(n + 1, 'unterminated string')
      return jsonString(text, n)
    }
    if (text.startsWith("'")) {
      if (!text.endsWith("'") || text.length < 2) throw new YamlError(n + 1, 'unterminated string')
      return text.slice(1, -1).replace(/''/g, "'")
    }
    return plainScalar(text)
  }

  flow(s: string, i: number, n: number, path: string): [YamlValue, number] {
    const ws = (j: number) => {
      while (j < s.length && s[j] === ' ') j++
      return j
    }
    const at = (j: number) => {
      if (j >= s.length) throw new YamlError(n + 1, 'unterminated flow collection')
      return s[j]
    }
    i = ws(i)
    const m = /^&([A-Za-z0-9_-]+) +/.exec(s.slice(i))
    if (m) {
      const [v, j] = this.flow(s, i + m[0].length, n, path)
      this.anchors.set(m[1], v)
      return [v, j]
    }
    const c = at(i)
    if (c === '[') {
      const out: YamlValue[] = []
      i = ws(i + 1)
      if (at(i) === ']') return [out, i + 1]
      for (;;) {
        const p = `${path}[${out.length}]`
        this.note(p, n)
        const [v, j] = this.flow(s, i, n, p)
        out.push(v)
        i = ws(j)
        if (at(i) === ',') {
          i = ws(i + 1)
          if (at(i) === ']') return [out, i + 1]
          continue
        }
        if (at(i) === ']') return [out, i + 1]
        throw new YamlError(n + 1, "expected ',' or ']' in a flow list")
      }
    }
    if (c === '{') {
      const out: { [k: string]: YamlValue } = {}
      i = ws(i + 1)
      if (at(i) === '}') return [out, i + 1]
      for (;;) {
        const [k, j] = this.flowScalar(s, i, n, true)
        i = ws(j)
        if (at(i) !== ':') throw new YamlError(n + 1, "expected ':' in a flow mapping")
        const key = String(k)
        const p = path ? `${path}.${key}` : key
        this.note(p, n)
        const [v, j2] = this.flow(s, i + 1, n, p)
        if (key in out) throw new YamlError(n + 1, `duplicate key '${key}'`)
        out[key] = v
        i = ws(j2)
        if (at(i) === ',') {
          i = ws(i + 1)
          if (at(i) === '}') return [out, i + 1]
          continue
        }
        if (at(i) === '}') return [out, i + 1]
        throw new YamlError(n + 1, "expected ',' or '}' in a flow mapping")
      }
    }
    return this.flowScalar(s, i, n, false)
  }

  flowScalar(s: string, i: number, n: number, key: boolean): [YamlValue, number] {
    if (s[i] === '"') {
      let j = i + 1
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1
      if (j >= s.length) throw new YamlError(n + 1, 'unterminated string')
      return [jsonString(s.slice(i, j + 1), n), j + 1]
    }
    if (s[i] === "'") {
      let j = i + 1
      for (;;) {
        if (j >= s.length) throw new YamlError(n + 1, 'unterminated string')
        if (s[j] === "'" && s[j + 1] === "'") {
          j += 2
          continue
        }
        if (s[j] === "'") break
        j++
      }
      return [s.slice(i + 1, j).replace(/''/g, "'"), j + 1]
    }
    let j = i
    while (j < s.length) {
      if (',]}'.includes(s[j])) break
      if (s[j] === ':' && (j + 1 >= s.length || ' ,]}'.includes(s[j + 1]))) break
      j++
    }
    const text = s.slice(i, j).trim()
    if (key) return [text, j]
    if (text.startsWith('*')) return [this.scalarText(text, n), j]
    return [plainScalar(text), j]
  }
}

/** 'key: rest' -> [key, rest], or null when the line is not a mapping entry. */
function splitKey(text: string): [string, string] | null {
  if (text[0] === '"' || text[0] === "'") {
    const q = text[0]
    let end = text.indexOf(q, 1)
    while (q === "'" && end !== -1 && text[end + 1] === "'") end = text.indexOf(q, end + 2)
    if (end === -1) return null
    const key = q === "'" ? text.slice(1, end).replace(/''/g, "'") : (JSON.parse(text.slice(0, end + 1)) as string)
    const after = text.slice(end + 1)
    if (after.startsWith(':') && (after.length === 1 || after[1] === ' ')) return [key, after.slice(1).trim()]
    return null
  }
  if (text[0] === '[' || text[0] === '{') return null
  const m = /^([^\s:#][^:#]*?)\s*:(\s+|$)/.exec(text)
  if (!m) return null
  // A plain key is a string: `on` and `yes` keep their text (YAML 1.2), `true`/`null` too (a JSON
  // key is a string anyway), and a number key is its value printed (`0x10:` is "16"), as
  // yaml2json.py and PyYAML write it.
  const k = plainScalar(m[1])
  return [typeof k === 'number' ? String(k) : m[1], text.slice(m[0].length).trim()]
}

function balanced(text: string): boolean {
  let depth = 0
  let q: string | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (q === '"' && c === '\\') i++
      else if (c === q) q = null
    } else if (c === '"' || c === "'") q = c
    else if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') depth--
  }
  return depth === 0
}

/** Read one YAML document. Throws YamlError (with its line) on text it cannot read. */
export function parseYaml(text: string): YamlResult {
  const r = new Reader(text)
  const value = r.parse()
  return { value, locs: r.locs }
}

/** The line of the deepest node on `path` that the reader saw (an engine error's path), or null. */
export function lineOfPath(locs: Map<string, number>, path: string | undefined | null): number | null {
  let p = (path ?? '').trim()
  while (p) {
    const line = locs.get(p)
    if (line !== undefined) return line
    const cut = Math.max(p.lastIndexOf('.'), p.lastIndexOf('['))
    if (cut <= 0) break
    p = p.slice(0, cut)
  }
  return null
}

// ---- writing ----

const SAFE_PLAIN = /^[A-Za-z_][A-Za-z0-9_./-]*$/

function scalarOut(v: YamlValue): string {
  if (v === null) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : v > 0 ? '.inf' : v < 0 ? '-.inf' : 'null'
  const s = String(v)
  // A plain string must read back as the same string, not as a number, boolean or null.
  if (SAFE_PLAIN.test(s) && typeof plainScalar(s) === 'string') return s
  return JSON.stringify(s)
}

function flowOut(v: YamlValue): string {
  if (Array.isArray(v)) return `[${v.map(flowOut).join(', ')}]`
  if (v !== null && typeof v === 'object') {
    return `{ ${Object.entries(v)
      .map(([k, x]) => `${scalarOut(k)}: ${flowOut(x)}`)
      .join(', ')} }`
  }
  return scalarOut(v)
}

const isFlat = (v: YamlValue) =>
  v !== null &&
  typeof v === 'object' &&
  (Array.isArray(v) ? v : Object.values(v)).every((x) => x === null || typeof x !== 'object' || (Array.isArray(x) && x.every((y) => y === null || typeof y !== 'object' || Array.isArray(y))))

/**
 * YAML text for a value, in the style of the library files: block mappings, and lists whose
 * items are flat (stimulus segments, faults) as one flow mapping per line. The result reads back
 * (parseYaml) as the same value.
 */
export function toYaml(v: YamlValue, indent = 0): string {
  const pad = ' '.repeat(indent)
  if (Array.isArray(v)) {
    if (v.length === 0) return `${pad}[]\n`
    return v
      .map((item) => {
        if (item !== null && typeof item === 'object' && !isFlat(item) && !Array.isArray(item)) {
          const body = toYaml(item, indent + 2)
          return `${pad}- ${body.slice(indent + 2)}`
        }
        return `${pad}- ${flowOut(item)}\n`
      })
      .join('')
  }
  if (v !== null && typeof v === 'object') {
    return Object.entries(v)
      .map(([k, x]) => {
        if (x !== null && typeof x === 'object' && (Array.isArray(x) ? x.length > 0 : Object.keys(x).length > 0)) {
          if (!Array.isArray(x) && isFlat(x) && Object.keys(x).length <= 4) return `${pad}${scalarOut(k)}: ${flowOut(x)}\n`
          return `${pad}${scalarOut(k)}:\n${toYaml(x, Array.isArray(x) ? indent + 2 : indent + 2)}`
        }
        return `${pad}${scalarOut(k)}: ${flowOut(x)}\n`
      })
      .join('')
  }
  return `${pad}${scalarOut(v)}\n`
}
