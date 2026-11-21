import PuzzleIcon from "@gentleface/react/icons/puzzle";
import RotateCcwIcon from "@gentleface/react/icons/rotate-ccw";
import RotateCwIcon from "@gentleface/react/icons/rotate-cw";
import UsersIcon from "@gentleface/react/icons/users";
import MonitorIcon from "@gentleface/react/icons/monitor";
import MoonIcon from "@gentleface/react/icons/moon";
import SunIcon from "@gentleface/react/icons/sun";
import MaximizeIcon from "@gentleface/react/icons/maximize";
import MinimizeIcon from "@gentleface/react/icons/minimize";
import SidebarCloseIcon from "@gentleface/react/icons/sidebar-right-collapse";
import SidebarOpenIcon from "@gentleface/react/icons/sidebar-right-expand";
import ChevronUpIcon from "@gentleface/react/icons/chevron-up";
import ChevronDownIcon from "@gentleface/react/icons/chevron-down";
import CheckIcon from "@gentleface/react/icons/check";
import CloseIcon from "@gentleface/react/icons/x";

import SettingsIcon from "@gentleface/react/icons/settings";
import MapPinIcon from "@gentleface/react/icons/map-pin";

const icons = {
  settings: SettingsIcon, mapPin: MapPinIcon, check: CheckIcon,
  chevronUp: ChevronUpIcon, chevronDown: ChevronDownIcon, close: CloseIcon,
  puzzle: PuzzleIcon, refresh: RotateCwIcon, undo: RotateCcwIcon, people: UsersIcon, monitor: MonitorIcon,
  moon: MoonIcon, sun: SunIcon, maximize: MaximizeIcon, minimize: MinimizeIcon,
  sidebarClose: SidebarCloseIcon, sidebarOpen: SidebarOpenIcon,
};
export function Icon({ name, className = "" }: { name: keyof typeof icons; className?: string }) {
  const Component = icons[name];
  return <Component variant="line-round" size={16} className={`icon ${className}`} aria-hidden="true" focusable="false" />;
}
