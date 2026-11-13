import { Icon } from "./Icon";

export interface ThemeControls {
  dark: boolean;
  toggleTheme: () => void;
}

export function ThemeToggle({ dark, toggleTheme }: ThemeControls) {
  return <button type="button" className="button quiet-button view-control" onClick={toggleTheme}
    aria-label="Темна тема" aria-pressed={dark} title={dark ? "Увімкнути світлу тему" : "Увімкнути темну тему"}>
    <Icon name={dark ? "sun" : "moon"}/>
  </button>;
}
