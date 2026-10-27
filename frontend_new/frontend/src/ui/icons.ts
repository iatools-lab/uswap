import { createElement, forwardRef } from "react";
import type { CSSProperties } from "react";
import {
  IconActivity,
  IconAdjustmentsHorizontal,
  IconAlertCircle,
  IconAlertOctagon,
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconArrowsExchange,
  IconBell,
  IconBolt,
  IconTrash,
  IconBuilding,
  IconCalendar,
  IconCalendarCheck,
  IconCalendarEvent,
  IconCalendarWeek,
  IconChartBar,
  IconChartLine,
  IconCheck,
  IconChecks,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconClockHour3,
  IconCloudCheck,
  IconCloudUpload,
  IconCompass,
  IconCrosshair,
  IconDeviceFloppy,
  IconDots,
  IconDownload,
  IconEye,
  IconEyeOff,
  IconFileSpreadsheet,
  IconGauge,
  IconHistory,
  IconInfoCircle,
  IconKey,
  IconLayoutDashboard,
  IconLayoutGrid,
  IconLayoutRows,
  IconLayoutSidebar,
  IconLinkOff,
  IconList,
  IconLogin,
  IconLoader2,
  IconLock,
  IconLogout,
  IconMail,
  IconMailCheck,
  IconMapPin,
  IconPaperclip,
  IconPencil,
  IconPhone,
  IconPlus,
  IconPower,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconShieldExclamation,
  IconSortAscending,
  IconUpload,
  IconUser,
  IconUserCircle,
  IconUsers,
  IconUsersGroup,
  IconWifiOff,
  IconX,
  type IconProps,
  type TablerIcon,
} from "@tabler/icons-react";

type LegacyWeight = "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
type CompatibleIconProps = IconProps & {
  weight?: LegacyWeight;
  mirrored?: boolean;
};

function strokeFor(weight?: LegacyWeight) {
  if (weight === "thin") return 1.25;
  if (weight === "light" || weight === "duotone") return 1.5;
  if (weight === "bold" || weight === "fill") return 2.25;
  return 1.8;
}

function makeIcon(Component: TablerIcon, name: string) {
  const Wrapped = forwardRef<SVGSVGElement, CompatibleIconProps>(
    ({ size = 20, stroke, weight, mirrored, style, ...props }, ref) =>
      createElement(Component, {
        ...props,
        ref,
        size,
        stroke: stroke ?? strokeFor(weight),
        style: mirrored
          ? ({ ...style, transform: "scaleX(-1)" } as CSSProperties)
          : style,
      }),
  );
  Wrapped.displayName = name;
  return Wrapped;
}

const Activity = makeIcon(IconActivity, "Activity");
const ArrowLeft = makeIcon(IconArrowLeft, "ArrowLeft");
const ArrowRight = makeIcon(IconArrowRight, "ArrowRight");
const Swap = makeIcon(IconArrowsExchange, "Swap");
const Bell = makeIcon(IconBell, "Bell");
const Building2 = makeIcon(IconBuilding, "Building2");
const Calendar = makeIcon(IconCalendar, "Calendar");
const CalendarBlank = makeIcon(IconCalendarEvent, "CalendarBlank");
const CalendarCheck = makeIcon(IconCalendarCheck, "CalendarCheck");
const CalendarDots = makeIcon(IconCalendarWeek, "CalendarDots");
const ChartBar = makeIcon(IconChartBar, "ChartBar");
const ChartLineUp = makeIcon(IconChartLine, "ChartLineUp");
const Check = makeIcon(IconCheck, "Check");
const CheckCheck = makeIcon(IconChecks, "CheckCheck");
const CheckCircle = makeIcon(IconCircleCheck, "CheckCircle");
const ChevronDown = makeIcon(IconChevronDown, "ChevronDown");
const ChevronLeft = makeIcon(IconChevronLeft, "ChevronLeft");
const ChevronRight = makeIcon(IconChevronRight, "ChevronRight");
const Clock = makeIcon(IconClock, "Clock");
const Clock3 = makeIcon(IconClockHour3, "Clock3");
const ClockCountdown = Clock3;
const CloudCheck = makeIcon(IconCloudCheck, "CloudCheck");
const CloudUpload = makeIcon(IconCloudUpload, "CloudUpload");
const Compass = makeIcon(IconCompass, "Compass");
const Crosshair = makeIcon(IconCrosshair, "Crosshair");
const DownloadSimple = makeIcon(IconDownload, "DownloadSimple");
const DotsThree = makeIcon(IconDots, "DotsThree");
const Edit = makeIcon(IconPencil, "Edit");
const Eye = makeIcon(IconEye, "Eye");
const EyeOff = makeIcon(IconEyeOff, "EyeOff");
const FileSpreadsheet = makeIcon(IconFileSpreadsheet, "FileSpreadsheet");
const Gauge = makeIcon(IconGauge, "Gauge");
const Gear = makeIcon(IconSettings, "Gear");
const History = makeIcon(IconHistory, "History");
const Info = makeIcon(IconInfoCircle, "Info");
const Key = makeIcon(IconKey, "Key");
const LayoutDashboard = makeIcon(IconLayoutDashboard, "LayoutDashboard");
const LayoutRows = makeIcon(IconLayoutRows, "LayoutRows");
const Link2Off = makeIcon(IconLinkOff, "Link2Off");
const List = makeIcon(IconList, "List");
const LogIn = makeIcon(IconLogin, "LogIn");
const LoaderCircle = makeIcon(IconLoader2, "LoaderCircle");
const Lock = makeIcon(IconLock, "Lock");
const LogOut = makeIcon(IconLogout, "LogOut");
const Mail = makeIcon(IconMail, "Mail");
const MailCheck = makeIcon(IconMailCheck, "MailCheck");
const MapPin = makeIcon(IconMapPin, "MapPin");
const MagnifyingGlass = makeIcon(IconSearch, "MagnifyingGlass");
const Paperclip = makeIcon(IconPaperclip, "Paperclip");
const PaperPlane = ArrowRight;
const PencilSimple = Edit;
const Phone = makeIcon(IconPhone, "Phone");
const Plus = makeIcon(IconPlus, "Plus");
const Power = makeIcon(IconPower, "Power");
const RefreshCw = makeIcon(IconRefresh, "RefreshCw");
const Search = makeIcon(IconSearch, "Search");
const ShieldCheck = makeIcon(IconShieldCheck, "ShieldCheck");
const ShieldWarning = makeIcon(IconShieldExclamation, "ShieldWarning");
const SidebarSimple = makeIcon(IconLayoutSidebar, "SidebarSimple");
const SlidersHorizontal = makeIcon(
  IconAdjustmentsHorizontal,
  "SlidersHorizontal",
);
const SortAscending = makeIcon(IconSortAscending, "SortAscending");
const Warning = makeIcon(IconAlertTriangle, "Warning");
const WarningCircle = makeIcon(IconAlertCircle, "WarningCircle");
const WarningDiamond = makeIcon(IconAlertOctagon, "WarningDiamond");
const SquaresFour = makeIcon(IconLayoutGrid, "SquaresFour");
const UploadSimple = makeIcon(IconUpload, "UploadSimple");
const User = makeIcon(IconUser, "User");
const UserCircle = makeIcon(IconUserCircle, "UserCircle");
const UserRound = UserCircle;
const Users = makeIcon(IconUsers, "Users");
const UsersThree = makeIcon(IconUsersGroup, "UsersThree");
const WifiSlash = makeIcon(IconWifiOff, "WifiSlash");
const X = makeIcon(IconX, "X");
const XCircle = makeIcon(IconCircleX, "XCircle");
const Zap = makeIcon(IconBolt, "Zap");
const FloppyDisk = makeIcon(IconDeviceFloppy, "FloppyDisk");
// Nettoyage des donnees : icone reservee a l'espace super administrateur.
const Broom = makeIcon(IconTrash, "Broom");

export {
  Activity,
  Activity as ActivityIcon,
  ArrowLeft,
  ArrowLeft as ArrowLeftIcon,
  ArrowRight,
  ArrowRight as ArrowRightIcon,
  RefreshCw as ArrowsClockwiseIcon,
  Bell,
  Bell as BellIcon,
  Building2,
  Calendar,
  Calendar as CalendarIcon,
  CalendarBlank,
  CalendarBlank as CalendarBlankIcon,
  CalendarCheck as CalendarCheckIcon,
  CalendarDots as CalendarDotsIcon,
  ChevronDown as CaretDownIcon,
  ChevronLeft as CaretLeftIcon,
  ChevronRight as CaretRight,
  ChevronRight as CaretRightIcon,
  ChartBar as ChartBarIcon,
  ChartLineUp as ChartLineUpIcon,
  Check,
  Check as CheckIcon,
  CheckCheck,
  CheckCircle,
  CheckCircle as CheckCircleIcon,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Clock3,
  ClockCountdown as ClockCountdownIcon,
  History as ClockCounterClockwise,
  History as ClockCounterClockwiseIcon,
  Clock as ClockIcon,
  CloudUpload as CloudArrowUpIcon,
  CloudCheck as CloudCheckIcon,
  CloudUpload,
  Compass as CompassIcon,
  Crosshair as CrosshairIcon,
  DownloadSimple,
  DownloadSimple as DownloadSimpleIcon,
  DotsThree as DotsThreeIcon,
  Edit,
  Mail as EnvelopeSimpleIcon,
  Eye,
  Eye as EyeIcon,
  EyeOff,
  FileSpreadsheet,
  FloppyDisk as FloppyDiskIcon,
  Broom as BroomIcon,
  Gauge as GaugeIcon,
  Gear,
  Gear as GearIcon,
  History,
  Info,
  Info as InfoIcon,
  Key as KeyIcon,
  LayoutDashboard,
  Zap as LightningIcon,
  Link2Off,
  List as ListIcon,
  LogIn,
  LoaderCircle,
  Lock as LockKeyIcon,
  LogOut,
  MagnifyingGlass,
  MagnifyingGlass as MagnifyingGlassIcon,
  Mail,
  MailCheck,
  MapPin,
  MapPin as MapPinIcon,
  Paperclip as PaperclipIcon,
  PaperPlane,
  PencilSimple,
  PencilSimple as PencilSimpleIcon,
  Phone as PhoneIcon,
  Plus as PlusIcon,
  Power as PowerIcon,
  RefreshCw,
  LayoutRows as RowsIcon,
  Search,
  ShieldCheck as ShieldCheckIcon,
  ShieldWarning as ShieldWarningIcon,
  SidebarSimple as SidebarSimpleIcon,
  SlidersHorizontal as SlidersHorizontalIcon,
  SortAscending as SortAscendingIcon,
  LoaderCircle as SpinnerGapIcon,
  SquaresFour as SquaresFourIcon,
  Swap,
  UploadSimple,
  UserCircle as UserCircleIcon,
  User as UserIcon,
  UserRound,
  Users,
  UsersThree as UsersThreeIcon,
  Warning,
  Warning as WarningIcon,
  WarningCircle as WarningCircleIcon,
  WarningDiamond as WarningDiamondIcon,
  WifiSlash as WifiSlashIcon,
  X,
  XCircle as XCircleIcon,
  X as XIcon,
  Zap,
};
