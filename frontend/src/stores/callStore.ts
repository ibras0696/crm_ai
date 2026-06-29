import { create } from 'zustand'

interface ChatMessage {
  text: string
  from: string
  timestamp: number
}

interface CallStore {
  isInCall: boolean
  currentRoomSlug: string | null
  isMicOn: boolean
  isCamOn: boolean
  isScreenSharing: boolean
  layout: 'grid' | 'spotlight'
  isChatOpen: boolean
  chatMessages: ChatMessage[]

  setInCall: (inCall: boolean, slug?: string) => void
  toggleMic: () => void
  toggleCam: () => void
  toggleScreenShare: () => void
  setLayout: (layout: 'grid' | 'spotlight') => void
  resetCall: () => void
  setIsChatOpen: (open: boolean) => void
  addChatMessage: (msg: ChatMessage) => void
}

export const useCallStore = create<CallStore>((set: (partial: Partial<CallStore> | ((s: CallStore) => Partial<CallStore>)) => void) => ({
  isInCall: false,
  currentRoomSlug: null,
  isMicOn: true,
  isCamOn: true,
  isScreenSharing: false,
  layout: 'grid',
  isChatOpen: false,
  chatMessages: [],

  setInCall: (inCall: boolean, slug?: string) => set({ isInCall: inCall, currentRoomSlug: slug ?? null }),
  toggleMic: () => set((s: CallStore) => ({ isMicOn: !s.isMicOn })),
  toggleCam: () => set((s: CallStore) => ({ isCamOn: !s.isCamOn })),
  toggleScreenShare: () => set((s: CallStore) => ({ isScreenSharing: !s.isScreenSharing })),
  setLayout: (layout: 'grid' | 'spotlight') => set({ layout }),
  resetCall: () =>
    set({ isInCall: false, currentRoomSlug: null, isMicOn: true, isCamOn: true, isScreenSharing: false, isChatOpen: false, chatMessages: [] }),
  setIsChatOpen: (open: boolean) => set({ isChatOpen: open }),
  addChatMessage: (msg: ChatMessage) => set((s: CallStore) => ({ chatMessages: [...s.chatMessages, msg] })),
}))
