import { useCallback, useEffect, useRef, useState } from 'react'
import { useDataChannel, useLocalParticipant } from '@livekit/components-react'
import { X, PaperPlaneTilt } from '@phosphor-icons/react'

interface ChatMessage {
  text: string
  from: string
  timestamp: number
  isLocal: boolean
}

interface Props {
  onClose: () => void
}

export function InCallChat({ onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const { localParticipant } = useLocalParticipant()
  const bottomRef = useRef<HTMLDivElement>(null)

  const { send } = useDataChannel('in-call-chat', (msg) => {
    try {
      const text = new TextDecoder().decode(msg.payload)
      const parsed = JSON.parse(text) as { text: string; from: string; timestamp: number }
      setMessages((prev) => [
        ...prev,
        { ...parsed, isLocal: parsed.from === localParticipant.identity },
      ])
    } catch {
      // ignore parse errors
    }
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed) return

    const payload = JSON.stringify({
      text: trimmed,
      from: localParticipant.identity,
      timestamp: Date.now(),
    })
    const encoder = new TextEncoder()
    send(encoder.encode(payload), { reliable: true })

    setMessages((prev) => [
      ...prev,
      { text: trimmed, from: localParticipant.identity, timestamp: Date.now(), isLocal: true },
    ])
    setInput('')
  }, [input, localParticipant.identity, send])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="w-72 flex flex-col bg-card border-l border-border h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Чат звонка</h3>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-thin">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center mt-8">Сообщений пока нет</p>
        )}
        {messages.map((msg) => (
          <div key={`${msg.timestamp}-${msg.from}`} className={`flex flex-col ${msg.isLocal ? 'items-end' : 'items-start'}`}>
            {!msg.isLocal && (
              <span className="text-[10px] text-muted-foreground mb-0.5 px-1">{msg.from}</span>
            )}
            <div
              className={`max-w-[90%] px-3 py-2 rounded-2xl text-sm ${
                msg.isLocal
                  ? 'bg-primary text-primary-foreground rounded-br-sm'
                  : 'bg-muted text-foreground rounded-bl-sm'
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 p-3 border-t border-border">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Сообщение..."
          className="flex-1 bg-background border border-input rounded-xl px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:border-ring transition-colors"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim()}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-primary-foreground transition-colors"
        >
          <PaperPlaneTilt size={14} weight="fill" />
        </button>
      </div>
    </div>
  )
}
