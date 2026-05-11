'use client';

import { Check, ChevronDown, Copy, MonitorPlay } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  buildExternalPlayerUrl,
  EXTERNAL_PLAYERS,
} from '@/lib/external-player';

interface ExternalPlayerMenuProps {
  mediaUrl: string;
  title?: string;
  className?: string;
}

export default function ExternalPlayerMenu({
  mediaUrl,
  title = '',
  className = '',
}: ExternalPlayerMenuProps) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const playableUrl = mediaUrl.trim();

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!playableUrl) return null;

  const launchPlayer = (playerId: (typeof EXTERNAL_PLAYERS)[number]['id']) => {
    const launchUrl = buildExternalPlayerUrl(playerId, playableUrl, title);
    if (!launchUrl) return;

    const anchor = document.createElement('a');
    anchor.href = launchUrl;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setOpen(false);
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(playableUrl);
      setCopied(true);
      setOpen(false);
    } catch (_) {
      const textarea = document.createElement('textarea');
      textarea.value = playableUrl;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
      setCopied(true);
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className={`relative inline-flex ${className}`}>
      <button
        type='button'
        onClick={() => setOpen((value) => !value)}
        className='inline-flex h-8 items-center gap-1.5 rounded-full bg-slate-700 px-3 text-xs font-medium text-white shadow-md transition-all duration-200 hover:bg-slate-600 hover:scale-[1.05] focus:outline-none focus:ring-2 focus:ring-slate-400 dark:bg-slate-600 dark:hover:bg-slate-500'
        title='外部播放器'
        aria-label='外部播放器'
        aria-expanded={open}
      >
        <MonitorPlay className='h-4 w-4' />
        <span className='hidden sm:inline'>外部播放</span>
        <ChevronDown className='h-3.5 w-3.5' />
      </button>

      {open && (
        <div className='absolute right-0 top-full z-[80] mt-2 w-44 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-xl dark:border-gray-700 dark:bg-gray-900'>
          {EXTERNAL_PLAYERS.map((player) => (
            <button
              key={player.id}
              type='button'
              onClick={() => launchPlayer(player.id)}
              className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
            >
              <MonitorPlay className='h-4 w-4 text-gray-500 dark:text-gray-400' />
              <span>{player.label}</span>
            </button>
          ))}

          <div className='my-1 border-t border-gray-200 dark:border-gray-700' />

          <button
            type='button'
            onClick={copyUrl}
            className='flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
          >
            {copied ? (
              <Check className='h-4 w-4 text-green-500' />
            ) : (
              <Copy className='h-4 w-4 text-gray-500 dark:text-gray-400' />
            )}
            <span>{copied ? '已複製' : '複製播放網址'}</span>
          </button>
        </div>
      )}
    </div>
  );
}
