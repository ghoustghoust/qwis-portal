import { useEffect, useState } from 'react';

// 极简全局 toast：任意模块 import { toast } 后调用 toast('文案')
let pushFn = null;

export function toast(msg) {
  if (pushFn) pushFn(String(msg));
}

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    pushFn = (msg) => {
      const id = `${Date.now()}-${Math.random()}`;
      setItems((s) => [...s, { id, msg }]);
      setTimeout(() => setItems((s) => s.filter((i) => i.id !== id)), 1500);
    };
    return () => {
      pushFn = null;
    };
  }, []);
  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none">
      {items.map((i) => (
        <div key={i.id} className="toast-item">
          {i.msg}
        </div>
      ))}
    </div>
  );
}
