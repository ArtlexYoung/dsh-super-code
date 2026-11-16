import React, { useMemo } from './react.js'

function FeatureBoundary({ t, children }) {
  const Boundary = useMemo(() => class extends React.Component {
    state = { failed: false }
    static getDerivedStateFromError() { return { failed: true } }
    componentDidCatch(error) { console.warn('Super Code view is unavailable:', error) }
    render() {
      if (!this.state.failed) return this.props.children
      return React.createElement('div', { role: 'alert' },
        React.createElement('p', null, this.props.t('module.unavailable')),
        React.createElement('button', { type: 'button', onClick: () => this.setState({ failed: false }) }, this.props.t('module.retry')))
    }
  }, [])
  return React.createElement(Boundary, { t }, children)
}

function featureView(View, props, ...children) {
  return React.createElement(FeatureBoundary, { t: props.t, key: props.key }, React.createElement(View, props, ...children))
}

export { FeatureBoundary, featureView }
