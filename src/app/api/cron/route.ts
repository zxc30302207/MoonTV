import { NextRequest } from 'next/server';

import { handleCronRequest } from '@/lib/cron';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  return handleCronRequest(request);
}
