export type EditorType = 'pdf' | 'docx' | 'txt' | 'monaco'

export interface Coords {
  x: number
  y: number
  width: number
  height: number
}

export interface PDFAnnotation {
  id: string
  type: 'text' | 'shape' | 'signature' | 'highlight' | 'stamp' | 'comment'
  page: number
  coords: Coords
  content?: string
  color?: string
  imageData?: string
  metadata?: Record<string, unknown>
  createdAt: string
  createdBy?: string
}

export interface PDFEditorState {
  currentPage: number
  totalPages: number
  zoom: number
  annotations: PDFAnnotation[]
  selectedTool: PDFTool | null
  isModified: boolean
}

export type PDFTool = 
  | 'select'
  | 'text'
  | 'highlight'
  | 'rectangle'
  | 'circle'
  | 'arrow'
  | 'signature'
  | 'stamp'
  | 'comment'

export interface DocxEditorState {
  content: string
  isModified: boolean
  wordCount: number
  characterCount: number
}

export interface CollaborationUser {
  id: string
  name: string
  color: string
  cursor?: {
    line: number
    column: number
  }
}

export interface CollaborationState {
  users: CollaborationUser[]
  isConnected: boolean
  roomId: string
}
