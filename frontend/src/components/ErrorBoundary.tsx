import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last line of defence for the whole SPA: a failed lazy chunk (for example after a
 * deployment replaced the hashed files) or any render error must not leave a blank
 * screen. Data stays on the server; reloading is always safe.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled UI error', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center">
        <div className="w-full max-w-md">
          <p className="text-4xl font-semibold text-slate-300">Oops</p>
          <h1 className="mt-2 text-lg font-semibold text-slate-900">This screen could not be loaded</h1>
          <p className="mt-2 text-sm text-slate-600">
            Your saved data is safe on the server. Reload the page to continue — if the problem stays,
            check your internet connection and try again.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              Reload page
            </button>
            <a
              href="/"
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              Go to dashboard
            </a>
          </div>
        </div>
      </div>
    );
  }
}
