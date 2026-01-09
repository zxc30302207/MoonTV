'use client';

import { useEffect } from 'react';

import { refreshAuthInfo } from '@/lib/auth-client';

export default function AuthBootstrap() {
  useEffect(() => {
    refreshAuthInfo();
  }, []);

  return null;
}
