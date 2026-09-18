import { Component, ReactNode } from "react";
import RouteErrorFallback from "@/components/RouteErrorFallback";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-[#0a0a0b] flex items-center justify-center p-6">
          <RouteErrorFallback
            title="Page crashed"
            message={this.state.error.message}
            onRetry={() => this.setState({ error: null })}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
