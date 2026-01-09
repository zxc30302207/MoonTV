import { NextRequest } from 'next/server';

import { handleCronRequest } from '@/lib/cron';

export const runtime = 'edge';

export async function GET(
  request: NextRequest,
  context: { params: { token: string } }
) {
  return handleCronRequest(request, context.params.token);
}
