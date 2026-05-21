import * as React from 'react'
import {
  AppWindow as PhAppWindow,
  ArrowClockwise as PhArrowClockwise,
  ArrowCounterClockwise as PhArrowCounterClockwise,
  ArrowDown as PhArrowDown,
  ArrowLeft as PhArrowLeft,
  ArrowRight as PhArrowRight,
  ArrowSquareOut as PhArrowSquareOut,
  ArrowUp as PhArrowUp,
  ArrowsDownUp as PhArrowsDownUp,
  ArrowsIn as PhArrowsIn,
  ArrowsOut as PhArrowsOut,
  Bell as PhBell,
  BellSlash as PhBellSlash,
  BookOpen as PhBookOpen,
  BookmarkSimple as PhBookmarkSimple,
  Brain as PhBrain,
  Buildings as PhBuildings,
  Calendar as PhCalendar,
  CalendarCheck as PhCalendarCheck,
  Camera as PhCamera,
  CaretDown as PhCaretDown,
  CaretLeft as PhCaretLeft,
  CaretRight as PhCaretRight,
  ChartBar as PhChartBar,
  ChartBarHorizontal as PhChartBarHorizontal,
  ChartDonut as PhChartDonut,
  ChartLine as PhChartLine,
  ChatCenteredText as PhChatCenteredText,
  ChatDots as PhChatDots,
  Check as PhCheck,
  CheckCircle as PhCheckCircle,
  Checks as PhChecks,
  Clock as PhClock,
  ClockCountdown as PhClockCountdown,
  ClockCounterClockwise as PhClockCounterClockwise,
  Code as PhCode,
  Columns as PhColumns,
  Copy as PhCopy,
  CreditCard as PhCreditCard,
  Crown as PhCrown,
  Cursor as PhCursor,
  Database as PhDatabase,
  DotsThree as PhDotsThree,
  Download as PhDownload,
  EnvelopeSimple as PhEnvelopeSimple,
  Eye as PhEye,
  EyeSlash as PhEyeSlash,
  FileIcon as PhFileIcon,
  FilePlus as PhFilePlus,
  FileText as PhFileText,
  FloppyDisk as PhFloppyDisk,
  Folder as PhFolder,
  FolderOpen as PhFolderOpen,
  FolderPlus as PhFolderPlus,
  Funnel as PhFunnel,
  Gauge as PhGauge,
  Gear as PhGear,
  Globe as PhGlobe,
  GridFour as PhGridFour,
  Hammer as PhHammer,
  HardDrive as PhHardDrive,
  Hash as PhHash,
  Image as PhImage,
  Kanban as PhKanban,
  Key as PhKey,
  Layout as PhLayout,
  Lightning as PhLightning,
  Link as PhLink,
  LinkSimple as PhLinkSimple,
  List as PhList,
  ListNumbers as PhListNumbers,
  Lock as PhLock,
  MagicWand as PhMagicWand,
  MagnifyingGlass as PhMagnifyingGlass,
  Microphone as PhMicrophone,
  Minus as PhMinus,
  Moon as PhMoon,
  PaperPlaneRight as PhPaperPlaneRight,
  PaperPlaneTilt as PhPaperPlaneTilt,
  Paperclip as PhPaperclip,
  Pause as PhPause,
  Pencil as PhPencil,
  PencilSimpleLine as PhPencilSimpleLine,
  Phone as PhPhone,
  Play as PhPlay,
  Plus as PhPlus,
  Pulse as PhPulse,
  Question as PhQuestion,
  Quotes as PhQuotes,
  Repeat as PhRepeat,
  Robot as PhRobot,
  SealCheck as PhSealCheck,
  Shield as PhShield,
  ShieldCheck as PhShieldCheck,
  ShieldWarning as PhShieldWarning,
  SidebarSimple as PhSidebarSimple,
  SignOut as PhSignOut,
  SlidersHorizontal as PhSlidersHorizontal,
  Smiley as PhSmiley,
  Sparkle as PhSparkle,
  SpinnerGap as PhSpinnerGap,
  Square as PhSquare,
  Stack as PhStack,
  Sun as PhSun,
  Table as PhTable,
  TextB as PhTextB,
  TextHOne as PhTextHOne,
  TextHThree as PhTextHThree,
  TextHTwo as PhTextHTwo,
  TextItalic as PhTextItalic,
  TextT as PhTextT,
  TextUnderline as PhTextUnderline,
  ToggleLeft as PhToggleLeft,
  Translate as PhTranslate,
  Trash as PhTrash,
  TrendUp as PhTrendUp,
  Upload as PhUpload,
  User as PhUser,
  UserGear as PhUserGear,
  UserPlus as PhUserPlus,
  Users as PhUsers,
  Video as PhVideo,
  Wallet as PhWallet,
  Warning as PhWarning,
  WarningCircle as PhWarningCircle,
  Wrench as PhWrench,
  X as PhX,
  XCircle as PhXCircle,
} from '@phosphor-icons/react'

export type LucideIconProps = React.SVGProps<SVGSVGElement> & {
  size?: number | string
  strokeWidth?: number
  absoluteStrokeWidth?: boolean
}

export type LucideIcon = React.ForwardRefExoticComponent<
  LucideIconProps & React.RefAttributes<SVGSVGElement>
>

type PhosphorIconComponent = React.ComponentType<any>

function createIcon(Comp: PhosphorIconComponent, displayName: string): LucideIcon {
  const Wrapped = React.forwardRef<SVGSVGElement, LucideIconProps>(function WrappedIcon(
    { className, size = 20, color, ...rest },
    ref,
  ) {
    return (
      <Comp
        ref={ref}
        className={className}
        size={size}
        color={color}
        weight="duotone"
        {...rest}
      />
    )
  })

  Wrapped.displayName = displayName
  return Wrapped
}

export const Activity = createIcon(PhPulse, 'Activity')
export const AlertCircle = createIcon(PhWarningCircle, 'AlertCircle')
export const AlertTriangle = createIcon(PhWarning, 'AlertTriangle')
export const ArrowDown = createIcon(PhArrowDown, 'ArrowDown')
export const ArrowLeft = createIcon(PhArrowLeft, 'ArrowLeft')
export const ArrowRight = createIcon(PhArrowRight, 'ArrowRight')
export const ArrowUp = createIcon(PhArrowUp, 'ArrowUp')
export const ArrowUpDown = createIcon(PhArrowsDownUp, 'ArrowUpDown')
export const BarChart2 = createIcon(PhChartBar, 'BarChart2')
export const BarChart3 = createIcon(PhChartBarHorizontal, 'BarChart3')
export const Bell = createIcon(PhBell, 'Bell')
export const BellOff = createIcon(PhBellSlash, 'BellOff')
export const Bold = createIcon(PhTextB, 'Bold')
export const BookMarked = createIcon(PhBookmarkSimple, 'BookMarked')
export const BookOpen = createIcon(PhBookOpen, 'BookOpen')
export const Bot = createIcon(PhRobot, 'Bot')
export const Brain = createIcon(PhBrain, 'Brain')
export const Building2 = createIcon(PhBuildings, 'Building2')
export const Calendar = createIcon(PhCalendar, 'Calendar')
export const CalendarClock = createIcon(PhCalendarCheck, 'CalendarClock')
export const Camera = createIcon(PhCamera, 'Camera')
export const Check = createIcon(PhCheck, 'Check')
export const CheckCheck = createIcon(PhChecks, 'CheckCheck')
export const CheckCircle = createIcon(PhCheckCircle, 'CheckCircle')
export const CheckCircle2 = createIcon(PhSealCheck, 'CheckCircle2')
export const ChevronDown = createIcon(PhCaretDown, 'ChevronDown')
export const ChevronLeft = createIcon(PhCaretLeft, 'ChevronLeft')
export const ChevronRight = createIcon(PhCaretRight, 'ChevronRight')
export const Clock = createIcon(PhClock, 'Clock')
export const Clock3 = createIcon(PhClockCountdown, 'Clock3')
export const Code = createIcon(PhCode, 'Code')
export const Columns3 = createIcon(PhColumns, 'Columns3')
export const Construction = createIcon(PhHammer, 'Construction')
export const Copy = createIcon(PhCopy, 'Copy')
export const CreditCard = createIcon(PhCreditCard, 'CreditCard')
export const Crown = createIcon(PhCrown, 'Crown')
export const Database = createIcon(PhDatabase, 'Database')
export const Donut = createIcon(PhChartDonut, 'Donut')
export const Download = createIcon(PhDownload, 'Download')
export const Edit3 = createIcon(PhPencilSimpleLine, 'Edit3')
export const ExternalLink = createIcon(PhArrowSquareOut, 'ExternalLink')
export const Eye = createIcon(PhEye, 'Eye')
export const EyeOff = createIcon(PhEyeSlash, 'EyeOff')
export const FileIcon = createIcon(PhFileIcon, 'FileIcon')
export const FilePlus2 = createIcon(PhFilePlus, 'FilePlus2')
export const FileText = createIcon(PhFileText, 'FileText')
export const FileType2 = createIcon(PhFileText, 'FileType2')
export const Filter = createIcon(PhFunnel, 'Filter')
export const Folder = createIcon(PhFolder, 'Folder')
export const FolderKanban = createIcon(PhKanban, 'FolderKanban')
export const FolderOpen = createIcon(PhFolderOpen, 'FolderOpen')
export const FolderPlus = createIcon(PhFolderPlus, 'FolderPlus')
export const Globe = createIcon(PhGlobe, 'Globe')
export const HardDrive = createIcon(PhHardDrive, 'HardDrive')
export const Hash = createIcon(PhHash, 'Hash')
export const Heading1 = createIcon(PhTextHOne, 'Heading1')
export const Heading2 = createIcon(PhTextHTwo, 'Heading2')
export const Heading3 = createIcon(PhTextHThree, 'Heading3')
export const HelpCircle = createIcon(PhQuestion, 'HelpCircle')
export const History = createIcon(PhClockCounterClockwise, 'History')
export const Image = createIcon(PhImage, 'Image')
export const Italic = createIcon(PhTextItalic, 'Italic')
export const KeyRound = createIcon(PhKey, 'KeyRound')
export const Languages = createIcon(PhTranslate, 'Languages')
export const Layers = createIcon(PhStack, 'Layers')
export const Layout = createIcon(PhLayout, 'Layout')
export const LayoutDashboard = createIcon(PhGauge, 'LayoutDashboard')
export const LayoutGrid = createIcon(PhGridFour, 'LayoutGrid')
export const LineChart = createIcon(PhChartLine, 'LineChart')
export const Link = createIcon(PhLink, 'Link')
export const Link2 = createIcon(PhLinkSimple, 'Link2')
export const List = createIcon(PhList, 'List')
export const ListOrdered = createIcon(PhListNumbers, 'ListOrdered')
export const Loader2 = createIcon(PhSpinnerGap, 'Loader2')
export const Lock = createIcon(PhLock, 'Lock')
export const LogOut = createIcon(PhSignOut, 'LogOut')
export const Mail = createIcon(PhEnvelopeSimple, 'Mail')
export const Maximize2 = createIcon(PhArrowsOut, 'Maximize2')
export const Menu = createIcon(PhList, 'Menu')
export const MessageSquare = createIcon(PhChatCenteredText, 'MessageSquare')
export const MessageSquareDashed = createIcon(PhChatDots, 'MessageSquareDashed')
export const Mic = createIcon(PhMicrophone, 'Mic')
export const Minimize2 = createIcon(PhArrowsIn, 'Minimize2')
export const Minus = createIcon(PhMinus, 'Minus')
export const Moon = createIcon(PhMoon, 'Moon')
export const MoreHorizontal = createIcon(PhDotsThree, 'MoreHorizontal')
export const MousePointer2 = createIcon(PhCursor, 'MousePointer2')
export const PanelLeftClose = createIcon(PhSidebarSimple, 'PanelLeftClose')
export const PanelLeftOpen = createIcon(PhSidebarSimple, 'PanelLeftOpen')
export const PanelsTopLeft = createIcon(PhAppWindow, 'PanelsTopLeft')
export const Paperclip = createIcon(PhPaperclip, 'Paperclip')
export const Pause = createIcon(PhPause, 'Pause')
export const Pencil = createIcon(PhPencil, 'Pencil')
export const Phone = createIcon(PhPhone, 'Phone')
export const Play = createIcon(PhPlay, 'Play')
export const Plus = createIcon(PhPlus, 'Plus')
export const Quote = createIcon(PhQuotes, 'Quote')
export const Redo2 = createIcon(PhArrowClockwise, 'Redo2')
export const RefreshCcw = createIcon(PhArrowCounterClockwise, 'RefreshCcw')
export const RefreshCw = createIcon(PhArrowClockwise, 'RefreshCw')
export const Repeat = createIcon(PhRepeat, 'Repeat')
export const RotateCcw = createIcon(PhArrowCounterClockwise, 'RotateCcw')
export const Save = createIcon(PhFloppyDisk, 'Save')
export const Search = createIcon(PhMagnifyingGlass, 'Search')
export const Send = createIcon(PhPaperPlaneTilt, 'Send')
export const SendHorizontal = createIcon(PhPaperPlaneRight, 'SendHorizontal')
export const Settings = createIcon(PhGear, 'Settings')
export const Shield = createIcon(PhShield, 'Shield')
export const ShieldAlert = createIcon(PhShieldWarning, 'ShieldAlert')
export const ShieldCheck = createIcon(PhShieldCheck, 'ShieldCheck')
export const SlidersHorizontal = createIcon(PhSlidersHorizontal, 'SlidersHorizontal')
export const Smile = createIcon(PhSmiley, 'Smile')
export const Sparkles = createIcon(PhSparkle, 'Sparkles')
export const Square = createIcon(PhSquare, 'Square')
export const Sun = createIcon(PhSun, 'Sun')
export const Table2 = createIcon(PhTable, 'Table2')
export const ToggleLeft = createIcon(PhToggleLeft, 'ToggleLeft')
export const Trash2 = createIcon(PhTrash, 'Trash2')
export const TrendingUp = createIcon(PhTrendUp, 'TrendingUp')
export const Type = createIcon(PhTextT, 'Type')
export const Underline = createIcon(PhTextUnderline, 'Underline')
export const Undo2 = createIcon(PhArrowCounterClockwise, 'Undo2')
export const Upload = createIcon(PhUpload, 'Upload')
export const User = createIcon(PhUser, 'User')
export const UserCog = createIcon(PhUserGear, 'UserCog')
export const UserPlus = createIcon(PhUserPlus, 'UserPlus')
export const Users = createIcon(PhUsers, 'Users')
export const Video = createIcon(PhVideo, 'Video')
export const Wallet = createIcon(PhWallet, 'Wallet')
export const WandSparkles = createIcon(PhMagicWand, 'WandSparkles')
export const Wrench = createIcon(PhWrench, 'Wrench')
export const X = createIcon(PhX, 'X')
export const XCircle = createIcon(PhXCircle, 'XCircle')
export const Zap = createIcon(PhLightning, 'Zap')
