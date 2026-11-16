// 宿主提供同一个 React 实例，集中读取以免构建产物逐模块复制互操作对象。
const React = require('react')
const { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } = React

export { React as default, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore }
