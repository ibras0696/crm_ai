// Core
export { default } from './core/client'
export * from './core/types'

// Auth domain: authApi, profileApi, UserInfo, TokenResponse, ...
export * from './auth'

// Org domain: orgApi, auditApi, accessApi, notificationsApi, OrgInfo, MemberInfo, ...
export * from './org'

// Data domain: tablesApi, recordsApi, filesApi, TableInfo, ColumnInfo, RecordInfo, ...
export * from './data'

// Feature domains: aiApi, knowledgeApi, scheduleApi, reportsApi, billingApi, ...
export * from './features'

// Superadmin domain (separate auth context)
export * from './superadmin'
