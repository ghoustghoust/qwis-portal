import { Component } from 'react';

// 2.4 Error Boundary：组件渲染异常时降级显示错误提示 + 重试按钮，避免整页白屏
// 用法：<ErrorBoundary fallback="页面"><ChildComponent /></ErrorBoundary>
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error(`[ErrorBoundary:${this.props.fallback || 'component'}]`, error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ error: null, errorInfo: null });
  };

  render() {
    if (this.state.error) {
      const label = this.props.fallback || '组件';
      return (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
          <div className="text-2xl mb-3 opacity-40">!</div>
          <div className="text-sm font-medium t-text mb-1">{label}加载异常</div>
          <div className="text-xs t-muted mb-4 max-w-md">
            {this.state.error?.message || '未知错误'}
          </div>
          <button
            className="pill on cursor-pointer !text-xs !px-3 !py-1"
            onClick={this.handleRetry}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
