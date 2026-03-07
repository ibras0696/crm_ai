import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function BaseIcon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export function SaShieldIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 3 19 6v6c0 4.7-2.8 7.9-7 9-4.2-1.1-7-4.3-7-9V6l7-3Z" />
      <path d="m9.5 12 1.8 1.8 3.2-3.2" />
    </BaseIcon>
  )
}

export function SaDashboardIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="3" y="3" width="8" height="8" rx="2" />
      <rect x="13" y="3" width="8" height="5" rx="2" />
      <rect x="13" y="10" width="8" height="11" rx="2" />
      <rect x="3" y="13" width="8" height="8" rx="2" />
    </BaseIcon>
  )
}

export function SaOrganizationsIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 20V10l8-4 8 4v10" />
      <path d="M9 20v-5h6v5" />
      <path d="M12 6V3" />
    </BaseIcon>
  )
}

export function SaTablesIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 9v11M14 9v11" />
    </BaseIcon>
  )
}

export function SaUsersIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19c0-2.8 2.7-5 6-5s6 2.2 6 5" />
      <path d="M16 8a2.5 2.5 0 1 1 0 5" />
      <path d="M17.5 19c-.1-1.9-1.2-3.5-3-4.4" />
    </BaseIcon>
  )
}

export function SaAuditIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 3 19 6v6c0 4.7-2.8 7.9-7 9-4.2-1.1-7-4.3-7-9V6l7-3Z" />
      <path d="M9 12h6M9 15h4" />
      <path d="M9 9h6" />
    </BaseIcon>
  )
}

export function SaAiIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M8 3v3M16 3v3M8 18v3M16 18v3M3 8h3M18 8h3M3 16h3M18 16h3" />
      <rect x="7" y="7" width="10" height="10" rx="2.5" />
      <path d="M10 11h4M10 14h4" />
    </BaseIcon>
  )
}

export function SaBillingIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <path d="M3 10h18" />
      <circle cx="8" cy="14" r="1" />
      <path d="M13 14h5" />
    </BaseIcon>
  )
}

export function SaProfileIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <circle cx="12" cy="9" r="2.5" />
      <path d="M8.5 16c.8-1.5 2-2.3 3.5-2.3s2.7.8 3.5 2.3" />
    </BaseIcon>
  )
}
