import { Component, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Global error boundary — prevents a single component error from blanking the whole page.
 * Shows a useful message + a manual "Try again" (user-initiated, no auto-refresh loop).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[ErrorBoundary]", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
          <div className="bg-card border border-border rounded-xl p-8 max-w-md w-full text-center space-y-3">
            <p className="font-display text-xl font-semibold">Something went wrong</p>
            <p className="text-sm text-muted-foreground">
              This section could not be rendered. Please try again.
            </p>
            {this.state.error.message && (
              <p className="text-xs text-muted-foreground/70 break-words">{this.state.error.message}</p>
            )}
            <button
              onClick={() => this.setState({ error: null })}
              className="inline-flex items-center justify-center px-4 py-2 rounded-md text-sm font-medium bg-brand-copper text-white hover:bg-brand-copper/90"
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
