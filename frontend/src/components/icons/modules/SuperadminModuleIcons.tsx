import type { ComponentProps, SVGProps } from 'react'
import {
  Bot,
  Building2,
  CreditCard,
  History,
  LayoutDashboard,
  Shield,
  Table2,
  User,
  Users,
} from 'lucide-react'

type IconProps = SVGProps<SVGSVGElement>

function toLucideProps(props: IconProps) {
  return props as unknown as ComponentProps<typeof Shield>
}

export function SaShieldIcon(props: IconProps) {
  return <Shield {...toLucideProps(props)} />
}

export function SaDashboardIcon(props: IconProps) {
  return <LayoutDashboard {...toLucideProps(props)} />
}

export function SaOrganizationsIcon(props: IconProps) {
  return <Building2 {...toLucideProps(props)} />
}

export function SaTablesIcon(props: IconProps) {
  return <Table2 {...toLucideProps(props)} />
}

export function SaUsersIcon(props: IconProps) {
  return <Users {...toLucideProps(props)} />
}

export function SaAuditIcon(props: IconProps) {
  return <History {...toLucideProps(props)} />
}

export function SaAiIcon(props: IconProps) {
  return <Bot {...toLucideProps(props)} />
}

export function SaBillingIcon(props: IconProps) {
  return <CreditCard {...toLucideProps(props)} />
}

export function SaProfileIcon(props: IconProps) {
  return <User {...toLucideProps(props)} />
}
