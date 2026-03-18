import React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "./useTheme";
import { Button } from "./Button";
import { useI18n } from "../i18n/useI18n.js";

export function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    const { t } = useI18n();

    const toggleTheme = () => {
        if (theme === 'light') {
            setTheme('dark');
        } else {
            setTheme('light');
        }
    };

    return (
        <Button
            variant="ghost"
            onClick={toggleTheme}
            className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${theme === 'dark'
                    ? 'text-gray-400 hover:text-blue-400 hover:bg-gray-800'
                    : 'text-gray-500 hover:text-blue-700 hover:bg-blue-50'
                }`}
            title={theme === 'dark' ? t("theme.switchToLight") : t("theme.switchToDark")}
        >
            <Sun className="h-[1.2rem] w-[1.2rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-[1.2rem] w-[1.2rem] rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="sr-only">{t("theme.toggle")}</span>
        </Button>
    );
}
