import type { ReactNode } from 'react'

const URL_RE = /https?:\/\/[^\s<]+/gi
const EXCLUDED_TAGS = new Set(['a', 'code', 'pre', 'script', 'style'])

function splitUrlAndTrailingPunctuation(raw: string): { url: string; trailing: string } {
  let url = raw
  let trailing = ''

  while (url.length > 0) {
    const last = url[url.length - 1]
    if (!last) break
    if (!'.,!?;:)'.includes(last)) break

    // Keep balanced closing parenthesis as part of URL when needed.
    if (last === ')') {
      const openCount = (url.match(/\(/g) || []).length
      const closeCount = (url.match(/\)/g) || []).length
      if (closeCount <= openCount) break
    }

    trailing = last + trailing
    url = url.slice(0, -1)
  }

  return { url, trailing }
}

export function linkifyTextToNodes(
  text: string,
  anchorClassName = 'text-primary underline underline-offset-2 hover:text-primary/80 break-all',
): ReactNode[] {
  if (!text) return ['']

  const nodes: ReactNode[] = []
  const regex = new RegExp(URL_RE.source, URL_RE.flags)
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const raw = match[0]
    const start = match.index
    const { url, trailing } = splitUrlAndTrailingPunctuation(raw)

    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start))
    }

    nodes.push(
      <a
        key={`link-${start}-${url}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={anchorClassName}
      >
        {url}
      </a>,
    )

    if (trailing) {
      nodes.push(trailing)
    }

    lastIndex = start + raw.length
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex))
  }

  return nodes
}

function shouldSkipTextNode(node: Text): boolean {
  let el = node.parentElement
  while (el) {
    if (EXCLUDED_TAGS.has(el.tagName.toLowerCase())) return true
    el = el.parentElement
  }
  return false
}

export function linkifyHtmlContent(
  html: string,
  anchorClassName = 'text-primary underline hover:text-primary/80 break-all',
): string {
  if (!html || typeof document === 'undefined') return html

  const template = document.createElement('template')
  template.innerHTML = html
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []

  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const value = node.nodeValue || ''
    if (!value) continue
    if (shouldSkipTextNode(node)) continue
    URL_RE.lastIndex = 0
    if (!URL_RE.test(value)) continue
    textNodes.push(node)
  }

  for (const node of textNodes) {
    const value = node.nodeValue || ''
    const regex = new RegExp(URL_RE.source, URL_RE.flags)
    let lastIndex = 0
    let match: RegExpExecArray | null
    const frag = document.createDocumentFragment()

    while ((match = regex.exec(value)) !== null) {
      const raw = match[0]
      const start = match.index
      const { url, trailing } = splitUrlAndTrailingPunctuation(raw)

      if (start > lastIndex) {
        frag.appendChild(document.createTextNode(value.slice(lastIndex, start)))
      }

      const link = document.createElement('a')
      link.href = url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.className = anchorClassName
      link.textContent = url
      frag.appendChild(link)

      if (trailing) {
        frag.appendChild(document.createTextNode(trailing))
      }

      lastIndex = start + raw.length
    }

    if (lastIndex < value.length) {
      frag.appendChild(document.createTextNode(value.slice(lastIndex)))
    }

    node.replaceWith(frag)
  }

  return template.innerHTML
}

