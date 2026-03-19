import { resetWholeApp } from "../utils/resetApp.js";
import { useI18n } from "../i18n/useI18n.js";

export function AppResetFooter({ className = "" }) {
  const { t } = useI18n();
  return (
    <div className={`text-center ${className}`.trim()}>
      <p className="text-xs text-gray-500 dark:text-gray-400">
        {t("resetFooter.title")}{" "}
        <button
          type="button"
          onClick={() => {
            resetWholeApp();
          }}
          className="font-medium text-gray-500 underline underline-offset-2 transition hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          {t("resetFooter.button")}
        </button>
      </p>
    </div>
  );
}
