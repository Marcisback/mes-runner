import type { SVGProps } from 'react'

/**
 * Project-local SVG icons. No icon library is used. Icons are decorative by
 * default (`aria-hidden`); accessible names come from the labelled controls
 * that contain them. Size defaults to 20px and inherits `currentColor`.
 */
type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 20, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export function DashboardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </Icon>
  )
}

export function LogsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 4.5h14" />
      <path d="M5 9h14" />
      <path d="M5 13.5h9" />
      <path d="M5 18h11" />
    </Icon>
  )
}

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v2.6M12 18.9v2.6M4.2 4.2l1.9 1.9M17.9 17.9l1.9 1.9M2.5 12h2.6M18.9 12h2.6M4.2 19.8l1.9-1.9M17.9 6.1l1.9-1.9" />
    </Icon>
  )
}

export function PlusCircleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8.5v7M8.5 12h7" />
    </Icon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  )
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.2l2.3 2.3 4.7-4.9" />
    </Icon>
  )
}

export function XCircleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" />
    </Icon>
  )
}

export function InfoCircleIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <path d="M12 7.8h.01" />
    </Icon>
  )
}

export function WarningIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.8L21 19H3z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </Icon>
  )
}

export function MaximizeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9" />
      <path d="M20 9V5.5A1.5 1.5 0 0 0 18.5 4H15" />
      <path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20H9" />
      <path d="M20 15v3.5A1.5 1.5 0 0 1 18.5 20H15" />
    </Icon>
  )
}

export function DiagnosticsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h3l2.5-6 4 13 2.5-7H21" />
    </Icon>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 5l7 7-7 7" />
    </Icon>
  )
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 15l7-7 7 7" />
    </Icon>
  )
}

/** Browser window with a "disabled" badge — used for the MES-offline state. */
export function StreamOfflineIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4.5" width="18" height="14" rx="2" />
      <path d="M3 8.5h18" />
      <circle cx="6" cy="6.5" r="0.4" />
      <circle cx="8" cy="6.5" r="0.4" />
      <circle cx="10" cy="6.5" r="0.4" />
      <circle cx="15" cy="14" r="4" />
      <path d="M12.2 16.8l5.6-5.6" />
    </Icon>
  )
}
