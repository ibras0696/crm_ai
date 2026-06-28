import type { ChatInfo, ChatMemberInfo, ChatMessageInfo } from '@/lib/api'

const DB_NAME = 'crm-chat-cache'
const DB_VERSION = 1
const CHATS_STORE = 'chats'
const MESSAGES_STORE = 'messages'
const MEMBERS_STORE = 'members'
const MAX_CACHED_MESSAGES_PER_CHAT = 300

interface CachedChatsRecord {
  scope: string
  chats: ChatInfo[]
  updatedAt: number
}

interface CachedMessagesRecord {
  key: string
  scope: string
  chatId: string
  messages: ChatMessageInfo[]
  updatedAt: number
}

interface CachedMembersRecord {
  key: string
  scope: string
  chatId: string
  members: ChatMemberInfo[]
  updatedAt: number
}

export interface CachedChatState {
  messages: ChatMessageInfo[]
  members: ChatMemberInfo[]
}

let dbPromise: Promise<IDBDatabase | null> | null = null

export function createChatCacheScope(userId: string | undefined, orgId: string | undefined): string | null {
  if (!userId || !orgId) return null
  return `${orgId}:${userId}`
}

function chatKey(scope: string, chatId: string): string {
  return `${scope}:${chatId}`
}

function sortMessages(messages: ChatMessageInfo[]): ChatMessageInfo[] {
  return [...messages].sort((a, b) => {
    if (a.seq_no !== b.seq_no) return a.seq_no - b.seq_no
    return Date.parse(a.created_at) - Date.parse(b.created_at)
  })
}

function normalizeMessages(messages: ChatMessageInfo[]): ChatMessageInfo[] {
  const byId = new Map<string, ChatMessageInfo>()
  for (const message of messages) {
    byId.set(message.id, message)
  }
  const sorted = sortMessages(Array.from(byId.values()))
  return sorted.slice(Math.max(0, sorted.length - MAX_CACHED_MESSAGES_PER_CHAT))
}

function openChatCacheDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) return Promise.resolve(null)
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(CHATS_STORE)) {
        db.createObjectStore(CHATS_STORE, { keyPath: 'scope' })
      }
      if (!db.objectStoreNames.contains(MESSAGES_STORE)) {
        db.createObjectStore(MESSAGES_STORE, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(MEMBERS_STORE)) {
        db.createObjectStore(MEMBERS_STORE, { keyPath: 'key' })
      }
    }

    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })

  return dbPromise
}

async function readRecord<T>(storeName: string, key: string): Promise<T | null> {
  const db = await openChatCacheDb()
  if (!db) return null

  return new Promise((resolve) => {
    const tx = db.transaction(storeName, 'readonly')
    const request = tx.objectStore(storeName).get(key)
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null)
    request.onerror = () => resolve(null)
    tx.onerror = () => resolve(null)
  })
}

async function writeRecord<T>(storeName: string, value: T): Promise<void> {
  const db = await openChatCacheDb()
  if (!db) return

  await new Promise<void>((resolve) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).put(value)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}

async function deleteRecord(storeName: string, key: string): Promise<void> {
  const db = await openChatCacheDb()
  if (!db) return

  await new Promise<void>((resolve) => {
    const tx = db.transaction(storeName, 'readwrite')
    tx.objectStore(storeName).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
    tx.onabort = () => resolve()
  })
}

export async function loadCachedChats(scope: string): Promise<ChatInfo[]> {
  const cached = await readRecord<CachedChatsRecord>(CHATS_STORE, scope)
  return cached?.chats ?? []
}

export async function saveCachedChats(scope: string, chats: ChatInfo[]): Promise<void> {
  await writeRecord<CachedChatsRecord>(CHATS_STORE, {
    scope,
    chats,
    updatedAt: Date.now(),
  })
}

export async function loadCachedChatState(scope: string, chatId: string): Promise<CachedChatState> {
  const key = chatKey(scope, chatId)
  const [messagesRecord, membersRecord] = await Promise.all([
    readRecord<CachedMessagesRecord>(MESSAGES_STORE, key),
    readRecord<CachedMembersRecord>(MEMBERS_STORE, key),
  ])
  return {
    messages: messagesRecord?.messages ?? [],
    members: membersRecord?.members ?? [],
  }
}

export async function saveCachedChatMessages(scope: string, chatId: string, messages: ChatMessageInfo[]): Promise<void> {
  await writeRecord<CachedMessagesRecord>(MESSAGES_STORE, {
    key: chatKey(scope, chatId),
    scope,
    chatId,
    messages: normalizeMessages(messages),
    updatedAt: Date.now(),
  })
}

export async function saveCachedChatMembers(scope: string, chatId: string, members: ChatMemberInfo[]): Promise<void> {
  await writeRecord<CachedMembersRecord>(MEMBERS_STORE, {
    key: chatKey(scope, chatId),
    scope,
    chatId,
    members,
    updatedAt: Date.now(),
  })
}

export async function deleteCachedChat(scope: string, chatId: string): Promise<void> {
  const key = chatKey(scope, chatId)
  await Promise.all([
    deleteRecord(MESSAGES_STORE, key),
    deleteRecord(MEMBERS_STORE, key),
  ])
}
