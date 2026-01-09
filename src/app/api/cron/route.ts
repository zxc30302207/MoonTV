import { NextRequest } from 'next/server';

import { handleCronRequest } from '@/lib/cron';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  return handleCronRequest(request);
}
