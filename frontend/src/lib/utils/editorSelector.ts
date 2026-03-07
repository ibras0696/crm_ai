import type { DocsFile } from '@/lib/api'
import type { EditorType } from '@/lib/types/editors'

/**
 * Determine which editor to use for a file
 */
export function selectEditor(file: DocsFile): EditorType {
  if (file.type === 'pdf') {
    return 'pdf'
  }

  if (file.type === 'docx') {
    // Always use custom editor for DOCX
    return 'docx'
  }

  if (file.type === 'txt') {
    return 'monaco'
  }

  return 'monaco'
}

/**
 * Check if file can be edited
 */
export function canEditFile(file: DocsFile): boolean {
  if (file.status !== 'ready') {
    return false
  }

  return ['txt', 'pdf', 'docx'].includes(file.type || '')
}

/**
 * Get editor display name
 */
export function getEditorName(editorType: EditorType): string {
  switch (editorType) {
    case 'pdf':
      return 'PDF Editor'
    case 'docx':
      return 'Word Editor'
    case 'txt':
    case 'monaco':
      return 'Text Editor'
    default:
      return 'Editor'
  }
}

/**
 * Check if editor supports collaboration
 */
export function supportsCollaboration(editorType: EditorType): boolean {
  // Future: enable collaboration for all editors
  return editorType === 'monaco' || editorType === 'docx'
}
