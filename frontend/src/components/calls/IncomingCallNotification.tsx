import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Phone, PhoneDisconnect } from '@phosphor-icons/react'
import { useNotificationsWS } from '../../hooks/useNotificationsWS'

interface IncomingCall {
  roomSlug: string
  roomTitle: string | null
  hostId: string
}

export function IncomingCallNotification() {
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null)
  const navigate = useNavigate()

  const handleEvent = useCallback((event: Record<string, unknown>) => {
    if (event.type === 'call.incoming') {
      setIncomingCall({
        roomSlug: event.room_slug as string,
        roomTitle: (event.room_title as string | null) ?? null,
        hostId: event.host_id as string,
      })
    }
  }, [])

  useNotificationsWS(handleEvent)

  if (!incomingCall) return null

  const handleAccept = () => {
    navigate(`/calls?slug=${incomingCall.roomSlug}`)
    setIncomingCall(null)
  }

  const handleDecline = () => {
    setIncomingCall(null)
  }

  return (
    <div className="fixed top-4 right-4 z-[200] w-80 rounded-2xl bg-gray-900 border border-gray-700 shadow-2xl p-4 animate-in slide-in-from-top-2 fade-in duration-300">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 animate-pulse">
          <Phone size={20} weight="fill" className="text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Входящий звонок</p>
          <p className="text-xs text-gray-400 truncate mt-0.5">
            {incomingCall.roomTitle ?? 'Звонок'}
          </p>
        </div>
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={handleDecline}
          className="flex flex-1 items-center justify-center gap-2 py-2 rounded-full bg-gray-700 hover:bg-gray-600 text-white text-sm transition-colors"
        >
          <PhoneDisconnect size={16} weight="fill" />
          Отклонить
        </button>
        <button
          onClick={handleAccept}
          className="flex flex-1 items-center justify-center gap-2 py-2 rounded-full bg-green-600 hover:bg-green-500 text-white text-sm transition-colors"
        >
          <Phone size={16} weight="fill" />
          Принять
        </button>
      </div>
    </div>
  )
}
