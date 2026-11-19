import { useEffect } from 'react';

export function useWindowMode(openWindow, mode, visible = true, identity) {
  // 只在打开弹窗时读取偏好；返回 DSH、失败回退和修改设置均不重新开窗。
  useEffect(() => {
    if (visible && mode === 'external' && openWindow) void openWindow();
  }, [visible, identity]);
}
