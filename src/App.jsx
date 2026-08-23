import React, { useEffect, useState } from "react";
import { createBrowserRouter, RouterProvider, Outlet, ScrollRestoration, isRouteErrorResponse, useRouteError, Link, useParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Landing } from "./components/Landing.jsx";
import { LawViewer } from "./components/LawViewer.jsx";
import { ThemeProvider } from "./components/ThemeProvider.jsx";
import { isMigrationCurrent, runOneTimeMigrationReset } from "./utils/resetApp.js";
import { runOneTimeTopicsBackfill } from "./utils/topicsBackfill.js";
import { I18nProvider } from "./i18n/I18nProvider.jsx";
import { useI18n } from "./i18n/useI18n.js";
import { getLocaleHomePath, isSupportedUiLocale, normalizeUiLocale, SUPPORTED_UI_LOCALES } from "./i18n/localeMeta.js";

function Layout() {
  useEffect(() => {
    // The one-time migration reset runs behind App's boot gate before any
    // route mounts, so it finishes without a reload and without wiping data
    // under a live view.
    runOneTimeTopicsBackfill().catch(() => {});
  }, []);

  return (
    <I18nProvider>
      <ScrollRestoration />
      <Outlet />
    </I18nProvider>
  );
}

function RouteErrorScreen() {
  const error = useRouteError();
  const { locale, t } = useI18n();
  const title = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText || t("error.somethingWentWrong")}`
    : t("error.somethingWentWrong");
  const message = isRouteErrorResponse(error)
    ? error.data?.message || t("error.routingError")
    : error instanceof Error
      ? error.message
      : t("error.unexpectedProblem");

  return (
    <div className="min-h-screen bg-gradient-to-b from-paper to-white px-6 py-12 dark:from-gray-950 dark:to-gray-900">
      <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center">
        <div className="w-full rounded-3xl border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <Link
            to={getLocaleHomePath(locale)}
            className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium tracking-tight text-gray-700 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700"
          >
            {t("app.name")}
          </Link>
          <h1 className="mt-6 text-3xl font-semibold tracking-tight text-gray-900 dark:text-white">
            {title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-400">
            {message}
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 dark:bg-blue-600 dark:hover:bg-blue-500"
            >
              {t("common.reloadPage")}
            </button>
            <Link
              to={getLocaleHomePath(locale)}
              className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {t("app.home")}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function RouteErrorScreenWithI18n() {
  return (
    <I18nProvider>
      <RouteErrorScreen />
    </I18nProvider>
  );
}

function SlugRouteResolver() {
  const { slug } = useParams();
  if (isSupportedUiLocale(slug)) {
    return <Landing forcedLocale={normalizeUiLocale(slug)} />;
  }
  return <LawViewer />;
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    errorElement: <RouteErrorScreenWithI18n />,
    children: [
      {
        index: true,
        element: <Landing />,
      },
      ...SUPPORTED_UI_LOCALES.map((supportedLocale) => ({
        path: `${supportedLocale}/:slug/:kind?/:id?`,
        element: <LawViewer />,
      })),
      {
        path: "import",
        element: <LawViewer />,
      },
      {
        path: "import/:kind/:id",
        element: <LawViewer />,
      },
      {
        path: "law/:key",
        element: <LawViewer />,
      },
      {
        path: "law/:key/:kind/:id",
        element: <LawViewer />,
      },
      {
        path: ":slug/:kind?/:id?",
        element: <SlugRouteResolver />,
      },
    ],
  },
], {
  basename: "/",
});

function BootSplash() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
        <Loader2 size={28} className="animate-spin" />
      </div>
    </div>
  );
}

export default function App() {
  // First-time visitors (and any browser missing the migration marker) must
  // not see the prerendered SEO markup while the one-time reset wipes local
  // data, and routes must not mount onto half-wiped storage. A synchronous
  // marker check picks the boot phase before the first paint; the reset then
  // runs behind a splash instead of blocking the mount.
  const [booting, setBooting] = useState(() => !isMigrationCurrent());

  useEffect(() => {
    if (!booting) return undefined;
    let active = true;
    runOneTimeMigrationReset().finally(() => {
      if (active) setBooting(false);
    });
    return () => {
      active = false;
    };
  }, [booting]);

  if (booting) {
    return <BootSplash />;
  }

  return (
    <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}
