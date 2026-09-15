import { useEffect, useId, useRef, type ReactNode } from 'react';
import Icon from './Icon';
export default function Dialog({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null), titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current!;
    dialog.showModal();
    return () => { dialog.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <dialog ref={ref} aria-labelledby={titleId} className={'app-dialog ' + className} onCancel={e => { e.preventDefault(); onClose(); }}>
    <div className="dialog-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label={'Close ' + title.toLowerCase()} onClick={onClose}><Icon name="close" /></button></div>
    <div className="dialog-body">{children}</div>
  </dialog>;
}
