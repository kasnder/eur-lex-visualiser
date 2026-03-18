import React, { useEffect } from "react";
import { createBrowserRouter, RouterProvider, Outlet, ScrollRestoration, isRouteErrorResponse, useRouteError, Link } from "react-router-dom";
import { Landing } from "./components/Landing.jsx";
import { LawViewer } from "./components/LawViewer.jsx";
import { ThemeProvider } from "./components/ThemeProvider.jsx";
import { runOneTimeMigrationReset } from "./utils/resetApp.js";

function Layout() {
  useEffect(() => {
    runOneTimeMigrationReset().then((didReset) => {
      if (!didReset) return;
      window.location.replace(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    });
  }, []);

  return (
    <>
      <ScrollRestoration />
      <Outlet />
    </>
  );
}

function RouteErrorScreen() {
  const error = useRouteError();
  const title = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText || "Something went wrong"}`
    : "Something went wrong";
  const message = isRouteErrorResponse(error)
    ? error.data?.message || "LegalViz hit a routing error while opening this page."
    : error instanceof Error
      ? error.message
      : "LegalViz ran into an unexpected problem while loading this page.";

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white px-6 py-12 dark:from-gray-950 dark:to-gray-900">
      <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center">
        <div className="w-full rounded-3xl border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-800 dark:bg-gray-900">
          <Link
            to="/"
            className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium tracking-tight text-gray-700 ring-1 ring-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:ring-gray-700"
          >
            LegalViz.EU
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
              Reload page
            </button>
            <Link
              to="/"
              className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Go to homepage
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    errorElement: <RouteErrorScreen />,
    children: [
      {
        index: true,
        element: <Landing />,
      },
      {
        path: "extension",
        element: <LawViewer />,
      },
      {
        path: "extension/:kind/:id",
        element: <LawViewer />,
      },
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
        path: ":slug",
        element: <LawViewer />,
      },
      {
        path: ":slug/:kind/:id",
        element: <LawViewer />,
      },
    ],
  },
], {
  basename: "/",
});

export default function App() {
  return (
    <ThemeProvider defaultTheme="system" storageKey="vite-ui-theme">
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}
