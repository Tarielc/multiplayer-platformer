'use client';

import { useEffect } from 'react';
import type { Notice, RoomStore } from '@/net/RoomStore';
import styles from './Toasts.module.css';

const TOAST_MS = 4000;

export function Toasts({ store, notices }: { store: RoomStore; notices: Notice[] }) {
  return (
    <div className={styles.stack} aria-live="polite">
      {notices.map((notice) => (
        <Toast key={notice.id} notice={notice} store={store} />
      ))}
    </div>
  );
}

function Toast({ notice, store }: { notice: Notice; store: RoomStore }) {
  useEffect(() => {
    const timer = setTimeout(() => store.dismiss(notice.id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [store, notice.id]);
  return (
    <div className={styles.toast} data-kind={notice.kind} onClick={() => store.dismiss(notice.id)}>
      {notice.text}
    </div>
  );
}
