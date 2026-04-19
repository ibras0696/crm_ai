#!/usr/bin/env node
/* eslint-env node */
import fs from 'node:fs'
import path from 'node:path'

const CYRILLIC_RE = /[А-Яа-яЁё]/
const STRING_LITERAL_RE = /(['"`])((?:\\.|(?!\1).)*)\1/g
const JSX_TEXT_RE = />[^<>{}]*[А-Яа-яЁё][^<>{}]*</

function parseArgs(argv) {
  const args = { root: 'src', whitelist: 'scripts/i18n_hardcoded_whitelist.txt' }
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === '--root' && argv[i + 1]) {
      args.root = argv[i + 1]
      i += 1
      continue
    }
    if (token === '--whitelist' && argv[i + 1]) {
      args.whitelist = argv[i + 1]
      i += 1
      continue
    }
  }
  return args
}

function loadWhitelist(filePath) {
  if (!fs.existsSync(filePath)) return new Set()
  const raw = fs.readFileSync(filePath, 'utf8')
  const rows = raw.split(/\r?\n/).map((line) => line.trim())
  return new Set(rows.filter((line) => line && !line.startsWith('#')))
}

function collectFiles(rootDir) {
  const result = []
  const stack = [rootDir]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(absolute)
        continue
      }
      if (!entry.isFile()) continue
      if (!absolute.endsWith('.ts') && !absolute.endsWith('.tsx')) continue
      if (absolute.endsWith('.d.ts')) continue
      result.push(absolute)
    }
  }
  return result.sort()
}

function shouldScanFile(relativePath, text) {
  if (relativePath.includes('/i18n/')) return false
  if (!(text.includes('useTranslation') || /\bt\(\s*['"`]/.test(text))) return false
  return true
}

function lineHasHardcodedText(line) {
  if (!CYRILLIC_RE.test(line)) return false
  const trimmed = line.trim()
  if (!trimmed) return false
  if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return false
  if (trimmed.includes('i18n-hardcoded-ignore-line')) return false

  STRING_LITERAL_RE.lastIndex = 0
  let match
  while ((match = STRING_LITERAL_RE.exec(line)) !== null) {
    const value = match[2]
    if (CYRILLIC_RE.test(value)) {
      return true
    }
  }
  return JSX_TEXT_RE.test(line)
}

function scanFile(relativePath, absolutePath) {
  const text = fs.readFileSync(absolutePath, 'utf8')
  if (!shouldScanFile(relativePath, text)) return []
  const findings = []
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!lineHasHardcodedText(line)) continue
    findings.push({
      line: index + 1,
      preview: line.trim().slice(0, 180),
    })
  }
  return findings
}

function main() {
  const { root, whitelist } = parseArgs(process.argv)
  const rootDir = path.resolve(process.cwd(), root)
  const whitelistPath = path.resolve(process.cwd(), whitelist)
  const allowed = loadWhitelist(whitelistPath)

  const files = collectFiles(rootDir)
  const violations = []
  for (const absolute of files) {
    const relative = path.relative(process.cwd(), absolute).replaceAll(path.sep, '/')
    const findings = scanFile(relative, absolute)
    if (findings.length === 0) continue
    if (!allowed.has(relative)) {
      violations.push({ file: relative, findings })
    }
  }

  if (violations.length > 0) {
    console.error('i18n hardcoded text audit failed. Files with non-whitelisted hardcoded Cyrillic text:')
    for (const violation of violations) {
      console.error(`- ${violation.file}`)
      for (const finding of violation.findings.slice(0, 5)) {
        console.error(`  L${finding.line}: ${finding.preview}`)
      }
      if (violation.findings.length > 5) {
        console.error(`  ... and ${violation.findings.length - 5} more`)
      }
    }
    console.error('\nIf this is intentional debt, add file path to whitelist:')
    console.error(`  ${path.relative(process.cwd(), whitelistPath).replaceAll(path.sep, '/')}`)
    process.exit(1)
  }

  console.log('i18n hardcoded text audit passed.')
}

main()
