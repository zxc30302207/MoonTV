import { NextRequest } from 'next/server';

import { handleCronRequest } from '@/lib/cron';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  return handleCronRequest(request);
}
