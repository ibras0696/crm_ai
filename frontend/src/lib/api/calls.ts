import api from './core/client'

export interface RecordingStatusOut {
  room_slug: string
  recording_enabled: boolean
  egress_id: string | null
  recording_file_key: string | null
  presigned_url: string | null
}

export interface RoomOut {
  id: string
  slug: string
  title: string | null
  status: 'waiting' | 'active' | 'ended'
  host_id: string
  max_participants: number
  created_at: string
  started_at: string | null
  ended_at: string | null
}

export interface JoinRoomResponse {
  livekit_token: string
  livekit_url: string
  room: RoomOut
}

export interface CreateRoomRequest {
  title?: string
  max_participants?: number
}

export interface CallHistoryOut {
  id: string
  slug: string
  title: string | null
  status: 'waiting' | 'active' | 'ended'
  host_id: string
  started_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  participant_count: number
  my_role: 'host' | 'cohost' | 'participant'
  my_duration_seconds: number | null
  created_at: string
}

export const callsApi = {
  createRoom: (data: CreateRoomRequest) =>
    api.post<{ ok: boolean; data: RoomOut }>('/calls/rooms', data),

  getRoom: (slug: string) =>
    api.get<{ ok: boolean; data: RoomOut }>(`/calls/rooms/${slug}`),

  joinRoom: (slug: string) =>
    api.post<{ ok: boolean; data: JoinRoomResponse }>(`/calls/rooms/${slug}/join`, {}),

  leaveRoom: (slug: string) =>
    api.post<{ ok: boolean }>(`/calls/rooms/${slug}/leave`, {}),

  deleteRoom: (slug: string) =>
    api.delete<{ ok: boolean }>(`/calls/rooms/${slug}`),

  listRooms: () =>
    api.get<{ ok: boolean; data: RoomOut[] }>('/calls/rooms'),

  getHistory: (params?: { limit?: number; offset?: number }) =>
    api.get<{ ok: boolean; data: CallHistoryOut[] }>('/calls/history', { params }),

  inviteToRoom: (slug: string, userIds: string[]) =>
    api.post<{ ok: boolean }>(`/calls/rooms/${slug}/invite`, { user_ids: userIds }),

  startRecording: (slug: string) =>
    api.post<{ ok: boolean; data: RecordingStatusOut }>(`/calls/rooms/${slug}/recording/start`, {}),

  stopRecording: (slug: string) =>
    api.post<{ ok: boolean; data: RecordingStatusOut }>(`/calls/rooms/${slug}/recording/stop`, {}),

  getRecording: (slug: string) =>
    api.get<{ ok: boolean; data: RecordingStatusOut }>(`/calls/rooms/${slug}/recording`),

  muteParticipant: (slug: string, identity: string, source: 'audio' | 'screenshare') =>
    api.post<{ ok: boolean }>(`/calls/rooms/${slug}/participants/${encodeURIComponent(identity)}/mute`, { source }),
}
