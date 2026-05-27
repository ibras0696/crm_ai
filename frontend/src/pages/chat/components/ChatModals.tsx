import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { X } from 'lucide-react'
import { chatTypeLabel, getInitials } from '../chatHelpers'

export function ChatModals(props: Record<string, unknown>) {
  const {
    createChatOpen,
    setCreateChatOpen,
    newChatType,
    setNewChatType,
    setNewChatTitle,
    setSelectedMemberIds,
    newChatTitle,
    members,
    user,
    selectedMemberIds,
    handleToggleMember,
    creatingChat,
    handleCreateChat,
    addMemberOpen,
    selectedChat,
    canManageMembers,
    setAddMemberOpen,
    addableChatMembers,
    addingMemberUserId,
    setAddingMemberUserId,
    addingMember,
    handleAddMemberToSelectedChat,
    deleteChatConfirmOpen,
    setDeleteChatConfirmOpen,
    canDeleteSelectedChat,
    deletingChat,
    selectedChatTitle,
    handleDeleteSelectedChat,
    profileModalOpen,
    setProfileModalOpen,
    selectedProfileUser,
    groupCardOpen,
    setGroupCardOpen,
    canOpenGroupCard,
    selectedChatMembers,
    selectedChatAdmins,
    selectedChatCreatedByLabel,
  } = props as any

  return (
    <>
      {createChatOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setCreateChatOpen(false)}>
          <Card
            role="dialog"
            aria-modal="true"
            aria-label="Создание чата"
            className="w-full max-w-xl border-border/60"
            onClick={(e) => e.stopPropagation()}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">Создать чат</CardTitle>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setCreateChatOpen(false)}
                aria-label="Закрыть окно создания чата"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Тип</label>
                <select
                  value={newChatType}
                  onChange={(e) => {
                    const value = e.target.value as 'direct' | 'group' | 'channel'
                    setNewChatType(value)
                    if (value === 'direct') {
                      setNewChatTitle('')
                      setSelectedMemberIds((prev: string[]) => prev.slice(0, 1))
                    }
                  }}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  <option value="group">Группа</option>
                  <option value="direct">Личный чат</option>
                  <option value="channel">Канал</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Название</label>
                <Input
                  value={newChatTitle}
                  onChange={(e) => setNewChatTitle(e.target.value)}
                  placeholder={newChatType === 'direct' ? 'Для личного чата не обязательно' : 'Название чата'}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground">
                  Участники {newChatType === 'direct' ? '(выберите одного)' : '(опционально)'}
                </label>
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-border/60 p-2">
                  {members
                    .filter((m: any) => m.user_id !== user?.id)
                    .map((m: any) => {
                      const caption = `${m.user_first_name || ''} ${m.user_last_name || ''}`.trim() || m.user_email || m.user_id
                      const checked = selectedMemberIds.includes(m.user_id)
                      return (
                        <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/40">
                          <input
                            type={newChatType === 'direct' ? 'radio' : 'checkbox'}
                            name={newChatType === 'direct' ? 'direct-chat-member' : undefined}
                            checked={checked}
                            onChange={() => handleToggleMember(m.user_id)}
                          />
                          <span className="truncate">{caption}</span>
                        </label>
                      )
                    })}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setCreateChatOpen(false)} disabled={creatingChat}>
                  Отмена
                </Button>
                <Button type="button" onClick={handleCreateChat} disabled={creatingChat}>
                  {creatingChat ? 'Создание...' : 'Создать чат'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {addMemberOpen && selectedChat && canManageMembers && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setAddMemberOpen(false)}>
          <Card
            role="dialog"
            aria-modal="true"
            aria-label="Добавление участника"
            className="w-full max-w-lg border-border/60"
            onClick={(event) => event.stopPropagation()}
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base">Добавить участника</CardTitle>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setAddMemberOpen(false)}
                aria-label="Закрыть окно добавления участника"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {addableChatMembers.length === 0 ? (
                <div className="rounded-md border border-border/60 p-3 text-sm text-muted-foreground">
                  Все участники организации уже в этом чате.
                </div>
              ) : (
                <>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Новый участник</label>
                    <select
                      value={addingMemberUserId}
                      onChange={(event) => setAddingMemberUserId(event.target.value)}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Выберите участника</option>
                      {addableChatMembers.map((member: any) => {
                        const caption = `${member.user_first_name || ''} ${member.user_last_name || ''}`.trim() || member.user_email || member.user_id
                        return (
                          <option key={member.id} value={member.user_id}>
                            {caption}
                          </option>
                        )
                      })}
                    </select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setAddMemberOpen(false)} disabled={addingMember}>
                      Отмена
                    </Button>
                    <Button
                      type="button"
                      onClick={() => void handleAddMemberToSelectedChat()}
                      disabled={!addingMemberUserId || addingMember}
                    >
                      {addingMember ? 'Добавление...' : 'Добавить'}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {deleteChatConfirmOpen && selectedChat && canDeleteSelectedChat && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => !deletingChat && setDeleteChatConfirmOpen(false)}>
          <Card
            role="dialog"
            aria-modal="true"
            aria-label="Подтверждение удаления чата"
            className="w-full max-w-md border-border/60"
            onClick={(event) => event.stopPropagation()}
          >
            <CardHeader className="space-y-2 pb-2">
              <CardTitle className="text-base">Удалить чат?</CardTitle>
              <p className="text-sm text-muted-foreground">
                Чат <span className="font-medium text-foreground">«{selectedChatTitle || 'Без названия'}»</span> будет удалён вместе с сообщениями и медиа. Это действие нельзя отменить.
              </p>
            </CardHeader>
            <CardContent className="flex justify-end gap-2 pt-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeleteChatConfirmOpen(false)}
                disabled={deletingChat}
              >
                Отмена
              </Button>
              <Button
                type="button"
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => void handleDeleteSelectedChat()}
                disabled={deletingChat}
              >
                {deletingChat ? 'Удаление...' : 'Удалить'}
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {profileModalOpen && selectedProfileUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setProfileModalOpen(false)}>
          <Card
            role="dialog"
            aria-modal="true"
            aria-label="Профиль пользователя"
            className="w-full max-w-md border-border/60"
            onClick={(event) => event.stopPropagation()}
          >
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
              <div className="space-y-1">
                <CardTitle className="text-base">Профиль пользователя</CardTitle>
                <p className="text-xs text-muted-foreground">Информация об участнике чата</p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setProfileModalOpen(false)}
                aria-label="Закрыть профиль пользователя"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Avatar className="h-12 w-12 border border-border/70">
                  <AvatarImage src={selectedProfileUser.avatarUrl || undefined} alt={selectedProfileUser.label} />
                  <AvatarFallback className="bg-muted/25 text-xs font-semibold">
                    {getInitials(selectedProfileUser.label).slice(0, 2)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{selectedProfileUser.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{selectedProfileUser.email || 'Email не указан'}</div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 text-sm">
                <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Роль в организации</div>
                  <div className="mt-0.5 font-medium">{selectedProfileUser.orgRoleLabel}</div>
                </div>
                <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Статус в чате</div>
                  <div className="mt-0.5 font-medium">{selectedProfileUser.online ? 'Онлайн' : 'Оффлайн'}</div>
                </div>
                <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">ID пользователя</div>
                  <div className="mt-0.5 break-all text-xs">{selectedProfileUser.userId}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {groupCardOpen && selectedChat && canOpenGroupCard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setGroupCardOpen(false)}>
          <Card
            role="dialog"
            aria-modal="true"
            aria-label="Карточка группы"
            className="w-full max-w-xl border-border/60"
            onClick={(event) => event.stopPropagation()}
          >
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
              <div className="space-y-1">
                <CardTitle className="text-base">Карточка группы</CardTitle>
                <p className="text-xs text-muted-foreground">Участники и основные метаданные чата</p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => setGroupCardOpen(false)}
                aria-label="Закрыть карточку группы"
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Название</div>
                  <div className="mt-0.5 font-medium">{selectedChatTitle || 'Без названия'}</div>
                </div>
                <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Тип</div>
                  <div className="mt-0.5 font-medium">{chatTypeLabel(selectedChat.chat_type)}</div>
                </div>
                <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Участники</div>
                  <div className="mt-0.5 font-medium">{selectedChatMembers.length}</div>
                </div>
                <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">Админы</div>
                  <div className="mt-0.5 font-medium">{selectedChatAdmins.length}</div>
                </div>
              </div>

              <div className="rounded-md border border-border/60 bg-background/40 px-3 py-2 text-sm">
                <div className="text-[11px] text-muted-foreground">Создал чат</div>
                <div className="mt-0.5">{selectedChatCreatedByLabel || selectedChat.created_by}</div>
              </div>

              <div className="space-y-2">
                <div className="text-xs text-muted-foreground">Состав участников</div>
                <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border/60 p-2">
                  {selectedChatMembers.map((member: any) => (
                    <div key={member.userId} className="flex items-center justify-between gap-2 rounded px-1 py-1.5 text-sm hover:bg-muted/35">
                      <div className="flex min-w-0 items-center gap-2">
                        <Avatar className="h-7 w-7 border border-border/70">
                          <AvatarImage src={member.avatarUrl || undefined} alt={member.label} />
                          <AvatarFallback className="bg-muted/25 text-[10px] font-semibold">{member.initials}</AvatarFallback>
                        </Avatar>
                        <span className="truncate">{member.label}</span>
                      </div>
                      <span className={`text-[11px] ${member.online ? 'text-emerald-400' : 'text-muted-foreground'}`}>
                        {member.online ? 'онлайн' : 'оффлайн'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
