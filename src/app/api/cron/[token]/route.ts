import { NextRequest } from 'next/server';

import { handleCronRequest } from '@/lib/cron';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params;
  return handleCronRequest(request, token);
}
